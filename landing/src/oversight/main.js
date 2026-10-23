// Boot for /oversight.
//
// The page arrives complete: every on-chain field and every plaintext is
// already in the markup, exactly as the read-only tool recorded it. This script
// adds the two things a record cannot do for itself —
//
//   1. it re-reads each message's extrinsic from a node and recomputes
//      blake2_256 over those bytes, to confirm the extrinsic really is the one
//      the record names, and reads the call's fields back out of it live;
//   2. it recomputes blake2_256 of the decrypted plaintext in THIS browser and
//      compares it with the payload_hash the chain carries — the live one when
//      the node answered, the recorded one when it did not, and it says which.
//
// When the node cannot be reached (a public viewer, or an https page that may
// not call a plain-http node) every row falls back to the recorded commitment
// and the page says "offline — showing recorded values". The hash check still
// runs: it is arithmetic on bytes that are already here.

import { initChrome } from '../chrome/behaviour/index.js';
import { createRpc } from './rpc.js';
import { decodeSendCall, verifyRow } from './verify.js';

/** The sample: inlined for the standalone copy, otherwise fetched beside the page. */
async function loadSample() {
  const inline = document.getElementById('oversight-sample');
  if (inline) return JSON.parse(inline.textContent);
  const response = await fetch('oversight-sample.json', { cache: 'no-cache' });
  if (!response.ok) throw new Error(`oversight-sample.json: HTTP ${response.status}`);
  return response.json();
}

/** A minimal page bus: presenter.js and sources.js only ever call `announce`. */
function createContext() {
  const status = document.querySelector('.sr-status');
  return {
    announce(message) {
      if (status) status.textContent = message;
    },
  };
}

function setBadge(element, state, text, title = '') {
  if (!element) return;
  element.dataset.state = state;
  element.textContent = text;
  if (title) element.title = title;
  else element.removeAttribute('title');
}

/** The status Tag under the title: one line about whether the chain answered. */
function setBarState(state, text, detail = '') {
  const bar = document.querySelector('[data-ov-status]');
  if (!bar) return;
  bar.dataset.state = state;
  const label = bar.querySelector('[data-status-text]');
  if (label) label.textContent = text;
  const network = bar.querySelector('[data-status-network]');
  if (network && detail) network.textContent = detail;
}

const utcNow = () => new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');

/** The fifth figure, the reader's own: how many plaintexts this browser hashed to their commitment, and against which commitment. */
function setRecheck(count, total, { live, block = null }) {
  const el = document.querySelector('[data-reading="rechecked"]');
  if (!el) return;
  el.classList.remove('is-loading');
  const value = el.querySelector('[data-reading-value]');
  if (value) value.textContent = `${count} of ${total}`;
  el.querySelector('.nw-stub')?.setAttribute('data-state', live ? 'live' : 'record');
  const fetched = el.querySelector('[data-fetched]');
  if (fetched) fetched.textContent = `fetched ${utcNow()} · ${block === null ? 'recorded commitment' : `block ${block}`}`;
}

/**
 * Decrypted bodies lift once on scroll-in (--t-ui, the chrome's rule); under
 * reduced motion, or without an IntersectionObserver, they are already lifted.
 */
function liftOnScroll() {
  const bars = [...document.querySelectorAll('[data-lift] .nw-redaction')];
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced || typeof IntersectionObserver === 'undefined') {
    for (const bar of bars) bar.classList.add('is-lifted');
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-lifted');
        io.unobserve(entry.target);
      }
    },
    { threshold: 0.4 },
  );
  for (const bar of bars) io.observe(bar);
}

const countOk = (rowEls) => rowEls.filter((el) => el.querySelector('[data-check="commitment"] .ov-badge')?.dataset.state === 'ok').length;

/**
 * The commitment check, which never depends on the network: the plaintext and
 * the recorded hash are both in the page. `live` upgrades what it is compared
 * against, it does not enable it.
 */
function renderCommitment(element, row, live) {
  const verdict = verifyRow(row, live);
  const badge = element.querySelector('.ov-badge');
  if (!verdict.commitment) {
    setBadge(badge, 'na', 'No plaintext to hash', row.reason ?? '');
    return verdict;
  }
  const { computed, onChain, matches } = verdict.commitment;
  const against = verdict.against === 'live' ? 'the live on-chain commitment' : 'the recorded on-chain commitment';
  if (matches) {
    setBadge(
      badge,
      'ok',
      verdict.against === 'live'
        ? 'Plaintext hashes to on-chain commitment ✓'
        : 'Plaintext hashes to recorded commitment ✓',
      `blake2_256(plaintext) = ${computed}, which equals ${against}`,
    );
  } else {
    // Shown honestly. A mismatch here is the one result this page must never
    // hide, so it is stated with both hashes in the open.
    setBadge(badge, 'bad', 'Plaintext does NOT hash to the commitment ✗', `computed ${computed}, chain says ${onChain}`);
  }
  return verdict;
}

/**
 * The provenance line under a row: where the live read came from, and when.
 *
 * Provenance follows the site's rule and hides until the Sources switch or a
 * hover — but a DISAGREEMENT must not hide. When the chain and the record do
 * not match, the row is marked `data-disagrees` and the stylesheet pins its
 * line open, in the slash colour. Nothing on this page should be able to go
 * wrong quietly.
 */
