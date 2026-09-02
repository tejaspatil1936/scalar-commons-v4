# Public exposure — install steps

Issue #76. **A human runs every command on this page.** Nothing in
`deploy/public/` applies itself; `render-config.sh` only writes into
`deploy/public/rendered/`.

Do the steps in the order given. The ordering is not cosmetic: the firewall
closes before nginx listens, and certificates exist before the config that
references them is installed.

> **Not verified in CI.** The nginx config in this PR has never been parsed by
> nginx — the authoring host had neither nginx nor a container runtime, and
> installing it would have started a listener on the live devnet box. `nginx -t`
> in step 7 is the first real syntax check. Treat a failure there as expected
> work, not as a surprise.

---

## 0. Preconditions

- All five names resolve to this host: `<DOMAIN>`, `rpc.<DOMAIN>`,
  `api.<DOMAIN>`, `explorer.<DOMAIN>`, `faucet.<DOMAIN>`.
- The devnet is running and healthy (`deploy/finality-check.sh`).
- The three product services from issue #102 are up on 8080/8081/8082, or you
  accept that those three vhosts will 502 until they are.

Confirm the node is in safe mode before exposing anything — this is the control
that refuses unsafe RPC, and step 8 depends on it:

```bash
grep -n 'rpc-methods' deploy/systemd/scalar-*.service
# every validator must show:  --rpc-methods safe
```

---

## 1. Firewall first

Set the firewall **before** nginx starts listening, so there is no window where
:80/:443 are open without rules.

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing

sudo ufw allow 22/tcp                 comment 'ssh'
sudo ufw allow 80/tcp                 comment 'http - acme + redirect'
sudo ufw allow 443/tcp                comment 'https + wss'
sudo ufw allow 30333:30337/tcp        comment 'substrate p2p - alice..eve'

sudo ufw enable
sudo ufw status numbered
```

**RPC ports 9944–9948 are deliberately absent.** They stay loopback-only and
are reached exclusively through the nginx proxy on 443. `default deny incoming`
already blocks them; the explicit rules below exist so the intent is visible in
`ufw status` and nobody "helpfully" opens them later:

```bash
sudo ufw deny 9944:9948/tcp comment 'RPC stays loopback - proxy via 443 only'
```

Verify no RPC port is listening on a public interface:

```bash
ss -ltnp | grep -E '994[4-8]'    # every line must show 127.0.0.1, never 0.0.0.0
```

---

## 2. Install nginx and certbot

```bash
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx
```

---

## 3. Set the domain (the one substitution point)

Edit **`deploy/public/domain.env`** — the only file you change:

```bash
$EDITOR deploy/public/domain.env
# set DOMAIN=<your real domain>
# confirm LANDING_DIST / DOCS_DIST paths are right for this host
```

---

## 4. Render the configs

```bash
./deploy/public/render-config.sh
ls deploy/public/rendered/
# -> bootstrap-http.conf  scalar-commons.conf
```

The script refuses to run while `DOMAIN` is still `example.com`, and fails if
any placeholder survives substitution.

---

## 5. Build the static output

```bash
mkdir -p /var/www/acme
sudo chown "$USER" /var/www/acme

cd landing && npm ci && npm run build && cd ..
cd docs    && npm ci && npm run build && cd ..
```

> **Blocker for `/docs`.** `docs/.vitepress/config.mts` sets no `base`, so the
> build emits absolute `/assets/...` URLs and root-relative links like
> `/guide/run-a-node`. Served under `/docs/` those 404 — the pages render
> unstyled and internal links break.
>
> Fix before step 7, by setting `base: '/docs/'` in `docs/.vitepress/config.mts`
> and rebuilding. **That edit is intentionally not in this PR** — it is a source
> change, this round is config-only, and it overlaps issue #103, which serves
> docs at the same path via Pages. Land it there or in a small follow-up, but
> `/docs` will not work until it exists.

---

## 6. Bootstrap HTTP, then get certificates

The full config references `/etc/letsencrypt/live/<DOMAIN>/`, which does not
exist yet — install the bootstrap config first so `nginx -t` passes and ACME
has a webroot.

```bash
sudo cp deploy/public/rendered/bootstrap-http.conf /etc/nginx/sites-available/scalar-commons.conf
sudo ln -sf /etc/nginx/sites-available/scalar-commons.conf /etc/nginx/sites-enabled/scalar-commons.conf
sudo rm -f /etc/nginx/sites-enabled/default

sudo nginx -t && sudo systemctl reload nginx
```

One certificate covering all five names:

```bash
sudo certbot certonly --webroot -w /var/www/acme \
  -d <DOMAIN> \
  -d rpc.<DOMAIN> \
  -d api.<DOMAIN> \
  -d explorer.<DOMAIN> \
  -d faucet.<DOMAIN> \
  --agree-tos -m <your-email> --no-eff-email

sudo ls /etc/letsencrypt/live/<DOMAIN>/    # fullchain.pem, privkey.pem
```

Check the renewal timer is armed (certbot's package installs it):

```bash
systemctl list-timers | grep certbot
sudo certbot renew --dry-run
```

---

## 7. Swap in the real config

```bash
sudo cp deploy/public/rendered/scalar-commons.conf /etc/nginx/sites-available/scalar-commons.conf
sudo nginx -t          # <-- first real syntax check; fix anything it reports
sudo systemctl reload nginx
```

Use `reload`, not `restart`: reload keeps established connections alive.

---

## 8. Verify

Run every check in [VERIFY.md](VERIFY.md). Check (b) — unsafe RPC refused — is
the one that must not be skipped.

---

## Rollback

```bash
sudo rm -f /etc/nginx/sites-enabled/scalar-commons.conf
sudo nginx -t && sudo systemctl reload nginx
sudo ufw deny 80/tcp && sudo ufw deny 443/tcp
```

The chain keeps running throughout: nothing here changes node state, and the
validators' RPC never left loopback.
