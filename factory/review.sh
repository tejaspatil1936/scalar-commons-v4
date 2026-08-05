#!/usr/bin/env bash
# factory/review.sh — fresh-context adversarial review of a factory PR.
#
#   ./factory/review.sh [--dry-run] <pr-number>
#
# Runs THREE separate `claude -p` calls, one per lens. Each is a brand-new
# process with a fresh context and is handed ONLY:
#   - the complete list of changed file NAMES
#   - the complete diff of every dependency manifest (package.json/Cargo.toml)
#   - a REVIEW DIFF: the PR diff with generated/vendored files excluded
#   - the body of the issue the PR closes
#   - its own lens prompt
#
# Why fresh context: the author agent has spent hours convincing itself the work
# is good. Reviewing inside that context inherits the rationalisation. A
# reviewer that has never seen the author's reasoning can only judge the diff.
#
# Each reviewer is run from a temp dir OUTSIDE the repo, so CLAUDE.md is not
# auto-discovered and no reviewer can wander the tree looking for excuses. The
# rules a reviewer needs are embedded in its lens prompt.
#
# ---------------------------------------------------------------------------
# PAST BUG — DO NOT REGRESS (fixed 2026-08-05; see FACTORY-REVIEW-FIX.md)
#
# This script used to invoke `claude -p "$(cat "$pf")"`, passing the whole
# prompt as ONE argv string. Linux caps a SINGLE argument at MAX_ARG_STRLEN =
# 32 pages = 131072 bytes — a limit that is entirely separate from ARG_MAX.
# PR #85's prompt was 317062 bytes, so execve() failed with E2BIG before
# `claude` ever started: exit 126, zero bytes of stdout. review.sh discarded
# that exit code (`|| warn`) and then scored the missing verdict as FAIL, so a
# perfectly good PR was reported as failing all three lenses.
#
# Two rules follow, and both are load-bearing:
#   1. The prompt is fed on STDIN (`claude -p < "$pf"`), never as an argument.
#      Prompt size can then never fail an exec.
#   2. The exit code is captured and a non-zero exit is ERROR, never FAIL.
#      "The reviewer could not run" and "the reviewer objects" are different
#      facts and must never be collapsed into one.
#
# A second, independent bug lived here too: run_lens returned its verdict on
# stdout while also calling log(), which writes to stdout. The caller's
# `v="$(run_lens ...)"` therefore captured "[ts] running lens: …\nPASS", the
# `case "$v" in PASS)` matched neither arm, and the PASS/FAIL tally stayed at
# 0/0 regardless of what the models actually said. Lens results now travel in
# files ($WORK/<lens>.result), never on stdout, so the class of bug is gone.
# ---------------------------------------------------------------------------
#
# Verdicts: every lens must end with "VERDICT: PASS" or "VERDICT: FAIL". Three
# outcomes are distinguished, and the distinction matters:
#
#   PASS   the model returned VERDICT: PASS
#   FAIL   the model returned VERDICT: FAIL — a real objection
#   ERROR  the call failed, or exited 0 with no parseable verdict. The review
#          did not happen. This is NEVER reported as PASS and never as FAIL.
#
# Overall status:
#   any ERROR                  -> INCONCLUSIVE: no agent-reviewed, add
#                                 needs-human, exit 2
#   >=2 PASS and no ERROR      -> comment all verdicts + label agent-reviewed
#   any FAIL                   -> label needs-human + comment the objections
#
# The last two rules can BOTH apply (2 PASS + 1 FAIL). That is deliberate: the
# PR records that it cleared the bar AND that an unresolved objection exists.
# merge.sh requires agent-reviewed AND no needs-human, so any FAIL or ERROR
# blocks the merge while preserving the audit trail.
#
# A reviewer that cannot review reports INCONCLUSIVE. It never reports PASS.
#
# review.sh NEVER MERGES. It has no merge code path at all, under any flag.

set -uo pipefail

FACTORY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR
# shellcheck source=lib/common.sh
. "$FACTORY_DIR/lib/common.sh"

# Defaults live in config.env; these are the belt-and-braces fallbacks so the
# script is still correct if it is ever sourced with a truncated config.
: "${MAX_REVIEW_DIFF_LINES:=1500}"
: "${REVIEW_EXCLUDE_GLOBS:=**/package-lock.json **/pnpm-lock.yaml **/yarn.lock **/*.min.js **/*.min.css **/dist/** **/build/** **/node_modules/** **/*.map **/*snapshot.json}"
: "${REVIEW_MANIFEST_GLOBS:=**/package.json **/Cargo.toml}"
: "${REVIEW_LENS_TIMEOUT:=900}"

