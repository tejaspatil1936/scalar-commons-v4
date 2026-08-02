#!/usr/bin/env bash
# factory/tests/verdict-parse.sh — prove review.sh's verdict parsing fails CLOSED.
#
# The reviewer's tally decides whether a PR gets labelled agent-reviewed, which
# is a precondition for merge. If a garbled or missing verdict were read as PASS,
# an unreviewed diff could reach the trunk. So the parsing rule — "no parseable
# VERDICT line means FAIL" — is safety-critical and gets its own test.
#
# This tests the parsing logic in isolation (no API calls, no GitHub), by
# replaying the exact grep/awk pipeline review.sh uses against crafted outputs.

set -uo pipefail

PASS=0
FAIL=0
ok()  { PASS=$((PASS+1)); printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf '  \033[31mFAIL\033[0m  %s\n' "$1"; }

# The verdict extraction exactly as review.sh performs it.
parse_verdict() {
  local out="$1" v
  v="$(grep -oE '^VERDICT: (PASS|FAIL)' "$out" | tail -1 | awk '{print $2}')"
  if [ -z "$v" ]; then
    v="$(grep -oE 'VERDICT: (PASS|FAIL)' "$out" | tail -1 | awk '{print $2}')"
  fi
  [ -n "$v" ] || v="FAIL"      # fail closed
  echo "$v"
}

T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT

expect() { # expect <desc> <expected> <content>
  printf '%s' "$3" > "$T/o"
  local got
  got="$(parse_verdict "$T/o")"
  if [ "$got" = "$2" ]; then ok "$1 -> $got"; else bad "$1 (expected $2, got $got)"; fi
}

printf '\n\033[1m=== verdict parsing ===\033[0m\n'

expect "clean PASS on its own line" PASS 'Looks fine.
VERDICT: PASS'
expect "clean FAIL on its own line" FAIL 'Test deleted at foo.rs:12.
VERDICT: FAIL'
expect "empty output fails closed"                  FAIL ''
expect "no verdict line at all fails closed"        FAIL 'I reviewed it and it seems okay to me.'
expect "prose mentioning pass but no verdict"       FAIL 'This should pass CI without problems.'
expect "last verdict wins when the model restates"  FAIL 'VERDICT: PASS
wait, on reflection:
VERDICT: FAIL'
expect "indented verdict still detected (fallback)" PASS '   VERDICT: PASS'
expect "verdict inside a sentence (fallback)"       FAIL 'My conclusion is VERDICT: FAIL because of the stub.'
expect "malformed verdict word fails closed"        FAIL 'VERDICT: MAYBE'
expect "lowercase verdict fails closed (strict)"    FAIL 'verdict: pass'
expect "PASS preceded by a FAIL discussion"         PASS 'A weaker reviewer might say VERDICT: FAIL here, but no.
VERDICT: PASS'
expect "truncated output mid-verdict fails closed"  FAIL 'reasons...
VERDICT: PAS'

printf '\n\033[1m=== tally rules ===\033[0m\n'
# >=2 PASS -> agent-reviewed; ANY fail -> needs-human (both can apply).
tally() { # tally <v1> <v2> <v3> -> "<reviewed> <needshuman>"
  local p=0 f=0 v
  for v in "$1" "$2" "$3"; do
    [ "$v" = PASS ] && p=$((p+1))
    [ "$v" = FAIL ] && f=$((f+1))
  done
  local reviewed=no human=no
  [ "$p" -ge 2 ] && reviewed=yes
  [ "$f" -gt 0 ] && human=yes
  echo "$reviewed $human"
}
t() { # t <desc> <expected> <v1> <v2> <v3>
  local got; got="$(tally "$3" "$4" "$5")"
  if [ "$got" = "$2" ]; then ok "$1 -> reviewed/human = $got"; else bad "$1 (expected '$2', got '$got')"; fi
}
t "3 PASS: reviewed, no escalation"        "yes no"  PASS PASS PASS
t "2 PASS 1 FAIL: reviewed AND escalated"  "yes yes" PASS PASS FAIL
t "1 PASS 2 FAIL: not reviewed, escalated" "no yes"  PASS FAIL FAIL
t "3 FAIL: not reviewed, escalated"        "no yes"  FAIL FAIL FAIL

printf '\n  note: 2 PASS + 1 FAIL sets BOTH labels; merge.sh requires\n'
printf '  agent-reviewed AND no needs-human, so any FAIL blocks the merge.\n'

printf '\n\033[1m===== VERDICT-PARSE SUMMARY: %d passed, %d failed =====\033[0m\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
