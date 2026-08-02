#!/usr/bin/env bash
# factory/review.sh — fresh-context adversarial review of a factory PR.
#
#   ./factory/review.sh <pr-number>
#
# Runs THREE separate `claude -p` calls, one per lens. Each is a brand-new
# process with a fresh context and is handed ONLY:
#   - the PR diff (gh pr diff)
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
# Verdicts: every lens must end with exactly "VERDICT: PASS" or "VERDICT: FAIL".
# A missing or unparseable verdict counts as FAIL — fail closed.
#
#   >=2 PASS  -> comment all three verdicts + label agent-reviewed
#   any FAIL  -> label needs-human + comment the objections
#
# Those two rules can BOTH apply (2 PASS + 1 FAIL). That is deliberate: the PR
# records that it cleared the bar AND that an unresolved objection exists.
# merge.sh requires agent-reviewed AND no needs-human, so any FAIL blocks the
# merge while preserving the audit trail.
#
# review.sh NEVER MERGES. It has no merge code path at all.

set -uo pipefail

FACTORY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR
# shellcheck source=lib/common.sh
. "$FACTORY_DIR/lib/common.sh"

PR="${1:-}"
DRY_RUN=0
[ "${2:-}" = "--dry-run" ] && DRY_RUN=1
case "$PR" in
  ''|*[!0-9]*) die "usage: review.sh <pr-number> [--dry-run]" ;;
esac

stop_requested && { log "STOP_FACTORY present — not reviewing."; exit 0; }
have_gh || die "gh CLI required"

GH_ARGS=()
mapfile -t GH_ARGS < <(gh_repo_args)

log "=== fresh-context review of PR #$PR ==="

DIFF_FILE="$(mktemp)"
BODY_FILE="$(mktemp)"
WORK="$(mktemp -d)"     # reviewers run here: outside the repo, no CLAUDE.md
# shellcheck disable=SC2317  # invoked via trap
cleanup() { rm -rf "$DIFF_FILE" "$BODY_FILE" "$WORK"; }
trap cleanup EXIT

gh pr diff "$PR" "${GH_ARGS[@]}" > "$DIFF_FILE" 2>/dev/null \
  || die "could not fetch diff for PR #$PR"
[ -s "$DIFF_FILE" ] || die "PR #$PR has an empty diff"

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

DIFF_LINES=$(wc -l < "$DIFF_FILE")
log "diff is $DIFF_LINES lines"

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
Nothing after it. If you are uncertain, choose FAIL and explain the doubt.
Before that line, give your reasons concisely, citing file:line from the diff.'

run_lens() {  # run_lens <name> -> writes $WORK/<name>.out, echoes PASS|FAIL
  # Separate `local` statements: within a single `local`, later initialisers do
  # NOT see earlier ones in this shell, so a combined declaration would build
  # the paths from an empty $name and every lens would overwrite one file.
  local name="$1"
  local out="$WORK/$name.out"
  local pf="$WORK/$name.prompt"
  local v
  {
    printf 'You are a strict, adversarial code reviewer. You were given no\n'
    printf 'context other than what follows. Judge only this material.\n\n'
    lens_prompt "$name"
    printf '\n%s\n\n' "$VERDICT_FMT"
    printf '================ ISSUE THE PR CLAIMS TO CLOSE ================\n'
    cat "$BODY_FILE"
    printf '\n================ PULL REQUEST DIFF (PR #%s) ================\n' "$PR"
    cat "$DIFF_FILE"
    printf '\n================ END OF MATERIAL ================\n'
  } > "$pf"

  if [ "$DRY_RUN" = "1" ]; then
    printf 'WOULD: run lens %s with a %s-line prompt (fresh context, API billed, cwd=%s)\n' \
      "$name" "$(wc -l < "$pf")" "$WORK" >&2
    echo "DRYRUN"
    return 0
  fi

  log "running lens: $name ($(wc -l < "$pf") line prompt)"
  # Fresh process, fresh context, run OUTSIDE the repo so no CLAUDE.md or repo
  # files leak in. --dangerously-skip-permissions keeps it non-interactive; the
  # reviewer has nothing to write anyway.
  ( cd "$WORK" && timeout 900 claude -p "$(cat "$pf")" --dangerously-skip-permissions ) \
    > "$out" 2>"$WORK/$name.err" || warn "lens $name exited non-zero"

  if looks_rate_limited "$WORK/$name.err" || looks_rate_limited "$out"; then
    warn "lens $name hit a rate limit — engaging back-off"
    start_backoff "$BACKOFF_MINUTES"
  fi

  # Fail closed: no parseable verdict means FAIL.
  v="$(grep -oE '^VERDICT: (PASS|FAIL)' "$out" | tail -1 | awk '{print $2}')"
  if [ -z "$v" ]; then
    v="$(grep -oE 'VERDICT: (PASS|FAIL)' "$out" | tail -1 | awk '{print $2}')"
  fi
  if [ -z "$v" ]; then
    warn "lens $name produced no parseable VERDICT — counting as FAIL"
    v="FAIL"
    printf '\n(no parseable VERDICT line; review.sh counted this lens as FAIL)\n' >> "$out"
  fi
  echo "$v"
}

