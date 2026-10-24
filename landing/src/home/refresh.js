// The home page's one script (SITE-REDESIGN.md §5.1, §7). Plain, not bundled.
//
// Every 12 s while the tab is visible it re-reads the four "Network right now"
// figures from the public indexer and replaces their text in place, with
// "Updated n s ago" under the row. A failed read keeps the last value, marks
// the row Stale and shows the warning callout with the plain cause; it never
// writes a zero or a blank for something it could not read.
//
// When the build record has no genesis mint, it also reads total issuance at
// the genesis block from the public node, once.
const root = document.getElementById('network-now');
const fmt = new Intl.NumberFormat('en-US');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');
const utc = (ms) => {
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
};
const ago = (ms) => {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  return s < 60 ? `${s} s ago` : s < 3600 ? `${Math.floor(s / 60)} min ago` : `at ${utc(ms)}`;
};
const count = (v) => (Number.isInteger(v) && v >= 0 ? fmt.format(v) : null);

if (root) {
  const api = root.dataset.api;
  const q = (sel) => root.querySelector(sel);
  const value = (key) => q(`[data-stat="${key}"] [data-value]`);
  const set = (key, text) => {
    if (text) value(key).textContent = text;
  };
  let readAt = Date.parse(root.dataset.readAt);
  let live = false;
  let failure = null;
  let polls = 0;

  const get = async (path) => {
    const res = await fetch(`${api}${path}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`The indexer (${api}) answered ${res.status}.`);
    return res.json();
  };

  const paint = () => {
    if (live) q('[data-updated]').textContent = `Updated ${ago(readAt)}`;
    q('[data-stale]').hidden = !failure;
    q('[data-notice]').hidden = !failure;
    if (failure) q('[data-notice-text]').textContent = `${failure} Values are from ${utc(readAt)}.`;
  };

  const poll = async () => {
    if (document.visibilityState !== 'visible') return;
    try {
      // The agent count costs the indexer a storage scan: read it every fifth poll (once a minute).
      const [status, era, agents] = await Promise.all([get('/status'), get('/eras/current'), polls % 5 ? null : get('/agents?limit=1')]);
      const chain = status.chain ?? {};
      const height = count(chain.bestBlock);
      if (!height) throw new Error(`The indexer (${api}) gave no block height.`);
      set('height', height);
      set('finalized', count(chain.finalizedBlock));
      if (agents && !agents.truncated) set('agents', count(agents.total));
      if (count(era.blocksElapsed) && count(era.durationBlocks)) {
        set('era', count(era.blocksElapsed));
        q('[data-stat="era"] [data-caption]').textContent = `of ${count(era.durationBlocks)} blocks`;
      }
      readAt = Date.now();
      live = true;
      failure = null;
      polls += 1;
    } catch (e) {
      failure = e instanceof TypeError ? `Can't reach the indexer (${api}).` : e.message;
    }
    paint();
  };

  poll();
  setInterval(poll, 12_000);
  setInterval(paint, 1_000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - readAt > 12_000) poll();
  });
}

// The genesis mint, when the build record lacks it: Balances.TotalIssuance at block 0.
const genesis = document.querySelector('[data-genesis]');
if (genesis) {
  const { rpc, key, decimals, symbol } = genesis.dataset;
  const ws = new WebSocket(rpc);
  const calls = new Map();
  let id = 0;
  const call = (method, params) =>
    new Promise((ok, no) => {
      calls.set(++id, [ok, no]);
      ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  const fail = () => {
    if (genesis.querySelector('.sc-skeleton')) genesis.textContent = `Can't reach the node (${rpc}).`;
  };
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    const pending = calls.get(msg.id);
    if (pending) pending[msg.error ? 1 : 0](msg.error ?? msg.result);
  };
  ws.onerror = fail;
  // A socket the node closes before answering, or a node that never answers,
  // ends in the plain cause too: the cell never keeps its skeleton for good.
  ws.onclose = fail;
  setTimeout(() => {
    fail();
    ws.close();
  }, 15_000);
  ws.onopen = async () => {
    try {
      const hash = await call('chain_getBlockHash', [0]);
      const raw = await call('state_getStorage', [key, hash]);
      if (!raw) throw new Error('empty');
      let plancks = 0n;
      for (let i = raw.length - 2; i >= 2; i -= 2) plancks = plancks * 256n + BigInt(parseInt(raw.slice(i, i + 2), 16));
      const scale = 10n ** BigInt(decimals);
      const cents = ((plancks % scale) * 100n) / scale;
      const span = document.createElement('span');
      span.title = `${plancks} plancks, read from the node at the genesis block`;
      span.textContent = `${fmt.format(plancks / scale)}${cents ? `.${String(cents).padStart(2, '0').replace(/0$/, '')}` : ''} ${symbol}`;
      genesis.replaceChildren(span);
    } catch {
      fail();
    } finally {
      ws.close();
    }
  };
}
