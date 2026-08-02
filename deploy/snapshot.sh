#!/usr/bin/env bash
# Take a consistent state snapshot of one devnet node.
#
#     ./deploy/snapshot.sh [alice|bob|charlie]      (default: alice)
#
# RocksDB/ParityDB hold an exclusive lock and buffer writes in memory, so a tar
# of a RUNNING node's database can be torn and is not a supportable backup. This
# script therefore stops the node, copies, and starts it again.
#
# IMPORTANT — finality stalls while the node is down. This chain has three
# authorities, and GRANDPA's supermajority threshold for n=3 is 3: every
# authority must vote. Taking one down pauses finalization (block *production*
# continues) until it rejoins. That is inherent to a 3-validator set, not a
# fault. Snapshot during a quiet window, and see README.md "Fault tolerance".

set -euo pipefail

NODE="${1:-alice}"
case "${NODE}" in
    alice|bob|charlie) ;;
    *) echo "ERROR: node must be alice, bob or charlie (got '${NODE}')"; exit 1 ;;
esac

BASE="${HOME}/scalar-testnet/${NODE}"
SNAP_DIR="${HOME}/scalar-snapshots"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="${SNAP_DIR}/${NODE}-${STAMP}.tar.zst"

[[ -d "${BASE}" ]] || { echo "ERROR: ${BASE} does not exist"; exit 1; }
mkdir -p "${SNAP_DIR}"

was_active=no
if systemctl --user is-active --quiet "scalar-${NODE}.service"; then
    was_active=yes
fi

cleanup() {
    if [[ "${was_active}" == yes ]]; then
        echo "==> restarting scalar-${NODE}.service"
        systemctl --user start "scalar-${NODE}.service"
    fi
}
trap cleanup EXIT

if [[ "${was_active}" == yes ]]; then
    echo "==> stopping scalar-${NODE}.service for a consistent copy"
    systemctl --user stop "scalar-${NODE}.service"
fi

echo "==> archiving ${BASE} -> ${OUT}"
if command -v zstd >/dev/null 2>&1; then
    tar -C "${HOME}/scalar-testnet" -cf - "${NODE}" | zstd -T0 -3 -o "${OUT}"
else
    OUT="${OUT%.zst}.gz"
    echo "    (zstd not found, falling back to gzip -> ${OUT})"
    tar -C "${HOME}/scalar-testnet" -czf "${OUT}" "${NODE}"
fi

echo "==> snapshot complete:"
ls -lh "${OUT}"
echo
echo "Restore with the node stopped:"
echo "    systemctl --user stop scalar-${NODE}.service"
echo "    rm -rf ~/scalar-testnet/${NODE}"
echo "    tar -C ~/scalar-testnet -xf ${OUT}"
echo "    systemctl --user start scalar-${NODE}.service"