LENSES=(correctness conformance standing)
declare -A VERDICT=()
PASSES=0
FAILS=0

for l in "${LENSES[@]}"; do
  v="$(run_lens "$l")"
  VERDICT[$l]="$v"
  case "$v" in
    PASS)   PASSES=$((PASSES+1)) ;;
    FAIL)   FAILS=$((FAILS+1)) ;;
    DRYRUN) : ;;
  esac
  log "lens $l => $v"
done

if [ "$DRY_RUN" = "1" ]; then
  printf '\nWOULD: post a comment with all three verdicts on PR #%s\n' "$PR"
  printf 'WOULD: label agent-reviewed if >=2 PASS; label needs-human on any FAIL\n'
  printf 'WOULD NOT: merge — review.sh has no merge path\n'
  exit 0
fi

# ------------------------------------------------------------- publish ------
# Literal Markdown backtick, passed as a printf ARGUMENT so format strings stay
# free of characters the shell would interpret.
BT='`'
COMMENT="$WORK/comment.md"
{
  printf '## Fresh-context adversarial review — PR #%s\n\n' "$PR"
  printf 'Three independent %sclaude -p%s reviewers, each a separate process with a\n' "$BT" "$BT"
  printf 'fresh context, each given only the PR diff, the linked issue body, and one\n'
  printf 'lens. A missing verdict counts as FAIL.\n\n'
  printf '| Lens | Verdict |\n|---|---|\n'
  printf '| correctness / security | **%s** |\n' "${VERDICT[correctness]}"
  printf '| spec conformance | **%s** |\n'      "${VERDICT[conformance]}"
  printf '| standing-rule violations | **%s** |\n' "${VERDICT[standing]}"
  printf '\n**Tally: %s PASS / %s FAIL.**\n\n' "$PASSES" "$FAILS"
  for l in "${LENSES[@]}"; do
    printf '<details><summary>%s — %s</summary>\n\n```\n' "$l" "${VERDICT[$l]}"
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

if [ "$PASSES" -ge 2 ]; then
  if gh pr edit "$PR" --add-label agent-reviewed "${GH_ARGS[@]}" >/dev/null 2>&1; then
    log "labelled PR #$PR agent-reviewed ($PASSES/3 PASS)"
  else
    warn "could not add agent-reviewed (does the label exist? run bootstrap-labels.sh)"
  fi
fi

if [ "$FAILS" -gt 0 ]; then
  gh pr edit "$PR" --add-label needs-human "${GH_ARGS[@]}" >/dev/null 2>&1 \
    || warn "could not add needs-human label"
  {
    printf '### Unresolved objections — human review required\n\n'
    printf '%s of 3 lenses returned FAIL. Regardless of the tally, a FAIL means an\n' "$FAILS"
    printf 'unresolved objection, so this PR is labelled %sneeds-human%s and\n' "$BT" "$BT"
    printf '%sfactory/merge.sh%s will refuse it.\n\n' "$BT" "$BT"
    for l in "${LENSES[@]}"; do
      if [ "${VERDICT[$l]}" = "FAIL" ]; then
        printf '#### %s\n\n```\n' "$l"
        tail -c 15000 "$WORK/$l.out"
        printf '\n```\n\n'
      fi
    done
  } > "$WORK/objections.md"
  gh pr comment "$PR" --body-file "$WORK/objections.md" "${GH_ARGS[@]}" >/dev/null 2>&1 || true
  log "PR #$PR flagged needs-human ($FAILS FAIL)"
  exit 1
fi

log "review complete: $PASSES/3 PASS, no objections. review.sh does not merge."
exit 0
