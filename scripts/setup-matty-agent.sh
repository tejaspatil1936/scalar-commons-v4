#!/usr/bin/env bash
# scripts/setup-matty-agent.sh — one-time setup for the onboarding agent (see README-MATTY.md).
#
# Builds sdk/ and examples/reference-agent/ (the agent installs the SDK as a packed
# copy, so the SDK must be built first), runs the offline unit tests, then says what
# to do next. Sends no transaction and writes no key.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

need() { command -v "$1" >/dev/null 2>&1 || { echo "missing: $1 — $2" >&2; exit 1; }; }
need node "use a Node.js Repl (Node 18 or newer)"
need npm "comes with Node.js"

major="$(node -p 'process.versions.node.split(".")[0]')"
if (( major < 18 )); then
  echo "Node $(node -v) is too old; the SDK needs Node 18 or newer." >&2
  exit 1
fi

echo "==> building the SDK (sdk/)"
(cd "$ROOT/sdk" && npm ci --no-audit --no-fund && npm run build)

echo "==> building the agent (examples/reference-agent/)"
(cd "$ROOT/examples/reference-agent" && npm ci --no-audit --no-fund && npm run build)

echo "==> offline unit tests"
(cd "$ROOT/examples/reference-agent" && npm test)

chmod +x "$ROOT/scripts/run-matty-agent.sh"

echo
if [[ -z "${SCALAR_SEED_PHRASE:-}" && -z "${SCALAR_SEED_FILE:-}" ]]; then
  cat <<'EOF'
Setup done. No agent key is configured yet. Next:
  1. scripts/run-matty-agent.sh keygen
  2. Replit → Tools → Secrets → new secret SCALAR_SEED_PHRASE = the 12 words it printed
  3. scripts/run-matty-agent.sh check
EOF
else
  echo "Setup done. Next: scripts/run-matty-agent.sh check"
fi
