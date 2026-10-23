// Boot for /oversight.
//
// The page arrives complete: every on-chain field and every plaintext is
// already in the markup, exactly as the read-only tool recorded it. This script
// adds what a record cannot do for itself —
//
//   1. it recomputes blake2_256 of each decrypted plaintext in THIS browser and
//      compares it with the payload_hash the chain carries: the recorded one,
//      or the live one when the node answered — and it says which;
//   2. only when the record names a public node, it re-reads each message's
//      extrinsic from that node, recomputes blake2_256 over those bytes to
//      confirm the extrinsic is the one the record names, and reads the call's
//      fields back out of it live.
//
// A record read from a private node (the development chain this sample came
// from) gets no re-check and no attempt at one: the page says so in one
// sentence and the hash check still runs, because it is arithmetic on bytes
// that are already here. Nothing here animates; values replace their text in
// place.

import { initChrome } from '../chrome/behaviour/index.js';
import { isPublicEndpoint } from './endpoint.js';
import { createRpc } from './rpc.js';
import { decodeSendCall, verifyRow } from './verify.js';
import { CHECK, PROVENANCE, STATUS, formatCount, kindWord } from './words.js';

/** The sample, fetched beside the page. */
async function loadSample() {
  const response = await fetch('oversight-sample.json', { cache: 'no-cache' });
  if (!response.ok) throw new Error(`oversight-sample.json: HTTP ${response.status}`);
  return response.json();
}

/** The live region under the title: one sentence for a screen reader when the work is done. */
function announce(message) {
  const region = document.querySelector('[data-announce]');
  if (region) region.textContent = message;
}

/** A record id is `block-eventIndex`; anything else never reaches a selector. */
const ID = /^\d+-\d+$/;

/** The elements of one message the script may change, found by the record id they carry. */
function elementsFor(id) {
  if (!ID.test(id)) return null;
  const one = (selector) => document.querySelector(`${selector}[data-for="${id}"]`);
  return {
    kind: one('[data-field="kind"]'),
    hash: one('[data-field="payloadHash"]'),
    check: one('[data-check="commitment"]'),
    prov: one('[data-prov="row"]'),
    disagree: one('[data-disagree]'),
  };
}

function setCheck(element, state, text, title = '') {
  if (!element) return;
  element.dataset.state = state;
  element.textContent = text;
  if (title) element.title = title;
  else element.removeAttribute('title');
}

/** The status callout above the record: one line about whether the chain answered. */
function setStatus(state, text) {
  const box = document.querySelector('[data-ov-status]');
  if (!box) return;
  box.dataset.state = state;
  const label = box.querySelector('[data-status-text]');
  if (label) label.textContent = text;
  const callout = box.querySelector('.sc-callout');
  if (callout) {
    callout.classList.remove('sc-callout-info', 'sc-callout-warning');
    callout.classList.add(state === 'live' || state === 'reading' ? 'sc-callout-info' : 'sc-callout-warning');
  }
}

/** The fifth figure, the reader's own: how many plaintexts this browser hashed to their commitment, and against which. */
function setRecheck(count, total, { live, block = null }) {
  const stat = document.querySelector('[data-stat="rechecked"]');
  if (!stat) return;
  const value = stat.querySelector('[data-value]');
  if (value) value.textContent = `${formatCount(count)} of ${formatCount(total)}`;
  const caption = stat.querySelector('[data-caption]');
  if (caption) caption.textContent = live ? `plaintexts hashed to the on-chain commitment at block ${formatCount(block)}` : 'plaintexts hashed to the recorded commitment';
}

const countOk = (all) => all.filter(({ els }) => els.check?.dataset.state === 'ok').length;

/**
 * The commitment check, which never depends on the network: the plaintext and
 * the recorded hash are both in the page. `live` upgrades what it is compared
 * against, it does not enable it.
 */
function renderCommitment(element, row, live) {
  const verdict = verifyRow(row, live);
  if (!verdict.commitment) {
    setCheck(element, 'na', CHECK.none, row.reason ?? '');
    return verdict;
  }
  const { computed, onChain, matches } = verdict.commitment;
  const against = verdict.against === 'live' ? 'the live on-chain commitment' : 'the recorded on-chain commitment';
  if (matches) {
    setCheck(element, 'ok', verdict.against === 'live' ? CHECK.live : CHECK.recorded, `blake2_256(plaintext) = ${computed}, which equals ${against}`);
  } else {
    // Shown honestly. A mismatch here is the one result this page must never
    // hide, so it is stated with both hashes in the open.
    setCheck(element, 'bad', CHECK.bad, `computed ${computed}, chain says ${onChain}`);
  }
  return verdict;
}

/** Mark a message as disagreeing with the record: the word is shown, the row is flagged for the stylesheet. */
function flagDisagreement(els) {
  if (els.disagree) els.disagree.removeAttribute('hidden');
  const row = (els.check ?? els.kind)?.closest('tr');
  if (row) row.dataset.disagrees = '';
}

/**
 * The provenance line of a message: where the live read came from, when, and
 * whether it agrees. A disagreement is written in the open and the row is
 * flagged; nothing on this page may go wrong quietly.
 */
