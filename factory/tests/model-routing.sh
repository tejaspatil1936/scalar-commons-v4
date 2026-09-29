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

site() { # site <label> <file> <regex>
  if grep -qE "$3" "$FACTORY_DIR/$2"; then ok "$1"
  else bad "$1 — no line matching: $3"; fi
}

site "loop.sh spawns the agent with --model"   lib/loop.sh \
  'claude -p .*--model "\$[A-Z_]+"'
site "loop.sh computes the model per attempt"  lib/loop.sh \
  'pick_model'
site "review.sh spawns each lens with --model" review.sh \
  'claude -p .*--model "\$[A-Z_]+"'
site "review.sh computes the model from the changed files" review.sh \
  'pick_model|paths_are_critical'

printf '\n-------------------------------------------\n'
printf 'model-routing: %d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
