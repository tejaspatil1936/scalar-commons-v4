// The words the /oversight page and its script share, so the markup the
// renderer writes and the text the script replaces it with come from one
// place. Every sentence is a claim about a check; none may overstate what was
// done (SITE-REDESIGN.md §6: plain English, sentence case).

/** The in-browser commitment check, by state. */
export const CHECK = {
  pending: 'Not yet hashed in this browser',
  recorded: 'Plaintext hashes to the recorded commitment',
  live: 'Plaintext hashes to the on-chain commitment',
  bad: 'Plaintext does not hash to the commitment',
  none: 'No plaintext to hash',
};

/** The signature check, which the operator's tool did, not this page. */
export const SIGNATURE = {
  ok: 'Signature verified by the operator’s tool',
  bad: 'Signature did not verify (operator’s tool)',
  method: 'sr25519 over blake2_256("ScalarMsg/v1|" ‖ genesis ‖ SCALE(envelope)), verified by the read-only tool',
};

/** The one sentence shown instead of a re-check when the record's node is not public. */
export const RECORDED_ONLY = 'Recorded values from the development chain. Re-checking them needs that chain, which is not public.';

const groups = new Intl.NumberFormat('en-US');
/** 703710 → "703,710": the chrome's formatInt, for the script, without the chrome's module. */
export const formatCount = (n) => groups.format(Number(n));

/** The page-level status of a re-check against a public node. */
export const STATUS = {
  reading: 'Re-reading each message from the chain in this browser.',
  offline: 'Offline — showing recorded values.',
  otherChain: 'This node is a different chain — showing recorded values.',
  live: (block) => `Live at block ${formatCount(block)}.`,
};

/** The per-message provenance line before and without a live read. */
export const PROVENANCE = {
  pending: 'Not yet re-read from the chain.',
  recorded: 'Recorded by the read-only tool.',
};

/** The word a row carries when the chain and the record do not match. */
export const DISAGREE_WORD = 'Disagrees with the record';

/** A message kind as the chain names it ("DeliveryNotice") in plain words ("Delivery notice"). */
export const kindWord = (kind) =>
  String(kind ?? '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/ ([A-Z])/g, (m) => m.toLowerCase());