# Join a one-path-per-line file into "a, b, c" for a log line or a comment.
# (`paste -sd', '` would NOT do this: paste treats the operand as a cycling
# list of one-character delimiters, so it emits "a,b c".)
list_inline() {
  [ -s "$1" ] || { printf 'none'; return 0; }
  paste -sd, "$1" | sed 's/,/, /g'
}

usage() {
  printf 'usage: review.sh [--dry-run] <pr-number>\n'
  printf '  --dry-run   run all three lenses and print exit code + verdict +\n'
  printf '              reasons, but post no comment, apply no label, merge\n'
  printf '              nothing. Lenses still cost spawns.\n'
}

# ------------------------------------------------------------- arguments ----
# Flags are accepted in any position: `review.sh --dry-run 85` and
# `review.sh 85 --dry-run` are the same command.
PR=""
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run)   DRY_RUN=1 ;;
    -h|--help)   usage; exit 0 ;;
    ''|*[!0-9]*) usage >&2; die "unrecognised argument: '$arg'" ;;
    *)           [ -z "$PR" ] || { usage >&2; die "more than one PR number given"; }
                 PR="$arg" ;;
  esac
done
[ -n "$PR" ] || { usage >&2; die "no PR number given"; }

stop_requested && { log "STOP_FACTORY present — not reviewing."; exit 0; }
have_gh || die "gh CLI required"

GH_ARGS=()
mapfile -t GH_ARGS < <(gh_repo_args)

log "=== fresh-context review of PR #$PR ==="
[ "$DRY_RUN" = "1" ] && log "DRY RUN: lenses will run; nothing will be posted, labelled or merged."

WORK="$(mktemp -d)"        # reviewers run here: outside the repo, no CLAUDE.md
PRREF="refs/factory-review/pr-$PR"
BODY_FILE="$WORK/issue.md"

