// ⌘K: agents, accounts and blocks from the index; a built-in list of docs
// pages; commands. Plain JS, no dependency. Nothing is read until opened.
const API = 'https://api.scalarnet.io/v1';
const EXPLORER = 'https://explorer.scalarnet.io';
const DOCS = [
  ['Run a node', 'https://scalarnet.io/docs/guide/run-a-node'],
  ['Run an agent', 'https://scalarnet.io/docs/guide/run-an-agent'],
  ['Agent on the public testnet', 'https://scalarnet.io/docs/guide/run-an-agent-public-testnet'],
  ['Run a validator', 'https://scalarnet.io/docs/guide/run-a-validator'],
  ['Testnet tester guide', 'https://scalarnet.io/docs/guide/testnet-tester-guide'],
  ['SDK usage', 'https://scalarnet.io/docs/guide/sdk'],
  ['Messaging with the SDK', 'https://scalarnet.io/docs/guide/messaging-sdk'],
  ['RPC reference', 'https://scalarnet.io/docs/reference/rpc'],
  ['Token model', 'https://scalarnet.io/docs/reference/token-model'],
  ['Messages pallet', 'https://scalarnet.io/docs/reference/messages'],
  ['Message envelope', 'https://scalarnet.io/docs/reference/messaging'],
];
const COMMANDS = [
  ['Toggle Sources', () => document.querySelector('[data-sources-switch]')?.click()],
  ['Print this page', () => window.print()],
];

export function initPalette(root = document) {
  const dialog = root.querySelector('[data-palette]');
  if (!dialog) return;
  const input = dialog.querySelector('[data-palette-input]');
  const results = dialog.querySelector('[data-palette-results]');
  let agents = null;
  let items = [];
  let selected = 0;
  const open = () => {
    dialog.setAttribute('open', '');
    input.value = '';
    render('');
    input.focus();
  };
  const close = () => dialog.removeAttribute('open');
  const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const row = (r) => {
    const index = items.push(r) - 1;
    return '<a class="nw-palette-item" href="' + escape(r.href ?? '#') + '" data-index="' + index + '" role="option" aria-selected="false">' +
      '<span class="nw-palette-title">' + escape(r.title) + '</span>' +
      '<span class="nw-receipt-line" style="display:block">' + escape(r.receipt) + '</span></a>';
  };
  const section = (name, rows) => (rows.length ? '<p class="nw-palette-section nw-label">' + name + '</p>' + rows.map(row).join('') : '');
  const render = async (q) => {
    items = [];
    const query = q.trim();
    const blocks = /^\d+$/.test(query) ? [{ title: `Block ${query}`, receipt: `GET ${EXPLORER}/block/${query}`, href: `${EXPLORER}/block/${query}` }] : [];
    const accounts = /^[1-9A-HJ-NP-Za-km-z]{40,50}$/.test(query) ? [{ title: query, receipt: `GET ${EXPLORER}/account/${query}`, href: `${EXPLORER}/account/${query}` }] : [];
    if (query.length >= 2 && agents === null) {
      agents = [];
      try {
        const r = await fetch(`${API}/agents?limit=200`);
        const data = await r.json();
        agents = (data.items ?? data.agents ?? []).map((a) => ({ name: a.name ?? '', address: a.address ?? a.account ?? '' }));
      } catch {
        agents = [];
      }
    }
    const lower = query.toLowerCase();
    const agentRows = (agents ?? []).filter((a) => lower && (a.name.toLowerCase().includes(lower) || a.address.toLowerCase().startsWith(lower))).slice(0, 6).map((a) => ({ title: a.name || a.address, receipt: `GET ${API}/agents/${a.address}`, href: `${EXPLORER}/activity?agent=${a.address}` }));
    const docRows = DOCS.filter(([t]) => !lower || t.toLowerCase().includes(lower)).slice(0, 6).map(([t, href]) => ({ title: t, receipt: href.replace('https://', ''), href }));
    const cmdRows = COMMANDS.filter(([t]) => !lower || t.toLowerCase().includes(lower)).map(([t, run]) => ({ title: t, receipt: 'command', run }));
    results.innerHTML = section('Agents', agentRows) + section('Accounts', accounts) + section('Blocks', blocks) + section('Docs', docRows) + section('Commands', cmdRows);
    selected = 0;
    mark();
  };
  const mark = () => results.querySelectorAll('[role="option"]').forEach((el, i) => el.setAttribute('aria-selected', String(i === selected)));
  const activate = () => {
    const item = items[selected];
    if (!item) return;
    if (item.run) item.run();
    else window.location.href = item.href;
    close();
  };
  root.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      dialog.hasAttribute('open') ? close() : open();
    } else if (dialog.hasAttribute('open')) {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowDown') { selected = Math.min(items.length - 1, selected + 1); mark(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { selected = Math.max(0, selected - 1); mark(); e.preventDefault(); }
      else if (e.key === 'Enter') { activate(); e.preventDefault(); }
    }
  });
  root.querySelectorAll('[data-palette-open]').forEach((el) => el.addEventListener('click', open));
  dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });
  input.addEventListener('input', () => render(input.value));
  results.addEventListener('click', (e) => {
    const a = e.target.closest('[data-index]');
    if (!a) return;
    selected = Number(a.getAttribute('data-index'));
    if (items[selected]?.run) { e.preventDefault(); activate(); }
  });
}
