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
# Loops bill the Claude Max subscription, not a metered API key (LAB decision
# 002 amendment, 27 Sep 2026 Max-subscription cutover: this box no longer has
# an ANTHROPIC_API_KEY/ANTHROPIC_BASE_URL — the inference proxy is retired).
#
# Verified behaviour (claude 2.1.220): the CLI uses the claude.ai (Max) login
# UNLESS ANTHROPIC_API_KEY (or another auth source) is set, in which case that
# takes precedence and disables claude.ai connectors. So Max billing requires
# the *absence* of a key, not its presence — the inverse of the old policy.
#
# NOT A PREFLIGHT GUARANTEE ANY MORE, and the old "fails closed" framing does
# not carry over honestly: there is no longer a condition this function
# refuses to run under, because there is nothing left to check FOR (an OAuth
# login is either on disk or it isn't, and probing for that here would just
# be a second, redundant place for that check to go stale). What this
# function still owns, and fails closed on in the sense that matters: a
# leftover API-auth env var must never silently redirect billing at the
# retired proxy (that exact failure mode killed the 217/219/223/225 tasks
# mid-GATING, 2026-09-27 ~01:51-02:36 UTC — one real attempt, then three
# instant, unparseable exits). If Max auth itself is unreachable, `claude -p`
# fails loudly on its own and the caller's normal attempt/gate bounds handle
# it — that failure path was already exercised and did not need duplicating
# here.
#
# Scrub is scoped to this box's known auth surface: ANTHROPIC_API_KEY/
# BASE_URL/AUTH_TOKEN, the three that route to a key or a proxy instead of
# the Max login. It does NOT cover CLAUDE_CODE_USE_BEDROCK/VERTEX or an
# apiKeyHelper in settings — this box uses neither, so they are out of scope
# rather than silently handled; a box that does would need this extended.
load_billing_env() {
  local envfile="$HOME/.factory/env"
  if [ -f "$envfile" ]; then
    set -a
    # shellcheck source=/dev/null
    . "$envfile"
    set +a
  fi
  if [ -n "${ANTHROPIC_API_KEY:-}${ANTHROPIC_BASE_URL:-}${ANTHROPIC_AUTH_TOKEN:-}" ]; then
    warn "stray API-auth env var set ($envfile or inherited) — clearing it so billing goes through the Max login, not a key/proxy."
  fi
  unset ANTHROPIC_API_KEY ANTHROPIC_BASE_URL ANTHROPIC_AUTH_TOKEN
  # Interactive-session markers ARE still stripped, same as the old policy:
  # nothing about the Max-auth flip changes the reason to want a clean,
  # non-nested session (OAuth credentials come from ~/.claude/, not from
  # these markers — an earlier version of this comment claimed otherwise;
  # that claim was wrong, not the strip itself).
  unset CLAUDECODE CLAUDE_CODE_SESSION_ID CLAUDE_CODE_CHILD_SESSION \
        CLAUDE_CODE_ENTRYPOINT CLAUDE_PID CLAUDE_EFFORT
  log "billing: Max subscription login (no ANTHROPIC_API_KEY/BASE_URL/AUTH_TOKEN in env)."
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

# ---- model routing --------------------------------------------------------
# Which model runs a given `claude -p`, decided by what the work can break.
#
# Every spawn in this system used to inherit whatever the CLI defaulted to.
# That made the most consequential choice in the whole loop — the model writing
# and reviewing consensus code — an implicit property of a CLI release, and it
# left no record of which model produced which commit.
#
# The rule is deliberately narrow, because a rule with many clauses is a rule
# nobody can predict:
#
#   default            sonnet
#   runtime/ pallets/  opus
#
# Those two directories are the chain. A wrong line in `indexer/` is a bad API
# response someone notices; a wrong line in `pallets/emissions` mints tokens, and
# there is no patch release for a block that has been finalized. Everything else
# in this repo is recoverable by a follow-up commit, so it gets the cheaper
# model and the budget goes where the blast radius is.
#
# Cost-wise this is not a rounding error, which is why the escalation is scoped
# to paths rather than to tiers or labels: a label is set by whoever opened the
# issue, and this decision should not be settable by the thing being judged.
FACTORY_MODEL_DEFAULT="${FACTORY_MODEL_DEFAULT:-sonnet}"
FACTORY_MODEL_CRITICAL="${FACTORY_MODEL_CRITICAL:-opus}"

# Anchored at the start of a repo-relative path. `^runtime/` and not `runtime/`
# because the loose form also matches `vendor/other-chain/runtime/src/lib.rs`
# and `node/src/runtime_spec.rs`, and a predicate that fires on unrelated files
# stops being read as meaning anything.
FACTORY_CRITICAL_PATH_RE="${FACTORY_CRITICAL_PATH_RE:-^(runtime|pallets)/}"

# paths_are_critical   (repo-relative paths, one per line, on stdin)
# Exit 0 if ANY path is consensus/economic code. Exit 1 otherwise.
#
# Any, not all: a PR that edits fifty docs and one line of `pallets/escrow` is a
# pallet PR that happens to have documentation in it.
paths_are_critical() {
  grep -qE "$FACTORY_CRITICAL_PATH_RE"
}

# pick_model [changed-paths-file] [prompt-file] -> model name on stdout
#
# Two signals, because neither alone covers the run:
#
#   - The changed-paths file is the truth, and it is what review.sh has: the
#     diff exists and says exactly where the work landed.
#   - The prompt is a WEAKER signal used by loop.sh, and it exists for one case
#     the first signal cannot cover at all. On attempt 1 the worktree diff is
#     empty — the agent has not written anything yet — so the only evidence of
#     where the work is going to land is the instruction it was handed. Reading
#     the prompt can over-escalate (a task that merely mentions a pallet in
#     passing), and that is the direction to err in: over-escalating costs
#     money, under-escalating puts the cheap model on the chain.
#
# FACTORY_MODEL, if set, wins outright. That is for an operator running one task
# by hand; nothing in the automatic path sets it.
pick_model() {
  local paths_file="${1:-}" prompt_file="${2:-}"

  if [ -n "${FACTORY_MODEL:-}" ]; then
    printf '%s\n' "$FACTORY_MODEL"; return 0
  fi

  if [ -n "$paths_file" ] && [ -s "$paths_file" ] \
     && paths_are_critical < "$paths_file"; then
    printf '%s\n' "$FACTORY_MODEL_CRITICAL"; return 0
  fi

  # In prose the paths are not line-anchored, so match them as words: the
  # anchored regex above would never fire inside a sentence.
  if [ -n "$prompt_file" ] && [ -f "$prompt_file" ] \
     && grep -qE '(^|[^A-Za-z0-9_/-])(runtime|pallets)/' "$prompt_file"; then
    printf '%s\n' "$FACTORY_MODEL_CRITICAL"; return 0
  fi

  printf '%s\n' "$FACTORY_MODEL_DEFAULT"
}

# ---- gh helper ------------------------------------------------------------
gh_repo_args() {
  if [ -n "${FACTORY_REPO:-}" ]; then printf -- '-R\n%s\n' "$FACTORY_REPO"; fi
}

have_gh() { command -v gh >/dev/null 2>&1; }

# ---- binding a review to a head SHA ---------------------------------------
# `agent-reviewed` used to be a naked label: it said "some review passed", not
# "THIS diff passed". dispatch.sh re-pushes from a reused worktree every hour,
# so commits nobody reviewed could land on a PR that kept the label, and
# ENDGOAL §3.6's "any FAIL from any lens blocks the merge" held by convention
# rather than by mechanism (audit finding I-13, cause 4).
#
# The binding is the SHA review.sh actually read, written into its verdict
# comment as an HTML comment — invisible in the rendered thread, durable in the
# API body, and impossible to set by adding a label. merge.sh reads it back and
# refuses a head that has moved on.
#
# Emitter and parser live together HERE, in the one file both scripts source,
# so the format cannot drift apart the way review.sh and its old test did.
REVIEW_HEAD_MARKER='factory-review-head:'

# review_head_marker <sha> -> the marker line to embed in a verdict comment.
review_head_marker() { printf '<!-- %s %s -->' "$REVIEW_HEAD_MARKER" "$1"; }

# parse_review_head_sha  (comment bodies on stdin) -> the LAST bound SHA, or "".
#
# The LAST marker wins: a PR reviewed twice is bound by its most recent review,
# which is the one that judged the state the PR is in now. The marker syntax is
# required, so prose that merely quotes a SHA can never be read as a binding.
parse_review_head_sha() {
  grep -oE "$REVIEW_HEAD_MARKER [0-9a-f]{7,40}" | tail -1 | awk '{print $2}'
}