# shellcheck disable=SC2317  # invoked via trap
cleanup() {
  git -C "$REPO_DIR" update-ref -d "$PRREF" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

# ------------------------------------------------------- build the diffs ----
# The review diff is built with a real git pathspec filter, not a line grep on
# the unified diff. That means fetching the PR head into a private ref and
# diffing it against the base branch with `:(exclude,glob)` pathspecs, so
# exclusion happens at the file level in git itself and cannot mis-slice a hunk.
EXCLUDE_SPECS=()
MANIFEST_SPECS=()
MANIFEST_EXCLUDE_SPECS=()
read -r -a _globs <<< "$REVIEW_EXCLUDE_GLOBS"
for g in "${_globs[@]}"; do EXCLUDE_SPECS+=( ":(exclude,glob)$g" ); done
read -r -a _mglobs <<< "$REVIEW_MANIFEST_GLOBS"
for g in "${_mglobs[@]}"; do
  MANIFEST_SPECS+=( ":(glob)$g" )
  MANIFEST_EXCLUDE_SPECS+=( ":(exclude,glob)$g" )
done

BASE_REF="$(gh pr view "$PR" --json baseRefName --jq .baseRefName "${GH_ARGS[@]}" 2>/dev/null || true)"
[ -n "$BASE_REF" ] || BASE_REF="$BASE_BRANCH"

DIFF_MODE="filtered"
if git -C "$REPO_DIR" fetch --quiet --no-tags origin \
      "+refs/pull/$PR/head:$PRREF" \
      "+refs/heads/$BASE_REF:refs/remotes/origin/$BASE_REF" 2>"$WORK/fetch.err"; then
  RANGE="refs/remotes/origin/$BASE_REF...$PRREF"
  git -C "$REPO_DIR" diff --no-color "$RANGE"                                  > "$WORK/raw.diff"
  git -C "$REPO_DIR" diff --name-only "$RANGE"                                 > "$WORK/allfiles.txt"
  git -C "$REPO_DIR" diff --no-color "$RANGE" -- "${EXCLUDE_SPECS[@]}" \
                                                "${MANIFEST_EXCLUDE_SPECS[@]}" > "$WORK/filtered.diff"
  git -C "$REPO_DIR" diff --no-color "$RANGE" -- "${MANIFEST_SPECS[@]}"        > "$WORK/manifests.diff"
  git -C "$REPO_DIR" diff --name-only "$RANGE" -- "${EXCLUDE_SPECS[@]}"        > "$WORK/kept.txt"
  comm -23 <(sort "$WORK/allfiles.txt") <(sort "$WORK/kept.txt")               > "$WORK/excluded.txt"
else
  # gh works but git could not fetch the PR ref (detached checkout, no origin,
  # restricted network). Rather than pretend, fall back to the unfiltered diff
  # and say so in the prompt: the cap below still bounds it, and the coverage
  # note still tells the reviewer exactly what it is not seeing.
  warn "git fetch of refs/pull/$PR/head failed — falling back to an UNFILTERED diff"
  warn "$(head -3 "$WORK/fetch.err" | tr '\n' ' ')"
  DIFF_MODE="unfiltered-fallback"
  gh pr diff "$PR" "${GH_ARGS[@]}" > "$WORK/raw.diff" 2>/dev/null \
    || die "could not fetch diff for PR #$PR (neither git nor gh could produce one)"
  gh pr diff "$PR" --name-only "${GH_ARGS[@]}" > "$WORK/allfiles.txt" 2>/dev/null || true
  cp "$WORK/raw.diff" "$WORK/filtered.diff"
  : > "$WORK/manifests.diff"
  : > "$WORK/excluded.txt"
fi

[ -s "$WORK/allfiles.txt" ] || die "PR #$PR has an empty diff"

RAW_LINES=$(wc -l < "$WORK/raw.diff")
FILTERED_LINES=$(wc -l < "$WORK/filtered.diff")
EXCLUDED_N=$(grep -c '' "$WORK/excluded.txt" 2>/dev/null || echo 0)

# ---------------------------------------------------------- the line cap ----
# Even after exclusion a diff can be enormous. Truncate at FILE BOUNDARIES so
# the reviewer never sees half a hunk, and record exactly which files fell off
# the end. Silent truncation would be worse than no truncation: it reads as
# full coverage when it is not.
: > "$WORK/omitted.txt"
awk -v cap="$MAX_REVIEW_DIFF_LINES" -v omit="$WORK/omitted.txt" '
function flush(   i, lim) {
  if (nrec == 0) return
  if (!stopped && total + nrec <= cap) {
    for (i = 1; i <= nrec; i++) print rec[i]
    total += nrec; nrec = 0; return
  }
  # A single file larger than the whole cap: emit a prefix of it rather than
  # nothing at all, and declare it partial.
  if (!stopped && total == 0) {
    lim = cap
    for (i = 1; i <= lim; i++) print rec[i]
    total = cap; stopped = 1; nrec = 0
    print curfile " (cut mid-file)" > omit
    return
  }
  stopped = 1; nrec = 0
  print curfile > omit
}
/^diff --git / {
  flush()
  curfile = $0
  sub(/^diff --git a\//, "", curfile)
  sub(/ b\/.*$/, "", curfile)
}
{ rec[++nrec] = $0 }
END { flush() }
' "$WORK/filtered.diff" > "$WORK/review.diff"

REVIEW_LINES=$(wc -l < "$WORK/review.diff")
TRUNCATED=0
[ -s "$WORK/omitted.txt" ] && TRUNCATED=1

log "diff: raw $RAW_LINES lines -> filtered $FILTERED_LINES -> review $REVIEW_LINES (mode: $DIFF_MODE)"
log "$EXCLUDED_N file(s) excluded as generated/vendored; names still shown to every lens"
if [ "$TRUNCATED" = "1" ]; then
  warn "REVIEW DIFF TRUNCATED at $MAX_REVIEW_DIFF_LINES lines — coverage is PARTIAL."
  warn "omitted files: $(tr '\n' ' ' < "$WORK/omitted.txt")"
  warn "raise MAX_REVIEW_DIFF_LINES in factory/config.env to widen coverage"
fi

# ------------------------------------------------------------ the issue -----
# Resolve the issue this PR closes, so spec-conformance has something to judge
# the diff AGAINST. Without the issue text that lens is meaningless.
PRBODY="$(gh pr view "$PR" --json body --jq .body "${GH_ARGS[@]}" 2>/dev/null || true)"
ISSUE="$(printf '%s' "$PRBODY" | grep -oiE '(closes|fixes|resolves) #[0-9]+' | grep -oE '[0-9]+' | head -1)"
if [ -n "$ISSUE" ]; then
  gh issue view "$ISSUE" --json title,body \
    --jq '"# " + .title + "\n\n" + .body' "${GH_ARGS[@]}" > "$BODY_FILE" 2>/dev/null \
    || printf '(issue #%s could not be fetched)\n' "$ISSUE" > "$BODY_FILE"
  log "PR #$PR closes issue #$ISSUE"
else
  printf '(this PR does not reference an issue)\n' > "$BODY_FILE"
  warn "PR #$PR has no linked issue — spec-conformance review will be weaker"
fi

# ---------------------------------------------------- the shared material ---
# Built once and reused by all three lenses: identical evidence, three lenses.
MATERIAL="$WORK/material.txt"
{
  printf '================ CHANGED FILES IN THIS PR (COMPLETE LIST) ================\n'
  printf 'Every file the PR touches is listed here, including files whose diff body\n'
  printf 'was withheld. Nothing is hidden from you at the NAME level.\n\n'
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    if grep -qxF "$f" "$WORK/excluded.txt" 2>/dev/null; then
      printf '  %s   [generated/vendored — diff body excluded]\n' "$f"
    elif grep -qF "$f" "$WORK/omitted.txt" 2>/dev/null; then
      printf '  %s   [diff body omitted by truncation]\n' "$f"
    else
      printf '  %s\n' "$f"
    fi
  done < "$WORK/allfiles.txt"

  printf '\n================ DEPENDENCY MANIFEST CHANGES (COMPLETE, NEVER TRUNCATED) ================\n'
  if [ -s "$WORK/manifests.diff" ]; then
    printf 'Lockfile bodies are excluded above, so dependency changes are reproduced\n'
    printf 'here IN FULL. A new or bumped dependency is reviewable from this section\n'
    printf 'alone — treat an unjustified dependency addition as a finding.\n\n'
    cat "$WORK/manifests.diff"
  else
    printf '(no package.json / Cargo.toml changes in this PR)\n'
  fi

  printf '\n================ COVERAGE NOTE — READ BEFORE JUDGING COMPLETENESS ================\n'
  case "$DIFF_MODE" in
    filtered)
      printf 'The diff below excludes generated and vendored files (lockfiles, minified\n'
      printf 'bundles, build output, source maps, chain snapshots). This is a file-level\n'
      printf 'git pathspec exclusion; no hunk is partially removed.\n' ;;
    *)
      printf 'WARNING: generated/vendored exclusion was UNAVAILABLE for this run (the PR\n'
      printf 'ref could not be fetched). The diff below is unfiltered.\n' ;;
  esac
  if [ "$EXCLUDED_N" -gt 0 ]; then
    printf '\nExcluded from the diff body (generated/vendored):\n'
    sed 's/^/  - /' "$WORK/excluded.txt"
  fi
  if [ "$TRUNCATED" = "1" ]; then
    printf '\ndiff truncated at %s lines; omitted files: %s\n' \
      "$MAX_REVIEW_DIFF_LINES" "$(list_inline "$WORK/omitted.txt")"
    printf '\nCOVERAGE IS PARTIAL. Judge the material you were actually given. Partial\n'
    printf 'coverage is not by itself a reason to FAIL; base your verdict on what is\n'
    printf 'visible, and state explicitly in your reasons which files you could not\n'
    printf 'see and what you therefore could not check.\n'
  else
    printf '\nNo truncation: every non-excluded file is shown in full below.\n'
  fi

  printf '\n================ ISSUE THE PR CLAIMS TO CLOSE ================\n'
  cat "$BODY_FILE"
  printf '\n================ REVIEW DIFF (PR #%s) ================\n' "$PR"
  if [ -s "$WORK/review.diff" ]; then
    cat "$WORK/review.diff"
  else
    printf '(no reviewable non-generated changes — see the file list and manifests above)\n'
  fi
  printf '\n================ END OF MATERIAL ================\n'
} > "$MATERIAL"

