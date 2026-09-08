#!/usr/bin/env bash
# factory/tests/review-billing.sh — prove review.sh loads its billing env.
#
# WHY THIS TEST EXISTS (audit finding P6-03 / I-13 cause 1)
#
# `lib/loop.sh` calls `load_billing_env` before it spends anything; `review.sh`
# did not. Under systemd the reviewer therefore inherited neither
# `~/.factory/env`'s PATH nor `ANTHROPIC_API_KEY`, and all six systemd-launched
# reviews — 18 of 18 lenses — exited 127. Worse than the wasted run: once a
# `claude` binary IS on PATH but no API key is, the CLI falls back to the
# interactive OAuth login and bills the Max subscription, which
# `lib/common.sh:99-110` exists specifically to forbid.
#
# So there are two properties, and both are asserted here:
#   1. review.sh calls load_billing_env — the same function loop.sh calls, not
#      a private re-implementation that could drift.
#   2. It calls it BEFORE any lens is spawned, and it FAILS CLOSED: with no key
#      reachable, review.sh must exit non-zero having spawned nothing.
#
# Property 2 is the load-bearing one. A structural grep alone would pass if the
# call sat after the lens loop, which would be no protection at all.
#
# No network, no API spend: `gh` and `claude` are stubs on PATH, and the run is
# expected to die before either is used for real.

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
RUN_LINE="$(grep -n 'claude -p --dangerously-skip-permissions' "$REVIEW" | head -1 | cut -d: -f1)"
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
# 2. Behavioural: no key reachable => review.sh dies, spawning nothing.
#
# The stub `claude` touches a sentinel. If the sentinel exists after the run,
# review.sh spawned a lens without proving its billing source, which is the
# exact failure this test is here to prevent.
# ---------------------------------------------------------------------------
printf '\n\033[1m=== with no API key reachable, review.sh fails closed ===\033[0m\n'

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

if [ "$RC" -ne 0 ]; then
  ok "review.sh exited non-zero ($RC) with no ANTHROPIC_API_KEY"
else
  bad "review.sh exited 0 with no ANTHROPIC_API_KEY — it must fail closed"
fi

if grep -qi 'ANTHROPIC_API_KEY not set' "$OUT"; then
  ok 'review.sh refused with the billing preflight message'
else
  bad "review.sh did not print the billing preflight refusal; got: $(head -5 "$OUT" | tr '\n' ' ')"
fi

if [ -e "$SENTINEL" ]; then
  bad 'review.sh spawned claude despite having no provable billing source'
else
  ok 'no lens was spawned'
fi

# ---------------------------------------------------------------------------
# 3. With a key in ~/.factory/env, the preflight passes and the run proceeds
#    past it (it then fails on the stub gh, which is fine and expected — the
#    assertion is only that billing is no longer the thing stopping it).
# ---------------------------------------------------------------------------
printf '\n\033[1m=== with ~/.factory/env present, the preflight passes ===\033[0m\n'

mkdir -p "$TESTHOME/.factory"
echo 'export ANTHROPIC_API_KEY=sk-ant-billing-test-stub' > "$TESTHOME/.factory/env"
OUT2="$T/out2.txt"
env -i \
  PATH="$STUB:/usr/bin:/bin" \
  HOME="$TESTHOME" \
  bash "$REVIEW" --dry-run 999 >"$OUT2" 2>&1 || true

if grep -q 'API billing enforced' "$OUT2"; then
  ok 'billing preflight logged that the API key was loaded'
else
  bad "billing preflight did not run; got: $(head -5 "$OUT2" | tr '\n' ' ')"
fi
if grep -qi 'ANTHROPIC_API_KEY not set' "$OUT2"; then
  bad 'review.sh still refused even though ~/.factory/env supplied a key'
else
  ok 'review.sh no longer refuses on billing once the env file supplies a key'
fi

printf '\n\033[1m===== REVIEW-BILLING SUMMARY: %d passed, %d failed =====\033[0m\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
