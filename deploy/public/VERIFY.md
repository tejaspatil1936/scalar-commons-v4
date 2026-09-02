# Public exposure — verification

Run after [INSTALL.md](INSTALL.md) step 7. Replace `<DOMAIN>` with the real
domain. Every check states its pass condition; a check that does not clearly
pass is a failure — do not interpret a partial result as success.

Tooling:

```bash
sudo apt install -y curl
npm i -g wscat        # or: sudo apt install -y websocat
```

---

## (a) The wss endpoint answers `chain_getHeader`

```bash
wscat -c wss://rpc.<DOMAIN> \
  -x '{"jsonrpc":"2.0","id":1,"method":"chain_getHeader","params":[]}'
```

**Pass:** a JSON object with a `result` containing `parentHash`, `number`,
`stateRoot`. Shape, taken from the live node on 2026-09-02:

```json
{"jsonrpc":"2.0","id":1,"result":{
  "parentHash":"0x9ac0428566c64264f672962ba9ade65011da5c0b43c025815e8da0276bc0df0b",
  "number":"0x69c45",
  "stateRoot":"0xe882009f9b8bb05eb7f0e50f836b9b96ea6da7567367ce0be5fbd650a1982f22",
  "extrinsicsRoot":"0x92fe0062f9c378996c99b3eee046de58a609f1240a19b87298aa30e7783716d7",
  "digest":{"logs":["0x06424142453402000000000c14c41100000000", "..."]}}}
```

`number` is a moving head — `0x69c45` was 433,221 at capture. It must be
**greater** than that and must advance between two runs a few seconds apart:

```bash
for i in 1 2; do
  wscat -c wss://rpc.<DOMAIN> \
    -x '{"jsonrpc":"2.0","id":1,"method":"chain_getHeader","params":[]}' \
    | grep -o '"number":"[^"]*"'
  sleep 8
done
```

**Pass:** the second number is higher. A static head means you are talking to a
stalled node, not a working endpoint.

TLS is genuinely terminated (not a self-signed placeholder):

```bash
curl -sI https://rpc.<DOMAIN> | head -1
echo | openssl s_client -connect rpc.<DOMAIN>:443 -servername rpc.<DOMAIN> 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates
```

**Pass:** issuer is Let's Encrypt, `notAfter` is in the future, and the subject
/ SAN set covers `rpc.<DOMAIN>`.

---

## (b) `author_rotateKeys` and `author_insertKey` are REFUSED

**This is the check that matters.** Both must be refused *through the proxy*,
over wss — the path a real attacker uses.

```bash
wscat -c wss://rpc.<DOMAIN> \
  -x '{"jsonrpc":"2.0","id":1,"method":"author_rotateKeys","params":[]}'
```

```bash
wscat -c wss://rpc.<DOMAIN> \
  -x '{"jsonrpc":"2.0","id":1,"method":"author_insertKey","params":["aura","//Alice","0x00"]}'
```

**Pass — exactly this shape, captured from the live node on 2026-09-02:**

```json
{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"RPC call is unsafe to be called externally"}}
```

Pass condition, stated precisely:

- the response has an **`error`** member, and
- it has **no `result`** member, and
- `error.code` is **`-32601`**.

**Fail — treat as an incident, revoke exposure immediately:** any response
carrying a `result`. For `author_rotateKeys` a `result` is a freshly generated
session key, which means the endpoint is minting session keys for anonymous
callers.

### Where the refusal comes from

`--rpc-methods safe` on the node (`deploy/systemd/scalar-alice.service`).
**nginx is not filtering these method names and cannot** — it cannot see inside
WebSocket frames, and `$request_body` is unavailable in its rewrite phase. The
proxy contributes TLS and rate limiting, nothing more.

So the check is only meaningful while safe mode is on. Confirm the flag is
actually live on the running process, not merely present in the unit file:

