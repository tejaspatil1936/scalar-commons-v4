/**
 * Server-side HTML rendering.
 *
 * Pure functions from view model to markup: no chain access, no JavaScript
 * shipped to the browser, no client-side framework. An explorer is read-only by
 * nature, so a page that arrives fully rendered is both the simplest thing that
 * works and the one that keeps working when a node is slow — there is no second
 * round trip to fail.
 *
 * Every interpolated value goes through `escapeHtml`, because every value on
 * these pages came off a public chain and is therefore attacker-supplied.
 */

import { escapeHtml, formatBalance, formatTimestamp, shortHash } from './format.js';
import { accountPath, blockPath, extrinsicPath } from './routes.js';
import type { AccountView, BlockView, ChainInfo, EventView, ExtrinsicView, HomeView, Outcome } from './types.js';

const STYLES = `
:root { color-scheme: dark; --bg:#0d1117; --raised:#151b23; --border:#2a3340; --text:#e8edf3;
  --dim:#a3b0c0; --accent:#6fd3c7; --ok:#7ddba3; --bad:#f08c8c; }
* { box-sizing: border-box; }
body { margin:0; padding:0 1.5rem 4rem; background:var(--bg); color:var(--text);
  font:400 16px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
header, main, footer { max-width:64rem; margin-inline:auto; }
header { display:flex; flex-wrap:wrap; gap:1rem; align-items:baseline; justify-content:space-between;
  padding:1.5rem 0; border-bottom:1px solid var(--border); }
.wordmark { font-size:.8125rem; font-weight:600; letter-spacing:.16em; text-transform:uppercase;
  color:var(--accent); text-decoration:none; }
.chain { color:var(--dim); font-size:.8125rem; }
a { color:var(--accent); }
h1 { font-size:1.5rem; margin:2rem 0 .5rem; }
h2 { font-size:1rem; margin:2rem 0 .5rem; color:var(--dim); text-transform:uppercase; letter-spacing:.08em; }
code, .mono, td, th { font-family:ui-monospace, SFMono-Regular, Menlo, monospace; }
table { width:100%; border-collapse:collapse; font-size:.875rem; }
th, td { text-align:left; padding:.5rem .6rem; border-bottom:1px solid var(--border); vertical-align:top;
  word-break:break-all; }
th { color:var(--dim); font-weight:600; }
.kv th { width:14rem; }
.empty { color:var(--dim); font-style:italic; }
.ok { color:var(--ok); }
.bad { color:var(--bad); }
.unknown { color:var(--dim); }
footer { padding-top:2rem; color:var(--dim); font-size:.8125rem; }
`;

/** Wraps a page body in the shared chrome. `chain` is null before a connection exists. */
function layout(title: string, chain: ChainInfo | null, body: string): string {
  const identity = chain
    ? `${escapeHtml(chain.chain)} · ${escapeHtml(chain.specName)}/${chain.specVersion} · ${escapeHtml(
        chain.tokenSymbol,
      )}`
    : 'not connected';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLES}</style>
</head>
<body>
<header>
  <a class="wordmark" href="/">Scalar Commons Explorer</a>
  <span class="chain">${identity}</span>
</header>
<main>
${body}
</main>
<footer>Read directly from the node's runtime metadata. Nothing on this page is cached or hand-written.</footer>
</body>
</html>
`;
}

/** Renders a dispatch outcome, keeping "unknown" visibly distinct from "success". */
function outcomeCell(outcome: Outcome): string {
  switch (outcome.kind) {
    case 'success':
      return '<span class="ok">success</span>';
    case 'failed':
      return `<span class="bad">failed: ${escapeHtml(outcome.reason)}</span>`;
    case 'unknown':
      return '<span class="unknown">outcome not recorded</span>';
  }
}

function accountLink(address: string): string {
  return `<a class="mono" href="${escapeHtml(accountPath(address))}">${escapeHtml(address)}</a>`;
}

function blockLinkByNumber(number: number): string {
  return `<a href="${escapeHtml(blockPath({ kind: 'number', number }))}">${number}</a>`;
}

function blockLinkByHash(hash: string): string {
  return `<a class="mono" href="${escapeHtml(blockPath({ kind: 'hash', hash }))}">${escapeHtml(
    shortHash(hash),
  )}</a>`;
}

function kvTable(rows: readonly (readonly [string, string])[]): string {
  const body = rows
    .map(([key, value]) => `<tr><th>${escapeHtml(key)}</th><td>${value}</td></tr>`)
    .join('\n');
  return `<table class="kv"><tbody>\n${body}\n</tbody></table>`;
}

/** The index page: which chain this is, and the way in to the block view. */
export function renderHome(view: HomeView): string {
  const body = `<h1>Scalar Commons block explorer</h1>
<h2>Chain</h2>
${kvTable([
  ['Chain', escapeHtml(view.chain.chain)],
  ['Runtime', `${escapeHtml(view.chain.specName)} spec ${view.chain.specVersion}`],
  ['Token', `${escapeHtml(view.chain.tokenSymbol)} (${view.chain.tokenDecimals} decimals)`],
  ['SS58 format', String(view.chain.ss58Format)],
  ['Genesis hash', `<span class="mono">${escapeHtml(view.chain.genesisHash)}</span>`],
  ['Head', `${blockLinkByNumber(view.head.number)} ${blockLinkByHash(view.head.hash)}`],
])}`;

  return layout('Scalar Commons Explorer', view.chain, body);
}

/** A block, and the list of extrinsics that is the way through to everything else. */
export function renderBlock(view: BlockView, chain: ChainInfo): string {
  const extrinsics = view.extrinsics
    .map(
      (extrinsic) => `<tr>
  <td><a href="${escapeHtml(
    extrinsicPath({ kind: 'number', number: view.number }, extrinsic.index),
  )}">${view.number}-${extrinsic.index}</a></td>
  <td>${escapeHtml(`${extrinsic.section}.${extrinsic.method}`)}</td>
  <td>${extrinsic.signer ? accountLink(extrinsic.signer) : '<span class="empty">unsigned</span>'}</td>
  <td>${outcomeCell(extrinsic.outcome)}</td>
