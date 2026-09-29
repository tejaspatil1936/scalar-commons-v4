#!/usr/bin/env bash
# factory/tests/model-routing.sh — prove the agent/lens model choice is routed
# by RISK, not by chance.
#
# Why this deserves a test of its own.
#
# Every `claude -p` in this system used to run on whatever model the CLI
# happened to default to. That is a silent, unbounded policy: the model that
# writes a consensus-critical pallet diff is chosen by a default that can change
# under us in a CLI release, and nothing anywhere records which model produced a
# given commit. The routing rule is therefore stated in code, with a default of
# `sonnet` and an escalation to `opus` for exactly one reason — the work touches
# `runtime/` or `pallets/`, the two directories where a mistake is a chain
# mistake rather than a script mistake.
#
# The failure mode this test guards against is quiet DOWNGRADE: a path-matching
# bug that sends a runtime diff to the cheap model would not fail anything, not
# log anything, and not show up in any gate. It would just make the most
# dangerous reviews the weakest ones. So every assertion below is written so
# that the *unsafe* direction is the one that turns this test red.
#
# This test drives common.sh's real functions. It keeps no copy of their logic
# (see verdict-parse.sh's header for why that rule exists), makes no API call,
# and spends no budget.

set -uo pipefail

TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FACTORY_DIR="$(cd "$TESTS_DIR/.." && pwd)"

PASS=0
FAIL=0
ok()  { PASS=$((PASS+1)); printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf '  \033[31mFAIL\033[0m  %s\n' "$1"; }

# Source the library under test. common.sh expects to be sourced by a script
# inside factory/, and reads config.env; both hold here.
# shellcheck source=../lib/common.sh
# The router reads FACTORY_MODEL. An operator with it exported would otherwise
# get false reds here (flagged by two lenses on PR #251), so the ambient value is
# cleared for the whole run and restored only inside the override section.
unset FACTORY_MODEL

. "$FACTORY_DIR/lib/common.sh" >/dev/null 2>&1 || {
  printf 'FATAL: could not source %s/lib/common.sh\n' "$FACTORY_DIR" >&2; exit 1; }

for fn in paths_are_critical pick_model; do
  if ! declare -F "$fn" >/dev/null; then
    printf 'FATAL: %s() is not defined by lib/common.sh\n' "$fn" >&2; exit 1
  fi
done

T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT

# ---------------------------------------------------------------------------
# 1. paths_are_critical — the predicate, fed a path list on stdin.
#
# Exit 0 means "critical" (escalate to opus). The cases below are the ones that
# have actually appeared in this repo's diffs, plus the near-misses that a naive
# substring match gets wrong in the UNSAFE direction.
# ---------------------------------------------------------------------------
printf '\n1. paths_are_critical\n'

crit() { # crit <label> <expect: yes|no> <paths...>
  local label="$1" expect="$2"; shift 2
  local got rc
  printf '%s\n' "$@" | paths_are_critical; rc=$?
  [ "$rc" -eq 0 ] && got=yes || got=no
  if [ "$got" = "$expect" ]; then ok "$label -> $got"
  else bad "$label -> $got (expected $expect)"; fi
}

crit "runtime/src/lib.rs"                      yes runtime/src/lib.rs
crit "pallets/emissions/src/lib.rs"            yes pallets/emissions/src/lib.rs
crit "runtime/ among many files"               yes README.md indexer/src/api.js runtime/src/governance/mod.rs
crit "pallets/ among many files"               yes sdk/src/index.ts pallets/escrow/src/tests.rs
crit "docs only"                               no  docs/internal/INSTRUCTIONS-F-spec308.md
crit "indexer + sdk only"                      no  indexer/tests/live.test.ts sdk/src/messaging.ts
crit "empty list"                              no  ""

# Near-misses. Each of these WOULD match a bare `grep runtime` or `grep pallets`
# and would therefore be silently escalated (cost, not safety) — or, worse for
# the reverse spelling, a rule anchored too loosely would let a real runtime
# path hide behind an unrelated prefix.
crit "node/src/runtime_spec.rs (not runtime/)"  no  node/src/runtime_spec.rs
crit "docs/runtime-notes.md (not runtime/)"     no  docs/runtime-notes.md
crit "tests/pallets-overview.md (not pallets/)" no  tests/pallets-overview.md
crit "a path ENDING in runtime/src/lib.rs"      no  vendor/other-chain/runtime/src/lib.rs

# ---------------------------------------------------------------------------
# 2. pick_model — the decision an invocation actually uses.
#
#   pick_model <changed-paths-file> [prompt-file]
#
# Returns the model name on stdout. The prompt file is a SECOND signal, and it
# matters for the first attempt of a task: at that point the worktree diff is
# empty because the agent has not written anything yet, so the only evidence of
# where the work will land is the instruction it was given.
# ---------------------------------------------------------------------------
printf '\n2. pick_model\n'