# --------------------------------------------------------------- the lenses --
lens_prompt() {
  case "$1" in
  correctness)
    cat <<'EOF'
LENS: CORRECTNESS AND SECURITY.

You are reviewing a diff from an autonomous agent on a Substrate/Polkadot SDK
blockchain (Scalar Commons) whose native token has a hard 100B supply cap.

Hunt specifically for:
  - Arithmetic that can overflow, underflow, or truncate. On this chain ALL
    balance arithmetic must use saturating_* or checked_*; a bare + - * on a
    Balance is a defect.
  - Any path that could mint beyond the supply cap, or mint outside the
    emissions pallet.
  - Guards that fire AFTER funds move rather than before (ensure! must precede
    reserve/transfer/mint).
  - Removed or weakened economic guards: self-link checks, minimum-volume
    floors, bonus caps, double-settlement guards.
  - A privileged/root caller introduced into an economically essential path
    (era settlement and reward claims must stay permissionless).
  - Panics, unwraps, or indexing that a hostile caller can reach.
  - Storage layout changes with no migration and no spec_version bump.
  - Off-by-one and boundary errors; incorrect rounding direction (rounding must
    never favour the claimant).

Be concrete: cite the file and the line from the diff. Do not speculate about
code you cannot see; judge what the diff actually does. If the diff is correct
and safe, say so plainly — a clean PASS is a valid and useful outcome.
EOF
    ;;
  conformance)
    cat <<'EOF'