</tr>`,
    )
    .join('\n');

  const list =
    view.extrinsics.length === 0
      ? '<p class="empty">This block has no extrinsics.</p>'
      : `<table><thead><tr><th>Extrinsic</th><th>Call</th><th>Signer</th><th>Outcome</th></tr></thead>
<tbody>
${extrinsics}
</tbody></table>`;

  const body = `<h1>Block ${view.number}</h1>
${kvTable([
  ['Hash', `<span class="mono">${escapeHtml(view.hash)}</span>`],
  ['Parent', `<a class="mono" href="${escapeHtml(blockPath({ kind: 'hash', hash: view.parentHash }))}">${escapeHtml(view.parentHash)}</a>`],
  ['Time', escapeHtml(formatTimestamp(view.timestampMs))],
  ['State root', `<span class="mono">${escapeHtml(view.stateRoot)}</span>`],
  ['Extrinsics root', `<span class="mono">${escapeHtml(view.extrinsicsRoot)}</span>`],
  ['Runtime', `spec ${view.specVersion}`],
])}
<h2>Extrinsics (${view.extrinsics.length})</h2>
${list}`;

  return layout(`Block ${view.number}`, chain, body);
}

function eventRows(events: readonly EventView[]): string {
  if (events.length === 0) {
    return '<p class="empty">No events were recorded for this extrinsic.</p>';
  }
  const rows = events
    .map((event) => {
      const fields = event.fields
        .map((field) => `${escapeHtml(field.name)}: ${escapeHtml(field.value)}`)
        .join('<br>');
      return `<tr><td>${event.index}</td><td>${escapeHtml(
        `${event.section}.${event.method}`,
      )}</td><td>${fields}</td></tr>`;
    })
    .join('\n');
  return `<table><thead><tr><th>#</th><th>Event</th><th>Fields</th></tr></thead><tbody>
${rows}
</tbody></table>`;
}

/** One extrinsic, including the accounts it touched — the hop into the account view. */
export function renderExtrinsic(view: ExtrinsicView, chain: ChainInfo): string {
  const args =
    view.args.length === 0
      ? '<p class="empty">This call takes no arguments.</p>'
      : `<table><thead><tr><th>Argument</th><th>Type</th><th>Value</th></tr></thead><tbody>
${view.args
  .map(
    (arg) =>
      `<tr><td>${escapeHtml(arg.name)}</td><td>${escapeHtml(arg.type)}</td><td>${escapeHtml(
        arg.value,
      )}</td></tr>`,
  )
  .join('\n')}
</tbody></table>`;

  const accounts =
    view.accounts.length === 0
      ? '<p class="empty">This extrinsic named no accounts.</p>'
      : `<ul>${view.accounts.map((address) => `<li>${accountLink(address)}</li>`).join('')}</ul>`;

  const body = `<h1>Extrinsic ${view.block.number}-${view.index}</h1>
${kvTable([
  ['Call', escapeHtml(`${view.section}.${view.method}`)],
  ['Block', `${blockLinkByNumber(view.block.number)} <span class="mono">${escapeHtml(view.block.hash)}</span>`],
  ['Hash', `<span class="mono">${escapeHtml(view.hash)}</span>`],
  ['Signer', view.signer ? accountLink(view.signer) : '<span class="empty">unsigned (inherent)</span>'],
  ['Nonce', view.nonce === null ? '<span class="empty">—</span>' : String(view.nonce)],
  [
    'Tip',
    view.tip === null
      ? '<span class="empty">—</span>'
      : escapeHtml(formatBalance(view.tip, chain.tokenDecimals, chain.tokenSymbol)),
  ],
  ['Length', `${view.lengthBytes} bytes`],
  ['Outcome', outcomeCell(view.outcome)],
])}
<h2>Arguments</h2>
${args}
<h2>Accounts touched</h2>
${accounts}
<h2>Events</h2>
${eventRows(view.events)}`;

  return layout(`Extrinsic ${view.block.number}-${view.index}`, chain, body);
}

/** An account: the state the runtime holds for it, at the block it was read. */
export function renderAccount(view: AccountView, chain: ChainInfo): string {
  const balance = (value: bigint): string =>
    escapeHtml(formatBalance(value, chain.tokenDecimals, chain.tokenSymbol));

  const body = `<h1>Account</h1>
${kvTable([
  ['Address', `<span class="mono">${escapeHtml(view.address)}</span>`],
  ['Public key', `<span class="mono">${escapeHtml(view.publicKey)}</span>`],
  ['Free', balance(view.free)],
  ['Reserved', balance(view.reserved)],
  ['Frozen', balance(view.frozen)],
  ['Nonce', String(view.nonce)],
  ['State read at', `${blockLinkByNumber(view.at.number)} <span class="mono">${escapeHtml(view.at.hash)}</span>`],
])}`;

  return layout('Account', chain, body);
}

/** An error page. The reason is chain- or user-supplied, so it is escaped like any other value. */
export function renderError(status: number, message: string, chain: ChainInfo | null): string {
  const body = `<h1>${status}</h1>
<p>${escapeHtml(message)}</p>`;
  return layout(`${status}`, chain, body);
}