pm() { # pm <label> <expect> <paths-file> [prompt-file]
  local label="$1" expect="$2"; shift 2
  local got; got="$(pick_model "$@")"
  if [ "$got" = "$expect" ]; then ok "$label -> $got"
  else bad "$label -> $got (expected $expect)"; fi
}

printf 'runtime/src/lib.rs\n'  > "$T/crit.paths"
printf 'sdk/src/index.ts\n'    > "$T/safe.paths"
: > "$T/empty.paths"

printf 'Edit indexer/src/api.js to add an endpoint.\n' > "$T/safe.prompt"
cat > "$T/crit.prompt" <<'EOP'
Add a MinQualifyingVol floor gate to pallets/emissions/src/lib.rs and update
every test mock.
EOP

pm "no signal at all"                 "$FACTORY_MODEL_DEFAULT"  "$T/empty.paths"
pm "safe diff, no prompt"             "$FACTORY_MODEL_DEFAULT"  "$T/safe.paths"
pm "critical diff"                    "$FACTORY_MODEL_CRITICAL" "$T/crit.paths"
pm "safe diff, safe prompt"           "$FACTORY_MODEL_DEFAULT"  "$T/safe.paths" "$T/safe.prompt"
pm "safe diff, CRITICAL prompt"       "$FACTORY_MODEL_CRITICAL" "$T/safe.paths" "$T/crit.prompt"

# --- the prompt forms that used to UNDER-escalate -------------------------
# Every one of these returned sonnet in the first version, because `/` was in
# the excluded preceding-character class. On attempt 1 the prompt is the only
# signal, so each was a live path to the cheap model writing pallet code.
# Reproduced independently by all three review lenses on PR #251.
for form in \
  './pallets/emissions/src/lib.rs' \
  '/work/repo/pallets/emissions/src/lib.rs' \
  '$WORKDIR/runtime/src/lib.rs' \
  'see scalar-commons/pallets/escrow for the guard' \
  'edit runtime/src/lib.rs' \
  'the file is at ../runtime/src/governance/mod.rs'
do
  printf 'Task: %s\n' "$form" > "$T/form.prompt"
  pm "prompt form: $form" "$FACTORY_MODEL_CRITICAL" "$T/safe.paths" "$T/form.prompt"
done

# And the prose that must still NOT escalate, so the widening above did not
# simply make the prompt signal fire on everything.
for form in \
  'update the indexer docs' \
  'node/src/runtime_spec.rs needs a comment' \
  'see docs/runtime-notes.md'
do
  printf 'Task: %s\n' "$form" > "$T/form.prompt"
  pm "prompt form (safe): $form" "$FACTORY_MODEL_DEFAULT" "$T/safe.paths" "$T/form.prompt"
done
pm "critical diff, safe prompt"       "$FACTORY_MODEL_CRITICAL" "$T/crit.paths" "$T/safe.prompt"
pm "missing paths file"               "$FACTORY_MODEL_DEFAULT"  "$T/does-not-exist"
pm "missing paths file, crit prompt"  "$FACTORY_MODEL_CRITICAL" "$T/nope" "$T/crit.prompt"

# The defaults themselves are part of the policy, so they are asserted rather
# than assumed: a config edit that made "critical" mean the cheap model would
# otherwise pass every test above.
[ "$FACTORY_MODEL_DEFAULT" = "sonnet" ] \
  && ok "FACTORY_MODEL_DEFAULT is sonnet" \
  || bad "FACTORY_MODEL_DEFAULT is '$FACTORY_MODEL_DEFAULT', expected sonnet"
[ "$FACTORY_MODEL_CRITICAL" = "opus" ] \
  && ok "FACTORY_MODEL_CRITICAL is opus" \
  || bad "FACTORY_MODEL_CRITICAL is '$FACTORY_MODEL_CRITICAL', expected opus"

# ---------------------------------------------------------------------------
# 3. The explicit override.
#
# An operator running one task by hand must be able to force a model. The
# override is read from the environment so it can be set per-invocation without
# editing config, and it wins over both signals — including in the direction
# that costs more, which is the only direction worth allowing by accident.
# ---------------------------------------------------------------------------
printf '\n3. FACTORY_MODEL override\n'

got="$(FACTORY_MODEL=opus   pick_model "$T/safe.paths")"
[ "$got" = "opus" ]   && ok "override forces opus on a safe diff"   || bad "override -> $got"
got="$(FACTORY_MODEL=sonnet pick_model "$T/crit.paths")"
[ "$got" = "sonnet" ] && ok "override forces sonnet on a crit diff" || bad "override -> $got"

# ---------------------------------------------------------------------------
# 4. The call sites actually pass --model.
#
# Sections 1-3 prove the decision is right. This one proves it is USED: a
# perfect router nothing calls is worth nothing, and that is exactly the state
# this file was written to end.
# ---------------------------------------------------------------------------
printf '\n4. call sites pass --model\n'