LENS: SPEC CONFORMANCE — does the diff do what the issue asked, and NOTHING MORE?

Two failure modes, both of which you must treat as FAIL:
  1. UNDER-DELIVERY: the issue asked for something the diff does not do, or
     does only partially, or fakes (a stub that satisfies a signature without
     implementing behaviour).
  2. SCOPE CREEP: the diff changes things the issue never asked for —
     opportunistic refactors, renames, reformatting of untouched code, new
     dependencies, unrelated files, "while I was here" edits. In an autonomous
     factory, unrequested change is unreviewed risk, so it is a defect even
     when the change looks like an improvement.

The CHANGED FILES list and the DEPENDENCY MANIFEST CHANGES section are complete
even where the diff body is not: use them to judge scope creep and new
dependencies, which are exactly the things a truncated diff would otherwise
hide.

Go requirement by requirement through the issue and state, for each, whether
the diff satisfies it, citing diff lines. Then list every change in the diff
that no requirement asked for.

Judge only the issue text and the diff. If the issue is ambiguous, say which
reading you applied.
EOF
    ;;
  standing)
    cat <<'EOF'
LENS: STANDING-RULE VIOLATIONS.

The single standing rule of this factory:
  NEVER make a check pass by weakening code.

An agent under gate pressure has a cheap escape: make the check stop checking.
Your only job is to find every instance. List EVERY OCCURRENCE with file and
line — not a sample, not "several instances", every one.

Search the diff for:
  - Tests deleted, renamed away, commented out, #[ignore]d, skipped,
    it.skip/xit/describe.skip, or otherwise removed from execution.
  - Assertions weakened: assert_eq! -> assert!, a tightened bound loosened, an
    exact value replaced by a range or a truthiness check, an expected error
    changed to accept anything.
  - todo!(), unimplemented!(), unreachable!() used as an implementation, empty
    function bodies, `fn main() {}` in node/ or runtime/ paths.
  - #[allow(...)] or eslint-disable added to silence a lint rather than fix it.
  - SKIP_WASM_BUILD, or build steps disabled/short-circuited.
  - The gate or CI config itself relaxed: test commands narrowed, --no-run
    added, workspace scope reduced, failing checks removed, timeouts inflated
    to mask hangs, `|| true` appended to a failing command.
  - Error handling replaced by silent swallowing (empty catch, `let _ =`,
    unwrap_or_default hiding a real failure).

If you find NONE of these, that is a legitimate PASS; say so explicitly. If you
find even one, it is a FAIL. There is no severity threshold for this lens.
EOF
    ;;
  esac
}

VERDICT_FMT='
Finish your response with a final line that is EXACTLY one of:
VERDICT: PASS
VERDICT: FAIL
Nothing after it. If you are uncertain about the CODE, choose FAIL and explain
the doubt. Uncertainty caused by material you were not given is not a reason to
FAIL — say what you could not see instead.
Before that line, give your reasons concisely, citing file:line from the diff.'

# ------------------------------------------------------- verdict parsing ----
# Robust against the ways a model actually writes the line: markdown emphasis
# (**VERDICT: PASS**), stray whitespace, lower case. Requires the colon form, so
# prose like "the verdict was a fail" cannot be mistaken for a verdict line.
# The LAST match wins — a model that reconsiders mid-answer is taken at its
# final word. Only ever run against the model's captured stdout.
parse_verdict() {
  local f="$1" m
  [ -s "$f" ] || return 0
  m="$(grep -oiE 'verdict[[:space:]]*:[[:space:]]*[*_[:space:]]{0,6}(pass|fail)' "$f" | tail -1)"
  [ -n "$m" ] || return 0
  case "$(printf '%s' "$m" | tr '[:upper:]' '[:lower:]')" in
    *pass) printf 'PASS' ;;
    *fail) printf 'FAIL' ;;
  esac
}