function renderProvenance(els, { read, live, verdict }) {
  const line = els.prov;
  if (!read?.ok) {
    if (line) line.textContent = `${PROVENANCE.recorded} ${read?.endpoint ?? 'No endpoint'}: ${read?.error ?? 'unreachable'}.`;
    return;
  }
  const parts = [`Re-read from ${read.endpoint} at ${read.at}, block ${read.blockHash}`];
  let disagrees = false;
  if (!live?.ok) {
    parts.push(`could not decode the call: ${live?.reason}`);
  } else if (verdict.extrinsicHashMatches === false) {
    parts.push('the extrinsic hash does not match the record');
    disagrees = true;
  } else if (verdict.fieldsAgree === false) {
    parts.push('the live fields do not agree with the record');
    disagrees = true;
  } else {
    parts.push('extrinsic hash and fields agree with the record');
  }
  if (verdict.commitment?.matches === false) disagrees = true;
  if (disagrees) flagDisagreement(els);
  if (line) line.textContent = `${parts.join('; ')}.`;
}

/**
 * Show the live value of a field beside the recorded one when they differ.
 * They should never differ; if they do, the page says so rather than choosing.
 */
function markField(element, recorded, liveValue) {
  if (!element || liveValue === null || liveValue === undefined) return;
  if (liveValue === recorded) {
    element.dataset.live = 'agrees';
    return;
  }
  element.dataset.live = 'differs';
  const note = document.createElement('span');
  note.className = 'ov-live-differs';
  note.textContent = ` live: ${liveValue}`;
  element.after(note);
}

/**
 * A link into a shut group (from the contents, or from the index) opens it:
 * the browser scrolls to the target, and the target's <details> is opened
 * first so there is something to scroll to.
 */
function revealTarget() {
  const id = decodeURIComponent(location.hash.slice(1));
  if (!id) return;
  const target = document.getElementById(id);
  if (!target) return;
  for (let el = target; el; el = el.parentElement) if (el.tagName === 'DETAILS') el.open = true;
}

async function boot() {
  try {
    initChrome();
  } catch {
    // a browser without the chrome's globals still gets the record and the hash check
  }
  revealTarget();
  window.addEventListener('hashchange', revealTarget);

  let sample;
  try {
    sample = await loadSample();
  } catch (error) {
    announce(`The record could not be loaded: ${error.message}`);
    return;
  }

  const all = sample.rows.map((row) => ({ row, els: elementsFor(row.id) })).filter(({ els }) => els);

  // The hash check first, from what is already in the page: it must not wait on
  // a network that may never answer.
  for (const { row, els } of all) if (els.check) renderCommitment(els.check, row, null);

  // The gate (Appendix A, item 23): a private endpoint is never contacted.
  const endpoint = sample.provenance.httpEndpoint;
  if (!isPublicEndpoint(endpoint)) {
    setRecheck(countOk(all), all.length, { live: false });
    announce('The record came from a chain that is not public, so every value shown is the recorded one. The hash check ran here on the recorded commitment.');
    return;
  }

  const rpc = createRpc({ endpoint });
  const identity = await rpc.identity();

  if (!identity.ok) {
    setStatus('offline', STATUS.offline);
    for (const { els } of all) renderProvenance(els, { read: { ok: false, endpoint, error: identity.error }, live: null, verdict: {} });
    setRecheck(countOk(all), all.length, { live: false });
    announce('The chain could not be reached from this browser, so every row shows the recorded values. The hash check ran here on the recorded commitment.');
    return;
  }

  const sameChain = identity.genesisHash === null || identity.genesisHash.toLowerCase() === sample.provenance.genesisHash.toLowerCase();
  if (!sameChain) {
    // A different chain's blocks would decode into unrelated fields. Refuse
    // rather than present them as this sample's live values.
    setStatus('error', STATUS.otherChain);
    for (const { els } of all) {
      renderProvenance(els, { read: { ok: false, endpoint, error: `genesis ${identity.genesisHash} is not this sample's chain` }, live: null, verdict: {} });
    }
    setRecheck(countOk(all), all.length, { live: false });
    return;
  }

  setStatus('live', STATUS.live(identity.bestBlock));

  // One block read per row, in order, so a long sample does not open 40 sockets
  // at once. Blocks repeat, so they are read once each.
  const blocks = new Map();
  for (const { row, els } of all) {
    if (!blocks.has(row.block)) blocks.set(row.block, rpc.blockAt(row.block));
    const read = await blocks.get(row.block);
    const extrinsicHex = read.ok ? read.extrinsics[row.extrinsicIndex] : null;
    const live =
      extrinsicHex === null || extrinsicHex === undefined
        ? read.ok
          ? { ok: false, reason: `block ${formatCount(row.block)} has no extrinsic at index ${row.extrinsicIndex}` }
          : null
        : decodeSendCall(extrinsicHex, { payloadHex: row.payloadHex, callIndex: sample.provenance.callIndex });

    const verdict = verifyRow(row, live, { extrinsicHex: extrinsicHex ?? null });
    if (els.check) renderCommitment(els.check, row, live);
    if (live?.ok) {
      markField(els.hash, row.payloadHashOnChain, live.payloadHash);
      if (els.kind && live.kind !== row.kind) {
        els.kind.dataset.live = 'differs';
        els.kind.textContent = `${kindWord(row.kind)} (live: ${kindWord(live.kind)})`;
      }
    }
    renderProvenance(els, { read, live, verdict });
  }

  const verified = countOk(all);
  setRecheck(verified, all.length, { live: true, block: identity.bestBlock });
  announce(`${formatCount(verified)} of ${formatCount(all.length)} messages re-read from the chain and their commitments recomputed in this browser.`);
}

boot();
