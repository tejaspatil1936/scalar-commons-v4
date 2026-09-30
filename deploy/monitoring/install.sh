#!/usr/bin/env bash
# Scalar Commons — monitoring installer for the production box.
#
# Brings up Prometheus, Grafana, node-exporter and a self-hosted
# substrate-telemetry (core + shard + frontend) under docker compose, every
# port bound to 127.0.0.1, and installs a telemetry drop-in for each validator.
# Run it as the user that owns the validators' user-systemd units (dev), from
# anywhere:
#
#     ./deploy/monitoring/install.sh
#
# What it does:
#   1. writes deploy/monitoring/.env (0600) with a random Grafana admin
#      password — first run only, never overwritten
#   2. downloads Grafana dashboard 13840 at a pinned revision, checks its
#      sha256, and patches it for this chain (see patch_dashboard below)
#   3. docker compose pull + up -d
#   4. renders systemd/telemetry.conf.in into
#      ~/.config/systemd/user/scalar-<node>.service.d/telemetry.conf for every
#      node in deploy/nodes.env, then daemon-reload
#
# Idempotent: safe to re-run, and re-running is REQUIRED after editing any
# deploy/systemd/scalar-*.service — see the template's header.
#
# It does NOT restart any validator. The drop-ins take effect on the next
# restart, and a restart is not free (deploy/README.md "Fault tolerance"): the
# rolling sequence is printed at the end.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HERE="${REPO}/deploy/monitoring"
UNIT_DIR="${HOME}/.config/systemd/user"
DASH_DIR="${HERE}/grafana/dashboards"
DASH_FILE="${DASH_DIR}/substrate-13840.json"

# Dashboard 13840 ("Polkadot Essentials 2021"), pinned. A new upstream revision
# changes this file's content without anyone reviewing it, so bumping is a
# deliberate edit of both lines.
DASH_ID=13840
DASH_REV=4
DASH_SHA256=3aa8fa7c5ca1778f2bc0698d65a15b532063dc05dfcaa05f52b3b64933bb8930

# shellcheck source=../nodes.env
source "${REPO}/deploy/nodes.env"

echo "==> repo:    ${REPO}"
echo "==> stack:   ${HERE}/docker-compose.yml"
echo "==> units:   ${UNIT_DIR}"
echo "==> nodes:   ${NODES[*]} (${#NODES[@]} validators)"

# ── preflight ────────────────────────────────────────────────────────────────
for bin in docker curl python3 sha256sum systemctl; do
    command -v "${bin}" >/dev/null || { echo "ERROR: ${bin} not found"; exit 1; }
done
docker compose version >/dev/null 2>&1 \
    || { echo "ERROR: the docker compose plugin is missing (apt install docker-compose-plugin)"; exit 1; }
docker info >/dev/null 2>&1 \
    || { echo "ERROR: cannot talk to the docker daemon as $(id -un)."
         echo "       Start it, or add this user to the docker group (root-equivalent;"
         echo "       see README.md) and log in again."; exit 1; }
for node in "${NODES[@]}"; do
    [[ -f "${REPO}/deploy/systemd/scalar-${node}.service" ]] \
        || { echo "ERROR: deploy/systemd/scalar-${node}.service missing"; exit 1; }
done

# ── 1. .env ──────────────────────────────────────────────────────────────────
if [[ -f "${HERE}/.env" ]]; then
    echo "==> .env exists, keeping it"
else
    pw="$(head -c 24 /dev/urandom | base64 | tr -d '/+=')"
    (umask 077 && printf 'GRAFANA_ADMIN_PASSWORD=%s\nPROMETHEUS_RETENTION=30d\n' "${pw}" > "${HERE}/.env")
    echo "==> wrote .env (0600) with a generated Grafana admin password"
fi
chmod 600 "${HERE}/.env"