# run_lens <name>
#
# Writes, and returns nothing on stdout:
#   $WORK/<name>.out     the model's stdout, verbatim
#   $WORK/<name>.err     the model's stderr, verbatim
#   $WORK/<name>.rc      the exit code of the claude call (-1 = never invoked)
#   $WORK/<name>.result  PASS | FAIL | ERROR
#   $WORK/<name>.note    why, when the result is ERROR
#
# Results travel in files ON PURPOSE. This function logs, log() writes to
# stdout, and a stdout-returned verdict would be silently concatenated with
# those log lines by the caller's command substitution — which is exactly the
# bug that kept the tally pinned at 0 PASS / 0 FAIL. See the header.
run_lens() {
  local name="$1"
  local out="$WORK/$name.out"
  local err="$WORK/$name.err"
  local pf="$WORK/$name.prompt"
  local rc v
  : > "$out"; : > "$err"; : > "$WORK/$name.note"

  {
    printf 'You are a strict, adversarial code reviewer. You were given no\n'
    printf 'context other than what follows. Judge only this material.\n\n'
    lens_prompt "$name"
    printf '\n%s\n\n' "$VERDICT_FMT"
    cat "$MATERIAL"
  } > "$pf"

  # Each lens is its own `claude -p` process, so each lens costs. A review is
  # three spawns, not one, and is charged as three — including under --dry-run,
  # which runs the models for real and only withholds the side effects.
  if ! spend_reserve "review:pr-$PR:lens-$name"; then
    spend_refusal "review lens $name for PR #$PR" >&2
    warn "lens $name not run — daily spawn cap. Recording ERROR (not FAIL): no"
    warn "review happened, so there is nothing to pass or fail."
    printf '%s\n' "-1" > "$WORK/$name.rc"
    printf 'ERROR\n'    > "$WORK/$name.result"
    printf 'lens not run: daily spawn cap reached (%s/%s). No verdict was formed.\n' \
      "$(spend_count)" "$DAILY_SPAWN_CAP" > "$WORK/$name.note"
    return 0
  fi

  log "running lens: $name ($(wc -l < "$pf")-line prompt, $(wc -c < "$pf") bytes)"

  # Fresh process, fresh context, run OUTSIDE the repo so no CLAUDE.md or repo
  # files leak in. --dangerously-skip-permissions keeps it non-interactive; the
  # reviewer has nothing to write anyway.
  #
  # THE PROMPT GOES ON STDIN. Never `claude -p "$(cat "$pf")"`: a prompt over
  # 131072 bytes makes execve() fail with E2BIG and the lens never runs.
  ( cd "$WORK" && timeout "$REVIEW_LENS_TIMEOUT" claude -p --dangerously-skip-permissions ) \
    < "$pf" > "$out" 2> "$err"
  rc=$?
  printf '%s\n' "$rc" > "$WORK/$name.rc"

  if looks_rate_limited "$err" || looks_rate_limited "$out"; then
    warn "lens $name hit a rate limit — engaging back-off"
    start_backoff "$BACKOFF_MINUTES"
  fi

  # A call that did not complete produced no judgement. Recording that as FAIL
  # would invent an objection the model never made; recording it as PASS would
  # be worse. It is ERROR, and it makes the whole review INCONCLUSIVE.
  if [ "$rc" -ne 0 ]; then
    warn "lens $name: claude exited $rc — recording ERROR, not FAIL"
    printf 'ERROR\n' > "$WORK/$name.result"
    {
      printf 'claude -p exited %s (timeout was %ss).\n' "$rc" "$REVIEW_LENS_TIMEOUT"
      [ "$rc" = "124" ] && printf 'Exit 124 is the timeout killing the call.\n'
      [ "$rc" = "126" ] && printf 'Exit 126 is an exec failure — check prompt size and the claude binary.\n'
      printf 'stdout captured: %s bytes. stderr (first 20 lines):\n' "$(wc -c < "$out")"
      head -20 "$err"
    } > "$WORK/$name.note"
    return 0
  fi

  v="$(parse_verdict "$out")"
  if [ -z "$v" ]; then
    warn "lens $name: exit 0 but no parseable VERDICT line — recording ERROR, not FAIL"
    printf 'ERROR\n' > "$WORK/$name.result"
    {
      printf 'claude -p exited 0 but produced no parseable "VERDICT: PASS|FAIL" line.\n'
      printf 'stdout captured: %s bytes. Last 20 lines of stdout:\n' "$(wc -c < "$out")"
      tail -20 "$out"
    } > "$WORK/$name.note"
    return 0
  fi

  printf '%s\n' "$v" > "$WORK/$name.result"
  return 0
}

LENSES=(correctness conformance standing)
declare -A VERDICT=()
declare -A RC=()
PASSES=0
FAILS=0
ERRORS=0

