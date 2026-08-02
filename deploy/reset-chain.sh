#!/usr/bin/env bash
# DESTRUCTIVE. Wipe all devnet chain state and start from genesis again.
#
#     ./deploy/reset-chain.sh
#
# Use after regenerating the chainspec (a new genesis hash means the old
# database is a different chain and nodes will refuse it). Node keys are
# preserved so alice's bootnode peer id — and therefore the multiaddr baked
# into bob's and charlie's units — does not change.

set -euo pipefail

BASE="${HOME}/scalar-testnet"

echo "This will DELETE all chain data under ${BASE}:"
for node in alice bob charlie; do
    [[ -d "${BASE}/${node}/chains" ]] && du -sh "${BASE}/${node}/chains" 2>/dev/null || true
done
echo
read -r -p "Type 'reset' to confirm: " confirm
[[ "${confirm}" == "reset" ]] || { echo "aborted"; exit 1; }

echo "==> stopping devnet"
systemctl --user stop scalar-devnet.target || true
systemctl --user stop scalar-alice.service scalar-bob.service scalar-charlie.service || true

for node in alice bob charlie; do
    # Delete only the chain database — keep node-key so peer ids are stable.
    rm -rf "${BASE:?}/${node}/chains"
    echo "==> wiped ${BASE}/${node}/chains"
done

echo "==> starting devnet from genesis"
systemctl --user start scalar-devnet.target
echo "Done. Watch with: journalctl --user -u scalar-alice -f"