```bash
systemctl --user show scalar-alice.service -p ExecStart | grep -o 'rpc-methods safe'
ps -ef | grep '[s]calar-node' | grep -c 'rpc-methods safe'   # expect 5
```

**Pass:** the flag appears for every running validator. If a unit file was
edited without a `daemon-reload` + restart, the file and the process disagree —
the process is what serves traffic.

Finally, confirm nothing bypasses the proxy:

```bash
nmap -Pn -p 9944-9948 <DOMAIN>       # run from a DIFFERENT host
```

**Pass:** all five `filtered` or `closed`. Any `open` means ufw is wrong — fix
before continuing.

---

## (c) Rate limiting triggers

Config: 10 r/s with `burst=20`, and 5 concurrent connections per IP.

```bash
for i in $(seq 1 60); do
  curl -s -o /dev/null -w '%{http_code}\n' https://rpc.<DOMAIN> &
done | sort | uniq -c
```

**Pass:** a mix of non-429 codes and a clear block of **`429`**. All-200 means
`limit_req` is not applying — check the zone is defined and the vhost is the one
actually serving.

Concurrent-connection cap (6 sockets, limit is 5):

```bash
for i in $(seq 1 6); do
  wscat -c wss://rpc.<DOMAIN> --wait 20 &
done
wait
```

**Pass:** at least one socket is rejected with HTTP 429 during the upgrade
handshake while the others stay open.

Confirm from the log side:

```bash
sudo grep -c 'limiting requests' /var/log/nginx/scalar-rpc.error.log
sudo tail -5 /var/log/nginx/scalar-rpc.error.log
```

**Pass:** count is non-zero and the entries name `zone=rpc_req` or
`zone=rpc_conn`.

> Scope, so the result is not over-read: `limit_req` on the wss vhost bounds
> **connection attempts**, not messages inside an already-open socket. One
> connection sending thousands of JSON-RPC calls is bounded by the node, not by
> nginx. Do not record this check as "RPC call rate is limited".

---

## (d) The four product URLs serve

```bash
curl -sI https://<DOMAIN>/           | head -1   # landing
curl -sI https://<DOMAIN>/docs/      | head -1   # docs
curl -sI https://faucet.<DOMAIN>/    | head -1   # 127.0.0.1:8082
curl -sI https://explorer.<DOMAIN>/  | head -1   # 127.0.0.1:8081
curl -sI https://api.<DOMAIN>/       | head -1   # 127.0.0.1:8080
```

**Pass:** each returns `200` (a product may legitimately return `302` to its own
entry path). `502` means the loopback service behind that vhost is down — an
issue #102 problem, not an nginx one. `404` on `/docs/` is the `base` blocker in
INSTALL.md step 5.

Landing serves real content, not an empty directory index:

```bash
curl -s https://<DOMAIN>/ | grep -o '<title>[^<]*</title>'
curl -sI https://<DOMAIN>/styles.css | head -1
```

Docs assets resolve under the `/docs/` prefix — this is what the missing `base`
breaks:

```bash
curl -s https://<DOMAIN>/docs/ | grep -oE '(src|href)="/[^"]*"' | head
```

**Pass:** asset paths begin with `/docs/assets/...`. If they begin with
`/assets/...`, the docs were built without `base: '/docs/'` and the site will
render unstyled — go back to INSTALL.md step 5.

API returns real indexer JSON:

```bash
curl -s https://api.<DOMAIN>/health
```

---

## HTTP redirect and security headers

```bash
curl -sI http://<DOMAIN>/ | head -3
```

**Pass:** `301` to `https://<DOMAIN>/`.

```bash
curl -sI https://<DOMAIN>/ | grep -i 'strict-transport\|x-content-type\|x-frame'
```

**Pass:** `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, and
`X-Frame-Options` all present.

---

## Result

Exposure is correct only when (a), (b), (c) and (d) all pass **and** the
`nmap` sweep in (b) shows 9944–9948 unreachable from off-host. If any check
fails, roll back per INSTALL.md before debugging in place.