# ── 2. dashboard 13840 ───────────────────────────────────────────────────────
# Patches, all of which exist because the dashboard was written for Polkadot:
#   - metric_namespace defaults to "polkadot"; this node exports substrate_*.
#   - chain_process (process-exporter) defaults to "polkadot"; set to
#     scalar-node. Those two panels stay empty unless a process-exporter is
#     added — not part of this stack.
#   - the two top panels query an AlertManager datasource plugin this stack does
#     not run; they are dropped rather than left as permanent red errors.
#   - __inputs/__requires are export metadata for the UI importer; provisioning
#     does not resolve them. ${DS_PROMETHEUS} still works because the dashboard
#     declares it as a datasource template variable, defaulting to the
#     datasource named "Prometheus" (grafana/provisioning/datasources).
#   - header links repointed from telemetry.polkadot.io & co. to our own UI.
#   - fixed uid, so re-runs update in place instead of duplicating.
patch_dashboard() {
    python3 - "$1" "$2" <<'PY'
import json, sys
src, dst = sys.argv[1], sys.argv[2]
d = json.load(open(src))
d.pop("__inputs", None)
d.pop("__requires", None)
d["panels"] = [p for p in d["panels"]
               if "ALERTMANAGER" not in str(p.get("datasource", ""))]
for v in d["templating"]["list"]:
    if v["name"] == "metric_namespace":
        v["current"] = {"selected": True, "text": "substrate", "value": "substrate"}
        v["query"] = "substrate"
        v["options"] = []
    elif v["name"] == "chain_process":
        v["current"] = {"selected": True, "text": "scalar-node", "value": "scalar-node"}
        v["query"] = "scalar-node"
        v["options"] = []
    elif v["name"] == "job":
        # node-exporter's job is "node" (prometheus/prometheus.yml).
        v["current"] = {"selected": True, "text": "node", "value": "node"}
# Header links pointed at Polkadot's public telemetry/explorers; the only one
# that means anything here is our own telemetry UI, at its tunnelled address.
d["links"] = [{"icon": "external link", "title": "Telemetry", "type": "link",
               "url": "http://localhost:3001", "targetBlank": True, "tags": []}]
d["uid"] = "substrate-13840"
d["title"] = "Scalar Commons — Substrate (13840)"
d["id"] = None
json.dump(d, open(dst, "w"), indent=2)
PY
}

tmp="$(mktemp -d)"
trap 'rm -rf "${tmp}"' EXIT
url="https://grafana.com/api/dashboards/${DASH_ID}/revisions/${DASH_REV}/download"
if curl -fsSL "${url}" -o "${tmp}/raw.json" \
    && echo "${DASH_SHA256}  ${tmp}/raw.json" | sha256sum -c --quiet -; then
    patch_dashboard "${tmp}/raw.json" "${tmp}/patched.json"
    install -m 644 "${tmp}/patched.json" "${DASH_FILE}"
    echo "==> dashboard ${DASH_ID} rev ${DASH_REV} -> ${DASH_FILE#"${REPO}"/}"
elif [[ -f "${DASH_FILE}" ]]; then
    echo "WARNING: could not fetch/verify dashboard ${DASH_ID}; keeping the existing copy"
else
    echo "ERROR: could not fetch dashboard ${DASH_ID} rev ${DASH_REV} or its sha256 did not match"
    exit 1
fi

# ── 3. stack ─────────────────────────────────────────────────────────────────
(cd "${HERE}" && docker compose pull --quiet && docker compose up -d --remove-orphans)

# ── 4. telemetry drop-ins ────────────────────────────────────────────────────
# Copies the ExecStart= line and its backslash continuations out of the repo
# unit (the same file deploy/install.sh installed) and splices it into the
# template in place of @EXECSTART@.
render_dropin() {
    local node="$1" unit="${REPO}/deploy/systemd/scalar-$1.service" exec_start
    exec_start="$(awk '
        /^ExecStart=/      { grab = 1 }
        grab               { print; if ($0 !~ /\\$/) exit }
    ' "${unit}")"
    [[ -n "${exec_start}" ]] || { echo "ERROR: no ExecStart= in ${unit}"; return 1; }
    while IFS= read -r line; do
        if [[ "${line}" == "@EXECSTART@ \\" ]]; then
            printf '%s \\\n' "${exec_start}"
        else
            printf '%s\n' "${line//@NODE@/${node}}"
        fi
    done < "${HERE}/systemd/telemetry.conf.in"
}

for node in "${NODES[@]}"; do
    dir="${UNIT_DIR}/scalar-${node}.service.d"
    mkdir -p "${dir}"
    render_dropin "${node}" > "${tmp}/telemetry.conf"
    install -m 644 "${tmp}/telemetry.conf" "${dir}/telemetry.conf"
    echo "==> installed ${dir#"${HOME}"/}/telemetry.conf"
done
systemctl --user daemon-reload

cat <<EOF

Monitoring is up (loopback only). Grafana login: admin / see ${HERE#"${REPO}"/}/.env

The telemetry drop-ins are installed but NOT active until each validator
restarts. Roll them ONE AT A TIME, alice last, letting finality advance between
each — two down of five stalls GRANDPA:

    for n in eve dave charlie bob alice; do
        systemctl --user restart "scalar-\$n" && sleep 30 && ./deploy/finality-check.sh
    done

From your laptop, tunnel in and open http://localhost:3000 (Grafana) and
http://localhost:3001 (telemetry):

    ssh -N -L 3000:127.0.0.1:3000 -L 3001:127.0.0.1:3001 -L 8000:127.0.0.1:8000 \\
        -L 9090:127.0.0.1:9090 dev@<this-box>
EOF
