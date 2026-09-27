#!/usr/bin/env bash
# factory/tests/review-billing.sh — prove review.sh loads its billing env.
#
# WHY THIS TEST EXISTS (audit finding P6-03 / I-13 cause 1)
#
# `lib/loop.sh` calls `load_billing_env` before it spends anything; `review.sh`
# did not. Under systemd the reviewer therefore inherited neither
# `~/.factory/env`'s PATH nor whatever billing env was current, and all six
# systemd-launched reviews — 18 of 18 lenses — exited 127.
#
# POLICY FLIP (LAB decision 002 amendment, 27 Sep 2026 Max-subscription
# cutover): this box's inference proxy is retired; `~/.factory/env` no longer
# sets ANTHROPIC_API_KEY/ANTHROPIC_BASE_URL, and loops now bill the Claude Max
# subscription on purpose, via `lib/common.sh:load_billing_env`. The OLD
# policy (fail closed if no key reachable, to stop loops silently drawing on
# the interactive subscription) is inverted: the interactive subscription IS
# now the billing source, and a stray API key left in the environment is the
# thing that gets scrubbed, because it would silently point billing at a dead
# proxy (see the 217/219/223/225 incident, 2026-09-27 ~01:51-02:36 UTC).
#
# So there are two properties, and both are asserted here:
#   1. review.sh calls load_billing_env — the same function loop.sh calls, not
#      a private re-implementation that could drift.
#   2. It calls it BEFORE any lens is spawned, and it never lets a stray key
#      reach the child process: present or absent, load_billing_env clears
#      ANTHROPIC_API_KEY/BASE_URL/AUTH_TOKEN and proceeds on Max billing.
#
# Property 2 is the load-bearing one. A structural grep alone would pass if the
# call sat after the lens loop, which would be no protection at all.
#
# No network, no real API spend: `gh` and `claude` are stubs on PATH.

set -uo pipefail

TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FACTORY_DIR="$(cd "$TESTS_DIR/.." && pwd)"
REVIEW="$FACTORY_DIR/review.sh"
[ -x "$REVIEW" ] || { printf 'FATAL: %s not found or not executable\n' "$REVIEW" >&2; exit 1; }

PASS=0
FAIL=0
ok()  { PASS=$((PASS+1)); printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf '  \033[31mFAIL\033[0m  %s\n' "$1"; }

T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT

# ---------------------------------------------------------------------------
# 1. Structural: review.sh uses the shared helper, not a copy of it.
# ---------------------------------------------------------------------------
printf '\n\033[1m=== review.sh sources the shared billing preflight ===\033[0m\n'

if grep -q 'load_billing_env' "$REVIEW"; then
  ok 'review.sh calls load_billing_env'
else
  bad 'review.sh never calls load_billing_env (this is finding I-13 cause 1)'
fi

# The call must precede the lens definitions; if it came after, a spawn could
# already have happened on the wrong billing source.
CALL_LINE="$(grep -n '^[[:space:]]*load_billing_env[[:space:]]*$' "$REVIEW" | head -1 | cut -d: -f1)"
LENS_LINE="$(grep -n '^LENSES=' "$REVIEW" | head -1 | cut -d: -f1)"
RUN_LINE="$(grep -n 'claude -p --model opus --dangerously-skip-permissions' "$REVIEW" | head -1 | cut -d: -f1)"
if [ -n "$CALL_LINE" ] && [ -n "$LENS_LINE" ] && [ "$CALL_LINE" -lt "$LENS_LINE" ]; then
  ok "load_billing_env at line $CALL_LINE precedes LENSES at line $LENS_LINE"
else
  bad "load_billing_env (line ${CALL_LINE:-none}) does not precede LENSES (line ${LENS_LINE:-none})"
fi
if [ -n "$CALL_LINE" ] && [ -n "$RUN_LINE" ] && [ "$CALL_LINE" -lt "$RUN_LINE" ]; then
  ok "load_billing_env at line $CALL_LINE precedes the claude -p spawn at line $RUN_LINE"
else
  bad "load_billing_env (line ${CALL_LINE:-none}) does not precede the spawn (line ${RUN_LINE:-none})"
fi

# ---------------------------------------------------------------------------
# 2. Behavioural: no key reachable => Max billing, preflight does not block.
#
# review.sh is expected to fail later (the stub `gh` always refuses), but that
# failure must come from gh, never from the billing preflight — Max login with
# no key present is now the normal, expected case.
# ---------------------------------------------------------------------------
printf '\n\033[1m=== with no API key reachable, review.sh proceeds on Max billing ===\033[0m\n'

STUB="$T/bin"; mkdir -p "$STUB"
SENTINEL="$T/claude-was-spawned"
cat > "$STUB/claude" <<EOF
#!/usr/bin/env bash
touch "$SENTINEL"
echo "VERDICT: PASS"
EOF
cat > "$STUB/gh" <<'EOF'
#!/usr/bin/env bash
# Present so have_gh() succeeds. Any real use is a test failure, so say so.
echo "STUB gh called: $*" >&2
exit 1
EOF
chmod +x "$STUB/claude" "$STUB/gh"

TESTHOME="$T/home"; mkdir -p "$TESTHOME"   # no ~/.factory/env at all
OUT="$T/out.txt"
env -i \
  PATH="$STUB:/usr/bin:/bin" \
  HOME="$TESTHOME" \
  bash "$REVIEW" --dry-run 999 >"$OUT" 2>&1
RC=$?

if grep -qi 'billing: Max subscription login' "$OUT"; then
  ok 'billing preflight logged Max subscription login with no key present'
else
  bad "billing preflight did not run/log as expected; got: $(head -5 "$OUT" | tr '\n' ' ')"
fi

if grep -qi 'ANTHROPIC_API_KEY not set' "$OUT"; then
  bad 'review.sh still refuses on a missing key — billing policy was not inverted'
else
  ok 'review.sh did not refuse for lack of an API key'
fi

# ---------------------------------------------------------------------------
# 3. With a STRAY key in ~/.factory/env, load_billing_env clears it rather
#    than using it — a leftover key must never silently redirect billing to a
#    dead proxy (this is exactly how issue-217/219/223/225 died in GATING).
# ---------------------------------------------------------------------------
printf '\n\033[1m=== with a stray key in ~/.factory/env, it is cleared, not used ===\033[0m\n'

mkdir -p "$TESTHOME/.factory"
echo 'export ANTHROPIC_API_KEY=sk-ant-billing-test-stub' > "$TESTHOME/.factory/env"
OUT2="$T/out2.txt"
env -i \
  PATH="$STUB:/usr/bin:/bin" \
  HOME="$TESTHOME" \
  bash "$REVIEW" --dry-run 999 >"$OUT2" 2>&1 || true

if grep -qi 'clearing it so billing goes through the Max login' "$OUT2"; then
  ok 'billing preflight warned and cleared the stray key'
else
  bad "stray key was not detected/cleared as expected; got: $(head -5 "$OUT2" | tr '\n' ' ')"
fi
if grep -qi 'billing: Max subscription login' "$OUT2"; then
  ok 'review.sh proceeded on Max billing despite the stray key'
else
  bad "review.sh did not confirm Max billing after clearing the stray key"
fi

printf '\n\033[1m===== REVIEW-BILLING SUMMARY: %d passed, %d failed =====\033[0m\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
