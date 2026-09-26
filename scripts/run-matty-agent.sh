#!/usr/bin/env bash
# scripts/run-matty-agent.sh — run the Scalar Commons onboarding agent (see README-MATTY.md).
#
#   scripts/run-matty-agent.sh [demo]         check → heartbeat → verify (never registers)
#   scripts/run-matty-agent.sh check          read-only status and the next step
#   scripts/run-matty-agent.sh faucet         one testnet drip to this agent's address
#   scripts/run-matty-agent.sh register --yes lock stake + burn the registration fee (test CMN)
#   scripts/run-matty-agent.sh heartbeat      the safe test transaction
#   scripts/run-matty-agent.sh verify [hash]  prove it landed: indexer + explorer + chain
#   scripts/run-matty-agent.sh start          the autonomous daemon (foreground; Ctrl+C stops it)
#   scripts/run-matty-agent.sh keygen         print a fresh mnemonic + address
#
# Configuration comes from the environment (Replit Secrets), then from an optional
# gitignored .env at the repo root for anything not already set. The seed is given
# as SCALAR_SEED_PHRASE (a secret) or SCALAR_SEED_FILE (a path). A phrase is written
# to a 0600 file OUTSIDE the project and removed from the environment before node
# starts: the agent itself only ever reads the seed from a 0600 file.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AGENT_DIR="$ROOT/examples/reference-agent"

# ── optional .env (KEY=VALUE lines; never sourced, so a value cannot run code) ──
if [[ -f "$ROOT/.env" ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*(#|$) ]] && continue
    [[ "$line" =~ ^[[:space:]]*([A-Z_][A-Z0-9_]*)=(.*)$ ]] || continue
    key="${BASH_REMATCH[1]}"
    val="${BASH_REMATCH[2]}"
    val="${val%\"}"; val="${val#\"}"; val="${val%\'}"; val="${val#\'}"
    # Secrets / the shell win over the file.
    [[ -z "${!key:-}" && -n "$val" ]] && export "$key=$val"
  done < "$ROOT/.env"
fi

# ── public testnet defaults (docs/guide/run-an-agent.md) ──
export SCALAR_WS="${SCALAR_WS:-wss://rpc.scalarnet.io}"
export SCALAR_INDEXER="${SCALAR_INDEXER:-https://api.scalarnet.io}"
export SCALAR_FAUCET="${SCALAR_FAUCET:-https://faucet.scalarnet.io}"
export EXPLORER_BASE="${EXPLORER_BASE:-https://explorer.scalarnet.io}"
export AGENT_STAKE_CMN="${AGENT_STAKE_CMN:-1000}"
export HEARTBEAT_EVERY_BLOCKS="${HEARTBEAT_EVERY_BLOCKS:-600}"
# Empty by default: publishing a capability first sets an on-chain identity (~12 CMN deposit).
export AGENT_CAPABILITIES="${AGENT_CAPABILITIES:-}"
export ACCEPT_UNCATEGORISED="${ACCEPT_UNCATEGORISED:-true}"
export AUTO_CONFIRM="${AUTO_CONFIRM:-false}"
export CLAIM_REWARDS="${CLAIM_REWARDS:-true}"

cmd="${1:-demo}"
[[ $# -gt 0 ]] && shift

if [[ ! -f "$AGENT_DIR/dist/onboard.js" ]]; then
  echo "Not built yet. Run: scripts/setup-matty-agent.sh" >&2
  exit 1
fi

if [[ "$cmd" == "keygen" ]]; then
  exec node "$AGENT_DIR/dist/onboard.js" keygen
fi

# ── seed: phrase secret → 0600 file outside the project ──
if [[ -n "${SCALAR_SEED_PHRASE:-}" ]]; then
  seed_dir="${SCALAR_AGENT_HOME:-$HOME/.config/scalar-matty-agent}"
  (umask 077 && mkdir -p "$seed_dir" && printf '%s\n' "$SCALAR_SEED_PHRASE" > "$seed_dir/seed")
  chmod 600 "$seed_dir/seed"
  export SCALAR_SEED_FILE="$seed_dir/seed"
elif [[ -z "${SCALAR_SEED_FILE:-}" ]]; then
  cat >&2 <<'EOF'
No agent key configured.
  1. scripts/run-matty-agent.sh keygen        (prints a new mnemonic and address)
  2. Replit → Tools → Secrets → add SCALAR_SEED_PHRASE = <the 12 words>
  3. Re-run this command.
EOF
  exit 1
fi

run() { exec env -u SCALAR_SEED_PHRASE node "$@"; }

case "$cmd" in
  start)
    # The daemon registers on its own if the account is not an agent yet. That spend
    # must be approved by a human first (register --yes), so refuse to start until it is.
    if ! env -u SCALAR_SEED_PHRASE node "$AGENT_DIR/dist/onboard.js" check --require-registered; then
      echo "Not registered yet: run 'scripts/run-matty-agent.sh register --yes' first (see README-MATTY.md)." >&2
      exit 1
    fi
    run "$AGENT_DIR/dist/main.js"
    ;;
  demo | check | faucet | register | heartbeat | verify)
    run "$AGENT_DIR/dist/onboard.js" "$cmd" "$@"
    ;;
  *)
    echo "usage: $0 [demo|check|faucet|register --yes|heartbeat|verify [txHash]|start|keygen]" >&2
    exit 2
    ;;
esac