for l in "${LENSES[@]}"; do
  run_lens "$l"
  VERDICT[$l]="$(cat "$WORK/$l.result" 2>/dev/null || echo ERROR)"
  RC[$l]="$(cat "$WORK/$l.rc" 2>/dev/null || echo '?')"
  case "${VERDICT[$l]}" in
    PASS) PASSES=$((PASSES+1)) ;;
    FAIL) FAILS=$((FAILS+1))   ;;
    *)    ERRORS=$((ERRORS+1)) ;;
  esac
  log "lens $l => ${VERDICT[$l]} (claude exit ${RC[$l]})"
done

# An incomplete review is never a pass. agent-reviewed additionally requires
# that every lens actually ran.
if [ "$ERRORS" -gt 0 ]; then
  STATUS="INCONCLUSIVE"
elif [ "$FAILS" -gt 0 ]; then
  STATUS="FAIL"
elif [ "$PASSES" -ge 2 ]; then
  STATUS="PASS"
else
  STATUS="INCONCLUSIVE"
fi
log "review status: $STATUS ($PASSES PASS / $FAILS FAIL / $ERRORS ERROR)"

# ------------------------------------------------------------- dry run ------
if [ "$DRY_RUN" = "1" ]; then
  printf '\n===== DRY RUN — PR #%s — nothing posted, labelled, or merged =====\n' "$PR"
  printf 'diff:   raw %s lines -> filtered %s -> review %s  (mode: %s)\n' \
    "$RAW_LINES" "$FILTERED_LINES" "$REVIEW_LINES" "$DIFF_MODE"
  printf 'excluded as generated/vendored: %s file(s)\n' "$EXCLUDED_N"
  if [ "$TRUNCATED" = "1" ]; then
    printf 'TRUNCATED at %s lines; omitted: %s\n' \
      "$MAX_REVIEW_DIFF_LINES" "$(list_inline "$WORK/omitted.txt")"
  else
    printf 'not truncated\n'
  fi
  for l in "${LENSES[@]}"; do
    printf '\n--- lens %s: exit=%s verdict=%s ---\n' "$l" "${RC[$l]}" "${VERDICT[$l]}"
    if [ -s "$WORK/$l.note" ]; then
      printf 'note:\n'; sed 's/^/  /' "$WORK/$l.note"
    fi
    printf 'reasons (last 40 lines of the model stdout):\n'
    if [ -s "$WORK/$l.out" ]; then tail -40 "$WORK/$l.out" | sed 's/^/  /'; else printf '  (no stdout)\n'; fi
  done
  printf '\n===== DRY RUN SUMMARY: %s PASS / %s FAIL / %s ERROR => %s =====\n' \
    "$PASSES" "$FAILS" "$ERRORS" "$STATUS"
  printf 'WOULD: post a verdict comment on PR #%s\n' "$PR"
  [ "$PASSES" -ge 2 ] && [ "$ERRORS" -eq 0 ] && printf 'WOULD: label agent-reviewed\n'
  { [ "$FAILS" -gt 0 ] || [ "$ERRORS" -gt 0 ]; } && printf 'WOULD: label needs-human\n'
  printf 'WOULD NOT: merge — review.sh has no merge path, under any flag\n'
  case "$STATUS" in PASS) exit 0 ;; FAIL) exit 1 ;; *) exit 2 ;; esac
fi

