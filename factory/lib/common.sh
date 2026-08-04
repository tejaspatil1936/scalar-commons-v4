#!/usr/bin/env bash
# factory/lib/common.sh — shared plumbing for every factory component.
#
# Not executable on its own; source it. Provides: config loading, billing
# preflight, the kill switch, back-off checks, logging, and the guard rails
# that every component must honour identically. Centralised on purpose: a
# safety check that is reimplemented per script is a safety check that drifts.

# shellcheck disable=SC2034  # some exports are consumed only by sourcing scripts

FACTORY_DIR="${FACTORY_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
REPO_DIR="${REPO_DIR:-$(cd "$FACTORY_DIR/.." && pwd)}"
LOG_DIR="$FACTORY_DIR/logs"
BLOCKED_DIR="$FACTORY_DIR/blocked"
RUN_DIR="$FACTORY_DIR/run"

# ---- config ---------------------------------------------------------------
# shellcheck source=/dev/null
[ -f "$FACTORY_DIR/config.env" ] && . "$FACTORY_DIR/config.env"

: "${STOP_FILE:=$HOME/STOP_FACTORY}"
: "${BACKOFF_FILE:=$HOME/.factory/backoff}"
: "${DEFAULT_MAX_ATTEMPTS:=10}"
: "${DEFAULT_MAX_MINUTES:=240}"
: "${SAME_ERROR_LIMIT:=3}"
: "${MIN_FREE_DISK_GB:=30}"
: "${BACKOFF_MINUTES:=60}"
: "${MAX_PARALLEL:=3}"
: "${DAY_MAX_PARALLEL:=1}"
: "${NIGHT_START:=22}"
: "${NIGHT_END:=7}"
: "${BASE_BRANCH:=master}"
: "${SHARED_CARGO_TARGET:=$HOME/shared-target}"
: "${CARGO_LOCKFILE:=$HOME/.factory/cargo.lock}"
: "${DAILY_SPAWN_CAP:=40}"
: "${SPEND_DIR:=$HOME/.factory}"

mkdir -p "$LOG_DIR" "$BLOCKED_DIR" "$RUN_DIR" "$(dirname "$CARGO_LOCKFILE")" "$SPEND_DIR"

# ---- logging --------------------------------------------------------------
ts() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }

log()  { printf '[%s] %s\n' "$(ts)" "$*"; }
warn() { printf '[%s] WARN: %s\n' "$(ts)" "$*" >&2; }
die()  { printf '[%s] FATAL: %s\n' "$(ts)" "$*" >&2; exit 1; }

# ---- kill switch ----------------------------------------------------------
# The single most important function here. Called before every attempt, every
# dispatch, and every merge. Cheap enough to call liberally.
stop_requested() { [ -e "$STOP_FILE" ]; }

honour_stop() {
  if stop_requested; then
    log "STOP_FACTORY present ($STOP_FILE) — exiting before doing work."
    return 0
  fi
  return 1
}

# ---- back-off -------------------------------------------------------------
# watchdog.sh touches BACKOFF_FILE when a claude call reports rate-limiting or
# overload. Loops treat it as a hard pause rather than hammering the API.
backoff_active() {
  [ -f "$BACKOFF_FILE" ] || return 1
  local until_ts now
  until_ts=$(cat "$BACKOFF_FILE" 2>/dev/null || echo 0)
  now=$(date -u +%s)
  case "$until_ts" in
    ''|*[!0-9]*) rm -f "$BACKOFF_FILE"; return 1 ;;
  esac
  if [ "$now" -ge "$until_ts" ]; then
    rm -f "$BACKOFF_FILE"
    return 1
  fi
  return 0
}

backoff_remaining() {
  local until_ts now
  until_ts=$(cat "$BACKOFF_FILE" 2>/dev/null || echo 0)
  now=$(date -u +%s)
  echo $(( until_ts > now ? until_ts - now : 0 ))
}

start_backoff() {
  local mins="${1:-$BACKOFF_MINUTES}"
  date -u -d "+${mins} minutes" +%s > "$BACKOFF_FILE" 2>/dev/null \
    || echo $(( $(date -u +%s) + mins * 60 )) > "$BACKOFF_FILE"
  log "back-off engaged for ${mins}m (until $(date -u -d "@$(cat "$BACKOFF_FILE")" '+%H:%M:%SZ' 2>/dev/null || echo '?'))"
}

# Detect rate-limit / overload signatures in a claude transcript.
looks_rate_limited() {
  local f="$1"
  [ -f "$f" ] || return 1
  grep -qiE 'rate[ _-]?limit|overloaded_error|429 |529 |"type" *: *"overloaded|too many requests' "$f"
}

