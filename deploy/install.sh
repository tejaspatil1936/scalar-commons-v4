#!/usr/bin/env bash
# Scalar Commons — persistent 3-validator devnet installer (user systemd, no sudo).
#
# Idempotent: safe to re-run. It does NOT delete chain data; use `reset-chain.sh`
# for that. Run from anywhere:
#
#     ./deploy/install.sh
#
# What it does:
#   1. creates ~/scalar-testnet/{alice,bob,charlie}
#   2. writes the fixed per-node network keys (0600) — these fix each node's
#      peer id, so alice's bootnode multiaddr stays valid across restarts
#   3. installs the user systemd units into ~/.config/systemd/user/
#   4. enables the target + the three services (survives reboot via linger)
#
# It does NOT start anything — see README.md.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE="${HOME}/scalar-testnet"
UNIT_DIR="${HOME}/.config/systemd/user"
BIN="${REPO}/target/release/scalar-node"
SPEC="${REPO}/deploy/scalar-local-raw.json"

echo "==> repo:      ${REPO}"
echo "==> base path: ${BASE}"
echo "==> units:     ${UNIT_DIR}"

# ── preflight ────────────────────────────────────────────────────────────────
[[ -x "${BIN}" ]] || { echo "ERROR: ${BIN} missing. Run: cargo build --release -p scalar-node"; exit 1; }
[[ -f "${SPEC}" ]] || { echo "ERROR: ${SPEC} missing. Run: ./deploy/build-spec.sh"; exit 1; }

if ! loginctl show-user "$(id -un)" 2>/dev/null | grep -q '^Linger=yes'; then
    echo "WARNING: linger is NOT enabled for $(id -un) — the devnet will NOT"
    echo "         survive a reboot. Fix with: sudo loginctl enable-linger $(id -un)"
fi

# ── 1 + 2. base paths and fixed node keys ────────────────────────────────────
# Well-known low-entropy keys: this is a TESTNET with well-known Alice/Bob/
# Charlie session keys anyway, so the node keys carry no additional secret.
# Mainnet must generate these — see README.md "What mainnet needs".
declare -A NODE_KEYS=(
    [alice]=0000000000000000000000000000000000000000000000000000000000000001
    [bob]=0000000000000000000000000000000000000000000000000000000000000002
    [charlie]=0000000000000000000000000000000000000000000000000000000000000003
)

for node in alice bob charlie; do
    mkdir -p "${BASE}/${node}"
    keyfile="${BASE}/${node}/node-key"
    # printf, not echo: substrate wants the bare 64 hex chars.
    printf '%s' "${NODE_KEYS[$node]}" > "${keyfile}"
    chmod 600 "${keyfile}"
    peer_id="$("${BIN}" key inspect-node-key --file "${keyfile}")"
    echo "==> ${node}: ${BASE}/${node}  peer id ${peer_id}"
done

# ── 3. install units ─────────────────────────────────────────────────────────
mkdir -p "${UNIT_DIR}"
for unit in scalar-alice.service scalar-bob.service scalar-charlie.service scalar-devnet.target; do
    install -m 644 "${REPO}/deploy/systemd/${unit}" "${UNIT_DIR}/${unit}"
    echo "==> installed ${unit}"
done

systemctl --user daemon-reload

# ── 4. enable ────────────────────────────────────────────────────────────────
systemctl --user enable scalar-devnet.target \
                        scalar-alice.service \
                        scalar-bob.service \
                        scalar-charlie.service

echo
echo "Installed and enabled. Start with:"
echo "    systemctl --user start scalar-devnet.target"