# ------------------------------------------------------------- publish ------
# Literal Markdown backtick, passed as a printf ARGUMENT so format strings stay
# free of characters the shell would interpret.
BT='`'
COMMENT="$WORK/comment.md"
{
  printf '## Fresh-context adversarial review — PR #%s\n\n' "$PR"
  printf 'Three independent %sclaude -p%s reviewers, each a separate process with a\n' "$BT" "$BT"
  printf 'fresh context, each given the complete changed-file list, the complete\n'
  printf 'dependency-manifest diff, a generated-file-filtered review diff, the linked\n'
  printf 'issue body, and one lens.\n\n'
  printf '| Lens | Verdict | claude exit |\n|---|---|---|\n'
  for l in "${LENSES[@]}"; do
    printf '| %s | **%s** | %s |\n' "$l" "${VERDICT[$l]}" "${RC[$l]}"
  done
  printf '\n**Tally: %s PASS / %s FAIL / %s ERROR — status %s.**\n\n' \
    "$PASSES" "$FAILS" "$ERRORS" "$STATUS"
  if [ "$ERRORS" -gt 0 ]; then
    printf '> **INCONCLUSIVE.** %s lens/lenses did not produce a judgement, so this PR\n' "$ERRORS"
    printf '> has NOT been reviewed. It is not labelled %sagent-reviewed%s and it is\n' "$BT" "$BT"
    printf '> labelled %sneeds-human%s. A reviewer that cannot review does not pass.\n\n' "$BT" "$BT"
  fi
  printf '**Diff coverage:** raw %s lines -> %s after excluding generated/vendored -> %s reviewed (mode: %s).\n' \
    "$RAW_LINES" "$FILTERED_LINES" "$REVIEW_LINES" "$DIFF_MODE"
  if [ "$EXCLUDED_N" -gt 0 ]; then
    printf 'Excluded from the diff body (names and manifest diffs were still reviewed): %s\n' \
      "$(list_inline "$WORK/excluded.txt")"
  fi
  if [ "$TRUNCATED" = "1" ]; then
    printf '\n> **Partial coverage:** diff truncated at %s lines; omitted files: %s\n' \
      "$MAX_REVIEW_DIFF_LINES" "$(list_inline "$WORK/omitted.txt")"
  fi
  printf '\n'
  for l in "${LENSES[@]}"; do
    printf '<details><summary>%s — %s</summary>\n\n```\n' "$l" "${VERDICT[$l]}"
    [ -s "$WORK/$l.note" ] && cat "$WORK/$l.note"
    tail -c 25000 "$WORK/$l.out"
    printf '\n```\n\n</details>\n\n'
  done
  printf -- '---\n*Posted by %sfactory/review.sh%s. This tool never merges.*\n' "$BT" "$BT"
} > "$COMMENT"

if gh pr comment "$PR" --body-file "$COMMENT" "${GH_ARGS[@]}" >/dev/null 2>&1; then
  log "posted verdict comment to PR #$PR"
else
  warn "could not post comment to PR #$PR"
fi

if [ "$PASSES" -ge 2 ] && [ "$ERRORS" -eq 0 ]; then
  if gh pr edit "$PR" --add-label agent-reviewed "${GH_ARGS[@]}" >/dev/null 2>&1; then
    log "labelled PR #$PR agent-reviewed ($PASSES/3 PASS)"
  else
    warn "could not add agent-reviewed (does the label exist? run bootstrap-labels.sh)"
  fi
elif [ "$PASSES" -ge 2 ]; then
  log "NOT labelling agent-reviewed: $ERRORS lens/lenses errored, so the review is incomplete"
fi

if [ "$FAILS" -gt 0 ] || [ "$ERRORS" -gt 0 ]; then
  gh pr edit "$PR" --add-label needs-human "${GH_ARGS[@]}" >/dev/null 2>&1 \
    || warn "could not add needs-human label"
  {
    if [ "$FAILS" -gt 0 ]; then
      printf '### Unresolved objections — human review required\n\n'
      printf '%s of 3 lenses returned FAIL. Regardless of the tally, a FAIL means an\n' "$FAILS"
      printf 'unresolved objection, so this PR is labelled %sneeds-human%s and\n' "$BT" "$BT"
      printf '%sfactory/merge.sh%s will refuse it.\n\n' "$BT" "$BT"
    fi
    if [ "$ERRORS" -gt 0 ]; then
      printf '### Review INCONCLUSIVE — human review required\n\n'
      printf '%s of 3 lenses failed to produce a judgement. This is not a finding\n' "$ERRORS"
      printf 'against the PR; it is a failure of the reviewer, and it means the PR is\n'
      printf 'unreviewed. Re-run %sfactory/review.sh %s%s once the cause below is fixed.\n\n' "$BT" "$PR" "$BT"
    fi
    for l in "${LENSES[@]}"; do
      case "${VERDICT[$l]}" in
        FAIL)
          printf '#### %s — FAIL\n\n```\n' "$l"
          tail -c 15000 "$WORK/$l.out"
          printf '\n```\n\n' ;;
        PASS) : ;;
        *)
          printf '#### %s — ERROR (claude exit %s)\n\n```\n' "$l" "${RC[$l]}"
          cat "$WORK/$l.note"
          printf '\n```\n\n' ;;
      esac
    done
  } > "$WORK/objections.md"
  gh pr comment "$PR" --body-file "$WORK/objections.md" "${GH_ARGS[@]}" >/dev/null 2>&1 || true
  log "PR #$PR flagged needs-human ($FAILS FAIL, $ERRORS ERROR)"
  [ "$ERRORS" -gt 0 ] && exit 2
  exit 1
fi

log "review complete: $PASSES/3 PASS, no objections. review.sh does not merge."
exit 0