# ---- billing preflight ----------------------------------------------------
# Loops MUST bill the API key, never the interactive Max subscription.
#
# Verified behaviour (claude 2.1.220): when ANTHROPIC_API_KEY is set, the CLI
# prints "claude.ai connectors are disabled because ANTHROPIC_API_KEY or
# another auth source is set and takes precedence over your claude.ai login",
# and an invalid key FAILS rather than falling back to OAuth. So a non-empty
# key is sufficient to guarantee API billing.
#
# This fails closed: no key, no loop. A loop that cannot prove its billing
# source does not run at all, because the failure mode is silently draining
# the interactive subscription.
load_billing_env() {
  local envfile="$HOME/.factory/env"
  if [ -f "$envfile" ]; then
    set -a
    # shellcheck source=/dev/null
    . "$envfile"
    set +a
  fi
  if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
    die "ANTHROPIC_API_KEY not set (expected in $envfile). Refusing to run: \
loops must bill the API key, not the interactive Max login. See factory/README.md."
  fi
  export ANTHROPIC_API_KEY
  # Strip inherited interactive-session markers so the child is a clean,
  # API-billed, non-nested session.
  unset CLAUDECODE CLAUDE_CODE_SESSION_ID CLAUDE_CODE_CHILD_SESSION \
        CLAUDE_CODE_ENTRYPOINT CLAUDE_PID CLAUDE_EFFORT ANTHROPIC_AUTH_TOKEN
  log "billing: ANTHROPIC_API_KEY loaded (…${ANTHROPIC_API_KEY: -6}); API billing enforced."
}

# ---- guards ---------------------------------------------------------------
# ---- daily spawn budget ---------------------------------------------------
# Token cost is not observable from a headless `claude -p` call, so the factory
# bounds the thing it CAN count: how many agent processes it starts per day.
# Every spawn appends one line to a dated ledger; the ledger IS the counter, so
# it doubles as an audit trail of what was started and when.
#
# The date lives in the FILENAME, so the budget resets at 00:00 UTC with no
# cron, no cleanup job, and no clock arithmetic that could go wrong.
#
# This is a local guard rail, not a billing control. The Anthropic Console
# monthly cap remains the hard backstop; this exists so a runaway loop is
# stopped in minutes by the machine that started it, rather than in days by a
# billing alert.
spend_ledger() { printf '%s/spend-%s' "$SPEND_DIR" "$(date -u +%Y%m%d)"; }

# Spawns recorded so far today. Never fails; absent ledger means zero.
spend_count() {
  local f; f="$(spend_ledger)"
  if [ -f "$f" ]; then grep -c '' "$f" 2>/dev/null || printf '0'; else printf '0'; fi
}

spend_remaining() {
  local n; n="$(spend_count)"
  printf '%s' "$(( DAILY_SPAWN_CAP > n ? DAILY_SPAWN_CAP - n : 0 ))"
}

# spend_reserve <label> -> 0 = reserved (caller may spawn), 3 = cap reached.
#
# Check-and-append happen together under one flock, so two dispatcher workers
# racing at the cap boundary cannot both be told yes. Reserve BEFORE spawning,
# never after: a crash between spawn and record would under-count, and an
# under-counting budget is not a budget.
spend_reserve() {
  local label="${1:-unlabelled}"
  mkdir -p "$SPEND_DIR"
  (
    flock 8 || exit 1
    local f n
    f="$SPEND_DIR/spend-$(date -u +%Y%m%d)"
    n=0; [ -f "$f" ] && n="$(grep -c '' "$f" 2>/dev/null || echo 0)"
    [ "$n" -ge "$DAILY_SPAWN_CAP" ] && exit 3
    printf '%s\t%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$label" >> "$f"
  ) 8>>"$SPEND_DIR/spend.lock"
}

# Standard refusal message. Every component prints the same thing so the reason
# is unambiguous wherever it shows up in the logs.
spend_refusal() {
  printf 'DAILY SPAWN CAP REACHED: %s of %s spawns used today (%s).\n' \
    "$(spend_count)" "$DAILY_SPAWN_CAP" "$(spend_ledger)"
  printf 'Refusing to start "%s". The budget resets at 00:00 UTC.\n' "${1:-agent}"
  printf 'To raise it deliberately: edit DAILY_SPAWN_CAP in factory/config.env.\n'
}

free_disk_gb() { df -BG --output=avail "$HOME" 2>/dev/null | tail -1 | tr -dc '0-9'; }

disk_ok() {
  local free
  free=$(free_disk_gb)
  [ -n "$free" ] || return 0
  [ "$free" -ge "$MIN_FREE_DISK_GB" ]
}

# Heavy parallelism only inside the night window; days stay interactive.
is_night() {
  local h
  h=$(date -u +%-H)
  if [ "$NIGHT_START" -gt "$NIGHT_END" ]; then
    [ "$h" -ge "$NIGHT_START" ] || [ "$h" -lt "$NIGHT_END" ]
  else
    [ "$h" -ge "$NIGHT_START" ] && [ "$h" -lt "$NIGHT_END" ]
  fi
}

effective_parallel() {
  if is_night; then echo "$MAX_PARALLEL"; else echo "$DAY_MAX_PARALLEL"; fi
}

# ---- gh helper ------------------------------------------------------------
gh_repo_args() {
  if [ -n "${FACTORY_REPO:-}" ]; then printf -- '-R\n%s\n' "$FACTORY_REPO"; fi
}

have_gh() { command -v gh >/dev/null 2>&1; }