function renderProvenance(rowEl, { read, live, verdict }) {
  const line = rowEl.querySelector('[data-prov="row"]');
  if (!line) return;
  if (!read?.ok) {
    line.textContent = `offline — showing recorded values (${read?.endpoint ?? 'no endpoint'}: ${read?.error ?? 'unreachable'})`;
    return;
  }
  const parts = [`re-read live from ${read.endpoint} at ${read.at}`, `block ${read.blockHash}`];
  let disagrees = false;
  if (!live?.ok) {
    parts.push(`could not decode the call: ${live?.reason}`);
  } else if (verdict.extrinsicHashMatches === false) {
    parts.push('the extrinsic hash does NOT match the record');
    disagrees = true;
  } else if (verdict.fieldsAgree === false) {
    parts.push('the live fields do NOT agree with the record');
    disagrees = true;
  } else {
    parts.push('extrinsic hash and fields agree with the record');
  }
  if (verdict.commitment?.matches === false) disagrees = true;
  if (disagrees) {
    rowEl.dataset.disagrees = '';
    rowEl.querySelector('.ov-disagree')?.removeAttribute('hidden');
  }
  line.textContent = parts.join(' · ');
}

/**
 * Show the live value of a field beside the recorded one when they differ.
 * They should never differ; if they do, the page says so rather than choosing.
 */
function markField(rowEl, selector, recorded, liveValue) {
  const cell = rowEl.querySelector(selector);
  if (!cell || liveValue === null || liveValue === undefined) return;
  if (liveValue === recorded) {
    cell.dataset.live = 'agrees';
    return;
  }
  cell.dataset.live = 'differs';
  const note = document.createElement('span');
  note.className = 'ov-live-differs';
  note.textContent = ` live: ${liveValue}`;
  cell.after(note);
}

async function boot() {
  const ctx = createContext();
  try {
    initChrome();
  } catch {
    // a browser without the chrome's globals still gets the record and the hash check
  }
  liftOnScroll();

  let sample;
  try {
    sample = await loadSample();
  } catch (error) {
    setBarState('error', 'Could not load the sample', error.message);
    return;
  }

  const byId = new Map(sample.rows.map((r) => [r.id, r]));
  const rowEls = [...document.querySelectorAll('[data-row]')];

  // The hash check first, from what is already in the page: it must not wait on
  // a network that may never answer.
  for (const rowEl of rowEls) {
    const row = byId.get(rowEl.dataset.row);
    if (!row) continue;
    const check = rowEl.querySelector('[data-check="commitment"]');
    if (check) renderCommitment(check, row, null);
  }

  const endpoint = sample.provenance.httpEndpoint;
  const rpc = createRpc({ endpoint });
  const identity = await rpc.identity();

  if (!identity.ok) {
    setBarState('offline', 'offline — showing recorded values', sample.provenance.chainName);
    for (const rowEl of rowEls) {
      renderProvenance(rowEl, { read: { ok: false, endpoint, error: identity.error }, live: null, verdict: {} });
    }
    setRecheck(countOk(rowEls), rowEls.length, { live: false });
    ctx.announce(
      'The chain could not be reached from this browser, so every row shows the recorded values. The hash check ran here on the recorded commitment.',
    );
    return;
  }

  const sameChain =
    identity.genesisHash === null || identity.genesisHash.toLowerCase() === sample.provenance.genesisHash.toLowerCase();
  if (!sameChain) {
    // A different chain's blocks would decode into unrelated fields. Refuse
    // rather than present them as this sample's live values.
    setBarState('error', 'this node is a different chain — showing recorded values', sample.provenance.chainName);
    for (const rowEl of rowEls) {
      renderProvenance(rowEl, {
        read: { ok: false, endpoint, error: `genesis ${identity.genesisHash} is not this sample's chain` },
        live: null,
        verdict: {},
      });
    }
    setRecheck(countOk(rowEls), rowEls.length, { live: false });
    return;
  }

  setBarState('live', `live at block #${identity.bestBlock}`, sample.provenance.chainName);

  // One block read per row, in order, so a long sample does not open 40 sockets
  // at once. Blocks repeat, so they are read once each.
  const blocks = new Map();
  for (const rowEl of rowEls) {
    const row = byId.get(rowEl.dataset.row);
    if (!row) continue;
    if (!blocks.has(row.block)) blocks.set(row.block, rpc.blockAt(row.block));
    const read = await blocks.get(row.block);
    const extrinsicHex = read.ok ? read.extrinsics[row.extrinsicIndex] : null;
    const live =
      extrinsicHex === null || extrinsicHex === undefined
        ? read.ok
          ? { ok: false, reason: `block #${row.block} has no extrinsic at index ${row.extrinsicIndex}` }
          : null
        : decodeSendCall(extrinsicHex, {
            payloadHex: row.payloadHex,
            callIndex: sample.provenance.callIndex,
          });

    const verdict = verifyRow(row, live, { extrinsicHex: extrinsicHex ?? null });
    const check = rowEl.querySelector('[data-check="commitment"]');
    if (check) renderCommitment(check, row, live);
    if (live?.ok) {
      markField(rowEl, '[data-field="payloadHash"]', row.payloadHashOnChain, live.payloadHash);
      const kind = rowEl.querySelector('.ov-kind');
      if (kind && live.kind !== row.kind) {
        kind.dataset.live = 'differs';
        kind.textContent = `${row.kind} (live: ${live.kind})`;
      }
    }
    renderProvenance(rowEl, { read, live, verdict });
  }

  const verified = countOk(rowEls);
  setRecheck(verified, rowEls.length, { live: true, block: identity.bestBlock });
  ctx.announce(`${verified} of ${rowEls.length} rows re-read from the chain and their commitments recomputed in this browser.`);
}

boot();
