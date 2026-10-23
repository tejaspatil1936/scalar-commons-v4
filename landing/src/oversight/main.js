// Boot for /oversight.
//
// The page arrives complete: every on-chain field and every plaintext is
// already in the markup, exactly as the read-only tool recorded it. This script
// adds the one check a record cannot do for itself: it recomputes blake2_256 of
// each decrypted plaintext in THIS browser and compares it with the recorded
// payload_hash commitment.
//
// It contacts no node. The record's chain is a local devnet that is not
// reachable from the internet, and the public RPC is a different chain, so a
// live re-read has nothing honest to compare against; the page says so in a
// callout. (rpc.js and the live branch of verify.js stay for the tool and its
// tests.)
//
// It also opens a collapsed message group when a link targets it or a message
// inside it, so the table of contents always lands on something visible.

import { initChrome } from '../chrome/behaviour/index.js';
import { verifyRow } from './verify.js';

/**
 * A message as the page shows it: the plaintext a reader sees in its code
 * block and the commitment recorded on the row. Hashing what is on screen is
 * the point — no second copy of the data is fetched.
 */
function rowOf(rowEl) {
  const code = rowEl.querySelector('.sc-code code');
  return { plaintext: code ? code.textContent : null, payloadHashOnChain: rowEl.dataset.payloadHash || null, reason: null };
}

const BADGE = { ok: ['sc-badge-ok', 'Succeeded'], bad: ['sc-badge-bad', 'Failed'] };

/** Sets one message's hash-check cell from the verdict. */
function renderCommitment(cell, row) {
  const verdict = verifyRow(row, null);
  if (!verdict.commitment) return null;
  const { computed, onChain, matches } = verdict.commitment;
  const badge = cell.querySelector('.sc-badge');
  const text = cell.querySelector('[data-check-text]');
  const [cls, word] = matches ? BADGE.ok : BADGE.bad;
  if (badge) {
    badge.className = `sc-badge ${cls}`;
    badge.textContent = word;
  }
  if (text) {
    // A mismatch is the one result this page must never hide, so both hashes are in the open.
    text.textContent = matches
      ? 'The plaintext hashes to the recorded commitment.'
      : `The plaintext does not hash to the commitment: computed ${computed}, recorded ${onChain}.`;
    text.title = `blake2_256(plaintext) = ${computed}`;
  }
  cell.dataset.state = matches ? 'ok' : 'bad';
  return matches;
}

/** Opens the <details> group that holds the link target, if it is closed. */
function openTarget() {
  const id = decodeURIComponent(window.location.hash.slice(1));
  if (!id) return;
  const target = document.getElementById(id);
  const details = target?.closest('details') ?? (target?.tagName === 'DETAILS' ? target : null);
  if (details && !details.open) {
    details.open = true;
    target.scrollIntoView?.();
  }
}

function boot() {
  try {
    initChrome();
  } catch {
    // the record and the hash check do not depend on the copy buttons
  }
  openTarget();
  window.addEventListener('hashchange', openTarget);

  const recheck = document.querySelector('[data-recheck]');
  const announce = document.querySelector('[data-announce]');
  const rowEls = [...document.querySelectorAll('[data-row]')];
  let hashed = 0;
  let matched = 0;
  for (const rowEl of rowEls) {
    const cell = rowEl.querySelector('[data-check="commitment"]');
    if (!cell) continue;
    const result = renderCommitment(cell, rowOf(rowEl));
    if (result === null) continue;
    hashed += 1;
    if (result) matched += 1;
  }
  const sentence = `${matched} of ${hashed} plaintexts hash to the recorded commitment`;
  if (recheck) recheck.textContent = sentence;
  if (announce) announce.textContent = `${sentence}, checked in this browser.`;
}

boot();