# A `grep -q` for "somewhere in this file there is a --model" passes on a
# COMMENT, which is what the standing lens objected to. So instead: find every
# `claude -p` invocation line and require that each one carries --model. A new
# call site added without routing now turns this red.
sites() { # sites <label> <file>
  local label="$1" f="$FACTORY_DIR/$2" total bad
  total="$(grep -cE 'claude -p' "$f" | tr -d '\n')"
  # Only real invocations: skip comment lines, which discuss `claude -p` a lot.
  # Exclude comments AND printf/echo lines: review.sh legitimately PRINTS the
  # words "claude -p" in its diagnostics, and those are not invocations.
  bad="$(grep -nE 'claude -p' "$f" | grep -vE '^[0-9]+: *#' \
         | grep -vE '(printf|echo)' | grep -vc -- '--model' | tr -d '\n')"
  if [ "${bad:-1}" = "0" ]; then ok "$label (every non-comment \`claude -p\` line passes --model)"
  else bad "$label — $bad invocation line(s) without --model (of $total mentioning claude -p)"; fi
}
sites "loop.sh call sites"   lib/loop.sh
sites "review.sh call sites" review.sh

grep -q 'pick_model' "$FACTORY_DIR/lib/loop.sh" \
  && ok "loop.sh computes the model" || bad "loop.sh never calls pick_model"
grep -qE 'pick_model|paths_are_critical' "$FACTORY_DIR/review.sh" \
  && ok "review.sh computes the model" || bad "review.sh never routes"

# ---------------------------------------------------------------------------
# 5. The loop's path gathering, against a REAL git repo.
#
# Sections 1-3 test the decision. This tests the INPUT to it, which is where
# every reproduced downgrade actually lived — and which the first version of
# this file did not touch at all. The lenses were right that grepping loop.sh
# for a variable name proves nothing about the pipeline.
#
# The pipeline is duplicated here rather than invoked, because loop.sh runs a
# whole agent. That is the tradeoff the header warns about, so it is kept to
# ONE line and the line is copied verbatim from loop.sh.
# ---------------------------------------------------------------------------
printf '\n5. path gathering (real git repo)\n'

# Drives THE REAL changed_paths() from common.sh — no copy of its logic here.
gather() { changed_paths "$1" "$BASEREF"; }

R="$T/repo"
git init -q "$R" 2>/dev/null
git -C "$R" config user.email t@t; git -C "$R" config user.name t
mkdir -p "$R/pallets/emissions/src" "$R/docs"
printf 'x\n' > "$R/pallets/emissions/src/lib.rs"
printf 'y\n' > "$R/docs/readme.md"
git -C "$R" add -A >/dev/null; git -C "$R" commit -qm base
BASEREF="$(git -C "$R" rev-parse HEAD)"

# (a) a rename OUT of pallets/ must still read as critical
git -C "$R" mv pallets/emissions/src/lib.rs docs/lib.rs >/dev/null
git -C "$R" commit -qm "move it out"
gather "$R" > "$T/g1"
if paths_are_critical < "$T/g1"; then ok "rename out of pallets/ is still critical"
else bad "rename out of pallets/ read as safe — got: $(tr '\n' ' ' < "$T/g1")"; fi
git -C "$R" reset -q --hard "$BASEREF"

# (b) an uncommitted path WITH A SPACE must read as critical
mkdir -p "$R/pallets/my pallet"
printf 'z\n' > "$R/pallets/my pallet/lib.rs"
gather "$R" > "$T/g2"
if paths_are_critical < "$T/g2"; then ok "uncommitted path containing a space is critical"
else bad "path with a space read as safe — got: $(tr '\n' ' ' < "$T/g2")"; fi
rm -rf "$R/pallets/my pallet"

# (c) a staged rename records BOTH sides
git -C "$R" mv docs/readme.md pallets/emissions/src/readme.md >/dev/null
gather "$R" > "$T/g3"
if grep -q '^docs/readme.md$' "$T/g3" && grep -q '^pallets/' "$T/g3"; then
  ok "staged rename records both sides"
else bad "staged rename lost a side — got: $(tr '\n' ' ' < "$T/g3")"; fi
git -C "$R" reset -q --hard "$BASEREF"; git -C "$R" clean -qfd

# (d) safe-only changes must NOT escalate, or (a)-(c) prove nothing
printf 'more\n' >> "$R/docs/readme.md"
gather "$R" > "$T/g4"
if paths_are_critical < "$T/g4"; then bad "docs-only change escalated — got: $(tr '\n' ' ' < "$T/g4")"
else ok "docs-only change does not escalate"; fi

# (e) an unresolvable base ref must FAIL CLOSED in loop.sh. The gather helper
# cannot show that (loop.sh owns the escalation), so assert the code path.
if grep -q 'GATHER_OK' "$FACTORY_DIR/lib/loop.sh" \
   && grep -q 'path gathering FAILED' "$FACTORY_DIR/lib/loop.sh"; then
  ok "loop.sh escalates when path gathering fails (fails closed)"
else
  bad "loop.sh has no fail-closed path for a failed diff"
fi

printf '\n-------------------------------------------\n'
printf 'model-routing: %d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
