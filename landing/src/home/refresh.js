// Scalar Commons — the home page's one script (SITE-REDESIGN.md §7). Every
// 12 s while the tab is visible it reads the indexer and replaces the four
// figures of "Network right now" in place, then writes "Updated n s ago" under
// the row. A failed read keeps the figures that are there, marks the row Stale
// and says why in a callout. Nothing is animated and no unknown becomes a zero.
// Served as it is: no bundling, no imports.
const EVERY_MS = 12_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');
const utc = (d) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
const integer = (v) => Number.isInteger(v) && v >= 0;

function start(root) {
  const base = root.getAttribute('data-live');
  const fmt = new Intl.NumberFormat('en-US');
  const find = (sel) => root.querySelector(sel);
  const updated = find('[data-live-updated]');
  const stale = find('[data-live-stale]');
  const warning = find('[data-live-warning]');
  const reason = find('[data-live-reason]');
  let lastOk = null;
  let poll = null;
  let clock = null;

  const set = (key, text) => {
    const el = find(`[data-stat="${key}"] [data-value]`);
    if (el && el.textContent !== text) el.textContent = text;
  };
  const setCaption = (key, text) => {
    const el = find(`[data-stat="${key}"] [data-caption]`);
    if (el && el.textContent !== text) el.textContent = text;
  };
  const sayUpdated = () => {
    if (!lastOk) return;
    const s = Math.max(0, Math.round((Date.now() - lastOk.getTime()) / 1000));
    updated.textContent = `Updated ${s} s ago`;
    updated.title = utc(lastOk);
  };

  async function get(path) {
    const url = base + path;
    let res;
    try {
      res = await fetch(url, { headers: { accept: 'application/json' }, cache: 'no-store' });
    } catch (e) {
      throw new Error(`Can't reach the indexer (${url}): ${e && e.message ? e.message : 'no answer'}.`);
    }
    if (!res.ok) throw new Error(`The indexer answered HTTP ${res.status} for ${url}.`);
    try {
      return await res.json();
    } catch {
      throw new Error(`The indexer's answer for ${url} was not readable.`);
    }
  }

  async function read() {
    const [status, era, agents] = await Promise.allSettled([get('/status'), get('/eras/current'), get('/agents?limit=1')]);
    const failed = [];
    if (status.status === 'fulfilled') {
      const c = status.value.chain || {};
      if (integer(c.bestBlock)) set('height', fmt.format(c.bestBlock));
      if (integer(c.finalizedBlock)) set('finalized', fmt.format(c.finalizedBlock));
    } else failed.push(status.reason);
    if (era.status === 'fulfilled') {
      const e = era.value;
      if (integer(e.blocksElapsed)) set('era', fmt.format(e.blocksElapsed));
      if (integer(e.durationBlocks) && integer(e.era)) setCaption('era', `of ${fmt.format(e.durationBlocks)} blocks in era ${fmt.format(e.era)}`);
    } else failed.push(era.reason);
    if (agents.status === 'fulfilled') {
      const a = agents.value;
      // A truncated scan is a lower bound, not the count: the figure on the page stays.
      if (integer(a.total) && !a.truncated) set('agents', fmt.format(a.total));
    } else failed.push(agents.reason);

    if (failed.length === 0) {
      lastOk = new Date();
      stale.hidden = true;
      warning.hidden = true;
      sayUpdated();
      return;
    }
    const from = lastOk ? `Values are from ${utc(lastOk)}.` : 'The figures shown are from the build.';
    reason.textContent = `${failed[0].message} ${from}`;
    stale.hidden = false;
    warning.hidden = false;
  }

  const stop = () => {
    clearInterval(poll);
    clearInterval(clock);
    poll = clock = null;
  };
  const run = () => {
    if (poll) return;
    read();
    poll = setInterval(read, EVERY_MS);
    clock = setInterval(sayUpdated, 1000);
  };
  document.addEventListener('visibilitychange', () => (document.visibilityState === 'visible' ? run() : stop()));
  if (document.visibilityState === 'visible') run();
}

const root = document.querySelector('[data-live]');
if (root) start(root);
