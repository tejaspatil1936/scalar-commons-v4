# Scalar Commons — devnet monitoring

Prometheus + Grafana (dashboard [13840](https://grafana.com/grafana/dashboards/13840))
scraping the five validators, and a self-hosted
[substrate-telemetry](https://github.com/paritytech/substrate-telemetry) that
the validators report to. Runs under docker compose on the same box as the
validators. `deploy/README.md` covers the validators themselves.

**Everything binds 127.0.0.1. Access is by SSH tunnel only** — see "Access".

| service            | bind             | what                                                         |
|--------------------|------------------|--------------------------------------------------------------|
| prometheus         | `127.0.0.1:9090` | scrapes validators on `127.0.0.1:9615-9619`, node-exporter   |
| grafana            | `127.0.0.1:3000` | dashboard 13840, provisioned; login `admin` / `.env`         |
| node-exporter      | `127.0.0.1:9100` | host CPU/RAM/disk/net for the dashboard's "Server Health" row |
| telemetry-core     | `127.0.0.1:8000` | aggregator; the browser's websocket `/feed`                  |
| telemetry-shard    | `127.0.0.1:8001` | validators submit here (`--telemetry-url`)                   |
| telemetry-frontend | `127.0.0.1:3001` | telemetry web UI                                             |

None of these collide with the validators (`9615-9619`, `9944-9948`,
`30333-30337`) or the products (`8080-8082`).

"Each validator's 9615 port": only alice is on 9615. The Nth node's prometheus
port is `9615+i` (`deploy/nodes.env`), so the scrape targets are 9615-9619 —
all on loopback, because no unit passes `--prometheus-external`.

Files:

```
deploy/monitoring/
├── README.md
├── docker-compose.yml                    the six services, pinned images
├── install.sh                            .env, dashboard, compose up, drop-ins
├── prometheus/prometheus.yml             scrape config (5 validators + node + self)
├── grafana/provisioning/datasources/     Prometheus datasource, uid "prometheus"
├── grafana/provisioning/dashboards/      file provider → grafana/dashboards/
├── grafana/dashboards/                   13840 lands here (generated, gitignored)
└── systemd/telemetry.conf.in             the validator drop-in template
```

---

## Install

Prerequisites on the box: Docker Engine with the compose plugin, `curl`,
`python3`. Run as **dev** (the user that owns the validator units), not root —
the drop-ins go into dev's `~/.config/systemd/user/`.

```bash
# one-time, as root: let dev drive docker. The docker group is root-equivalent
# on this box; that is the accepted cost of running the stack as dev.
sudo apt install docker.io docker-compose-plugin     # or Docker's own repo
sudo usermod -aG docker dev                          # then log out and back in

./deploy/monitoring/install.sh
```

`install.sh` is idempotent:

1. writes `deploy/monitoring/.env` (0600) with a random `GRAFANA_ADMIN_PASSWORD`
   on first run; never overwrites it. Compose refuses to start without it
   rather than falling back to `admin/admin`.
2. downloads dashboard 13840 at a **pinned revision with a sha256 check**, and
   patches it for this chain: metric namespace `polkadot` → `substrate`, the two
   AlertManager panels removed (no such datasource here), header link pointed at
   our telemetry. If grafana.com is unreachable on a re-run it keeps the
   existing copy.
3. `docker compose pull && docker compose up -d`. Containers are
   `restart: unless-stopped`, so they come back with dockerd after a reboot.
4. renders the telemetry drop-in for every node in `deploy/nodes.env` and runs
   `systemctl --user daemon-reload`. **It does not restart any validator** —
   see "Activating telemetry".

---

## The telemetry drop-in

Each validator gets `~/.config/systemd/user/scalar-<node>.service.d/telemetry.conf`:

```ini
[Service]
ExecStart=
ExecStart=/home/dev/scalar-commons-v4/target/release/scalar-node \
    --chain /home/dev/scalar-commons-v4/deploy/scalar-local-raw.json \
    ...every flag from deploy/systemd/scalar-<node>.service, verbatim... \
    --telemetry-url "ws://127.0.0.1:8001/submit 0"
```

systemd cannot append to an `ExecStart`; a drop-in must clear it (the empty
`ExecStart=`) and restate the whole command. So `install.sh` generates the
drop-in from the repo unit rather than shipping five hand-copied command lines
that would drift. The consequence to remember:

> **After editing any `deploy/systemd/scalar-*.service`, re-run
> `deploy/monitoring/install.sh`.** Otherwise the drop-in keeps overriding the
> unit with the old command line, and your edit silently does nothing.

Check what a validator will actually run:

```bash
systemctl --user cat scalar-alice          # unit + drop-in, in order
systemctl --user show scalar-alice -p ExecStart
```

The chainspec's `telemetryEndpoints` is `null`, so this local shard is each
node's only telemetry destination — nothing goes to `telemetry.polkadot.io`.

### Activating telemetry

The drop-ins take effect on restart. Restart **one validator at a time, alice
last**, and let finality advance between each — two down of five leaves three,
below GRANDPA's threshold of four (`deploy/README.md` "Fault tolerance"):

```bash
for n in eve dave charlie bob alice; do
    systemctl --user restart "scalar-$n" && sleep 30 && ./deploy/finality-check.sh
done
```

### Removing it

```bash
rm ~/.config/systemd/user/scalar-*.service.d/telemetry.conf
systemctl --user daemon-reload      # then the same rolling restart
```

---

## Access

Nothing is reachable from outside the box, deliberately: Prometheus, the
exporters and telemetry have no authentication at all, and Grafana's login is
not a reason to expose it. Tunnel in from your laptop:

```bash
ssh -N \
    -L 3000:127.0.0.1:3000 \
    -L 3001:127.0.0.1:3001 \
    -L 8000:127.0.0.1:8000 \
    -L 9090:127.0.0.1:9090 \
    dev@<box>
```

then open:

- Grafana — <http://localhost:3000> (user `admin`, password from
  `deploy/monitoring/.env` on the box). Home dashboard is
  *Scalar Commons — Substrate (13840)*; pick the validator in **Chain Instance Host**.
- Telemetry — <http://localhost:3001>. **Port 8000 must be tunnelled too**: the
  UI is static, and your *browser* opens `ws://localhost:8000/feed` to get data.
  Without that forward the page loads and stays empty.
- Prometheus — <http://localhost:9090> (optional; targets at `/targets`).

If a local port is taken, change the left-hand side only (`-L 13000:127.0.0.1:3000`)
— except 8000, which the telemetry UI has baked in as `SUBSTRATE_TELEMETRY_URL`.

### Why the ports stay private

Docker publishes ports through its own iptables chains, **ahead of ufw**. A
mapping written `"8001:8001"` would be reachable from the internet even with
ufw denying 8001. Every mapping in `docker-compose.yml` is therefore
`127.0.0.1:host:container`, and the host-networked services (Prometheus,
Grafana, node-exporter) set their listen address to 127.0.0.1 explicitly. To
confirm on the box:

```bash
sudo ss -ltnp | grep -E ':(3000|3001|8000|8001|9090|9100)\b'   # all 127.0.0.1
```

---

## Operating

```bash
cd deploy/monitoring
docker compose ps
docker compose logs -f telemetry-shard      # validators connecting show up here
docker compose restart grafana
docker compose down                          # stop; data volumes kept
docker compose down -v                       # stop AND delete prometheus/grafana data
```

- Prometheus retention defaults to 30 days; set `PROMETHEUS_RETENTION` in `.env`.
- Adding a validator: add it to `deploy/nodes.env` and `deploy/systemd/`
  (as usual), add a target to `prometheus/prometheus.yml`, re-run `install.sh`.
- Images are pinned in `docker-compose.yml`; bump deliberately, one at a time.

### What the dashboard does not show

- **Thread count / Thread CPU time** need a
  [process-exporter](https://github.com/ncabatoff/process-exporter), which this
  stack does not run. Those two panels stay empty.
- 13840 was written for Polkadot; a handful of Chain panels query metrics this
  node version may not export under the same name and show "No data".
  Block height, finality, block rate, peers and the Server Health row are the
  ones to watch.

### Troubleshooting

- **telemetry-frontend restart-loops with `socket() [::]:8000 failed (97)`** —
  the image's nginx also listens on IPv6, and the kernel has IPv6 disabled
  (`ipv6.disable=1`). Re-enable IPv6, or mount an `nginx.conf` without the
  `listen [::]:8000;` line over `/etc/nginx/nginx.conf`.
- **node-exporter fails with "not a shared or slave mount"** — the compose file
  already mounts `/` as plain `ro` for this reason; if you added `rslave`, drop it.
- **Grafana empty, Prometheus targets `down`** — the validators are not running,
  or a unit gained `--prometheus-port` changes that `prometheus.yml` does not
  know about.
