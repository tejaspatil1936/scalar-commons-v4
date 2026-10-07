// The checks /oversight claims to perform, held to the real bytes.
//
// This page tells a reader "your browser recomputed this hash and it matched".
// That sentence is only worth printing if the code behind it is tested against
// chain data rather than against itself, so:
//
//   - every plaintext in the checked-in sample is hashed and compared with the
//     payload_hash the chain recorded for it;
//   - the hash function is cross-checked against the site's OTHER, independent
//     blake2b (the one src/observatory/ss58.js uses for SS58 checksums), so a
//     fault in either implementation shows up as a disagreement;
//   - the live decoder runs on real extrinsics captured from the devnet, and
//     the account it decodes is re-encoded to SS58 and compared with the
//     address in the sample.
//
// None of it needs a network: the fixtures are checked in beside the test.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MESSAGE_KINDS,
  blake2_256,
  compactPrefixLength,
  decodeSendCall,
  hashText,
  hexToBytes,
  indexOfBytes,
  verifyRow,
} from '../../src/oversight/verify.js';
import { createRpc } from '../../src/oversight/rpc.js';
import { blake2b as ss58Blake2b, encodeSs58 } from '../../src/observatory/ss58.js';

const readJson = (relative) => JSON.parse(readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8'));
const sample = readJson('../../public/oversight-sample.json');
const fixture = readJson('./extrinsics.fixture.json');

test('every plaintext in the sample hashes to the payload_hash the chain recorded', () => {
  const withText = sample.rows.filter((row) => row.plaintext !== null);
  assert.ok(withText.length >= 20, `expected a useful number of readable rows, got ${withText.length}`);
  for (const row of withText) {
    assert.equal(
      hashText(row.plaintext),
      row.payloadHashOnChain,
      `row ${row.id}: blake2_256(plaintext) must equal the on-chain commitment`,
    );
    assert.equal(row.hashMatchesCommitment, true, `row ${row.id}: the tool must have reached the same conclusion`);
  }
});

test('the page’s blake2b-256 agrees with the site’s independent blake2b, byte for byte', () => {
  const inputs = [
    new Uint8Array(0),
    new TextEncoder().encode('offer: 25 CMN for report #7, deliver by block 1200000'),
    ...sample.rows.filter((r) => r.plaintext).slice(0, 8).map((r) => new TextEncoder().encode(r.plaintext)),
  ];
  for (const input of inputs) {
    const mine = blake2_256(input);
    const theirs = `0x${[...ss58Blake2b(input, 32)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
    assert.equal(mine, theirs, 'two independent blake2b implementations must agree');
  }
});

test('a row with no plaintext claims no commitment, and says why', () => {
  const shut = sample.rows.filter((row) => row.plaintext === null);
  assert.ok(shut.length > 0, 'the sample must include rows the operator could not read');
  for (const row of shut) {
    assert.equal(row.decrypted, false);
    assert.equal(row.hashMatchesCommitment, null);
    assert.match(row.reason, /no key held|never travelled on chain|does not match/i, `row ${row.id} must give a reason`);
    const verdict = verifyRow(row, null);
    assert.equal(verdict.commitment, null, 'nothing to hash means no commitment verdict');
  }
});

test('compact prefix lengths follow the SCALE boundaries the payload sizes land on', () => {
  assert.equal(compactPrefixLength(0), 1);
  assert.equal(compactPrefixLength(63), 1);
  assert.equal(compactPrefixLength(64), 2);
  assert.equal(compactPrefixLength(16_383), 2);
  assert.equal(compactPrefixLength(16_384), 4);
  assert.equal(compactPrefixLength(1_073_741_824), 5);
});

test('indexOfBytes finds a run, misses what is absent, and refuses an empty needle', () => {
  const hay = Uint8Array.from([1, 2, 3, 4, 5]);
  assert.equal(indexOfBytes(hay, Uint8Array.from([3, 4])), 2);
  assert.equal(indexOfBytes(hay, Uint8Array.from([1])), 0);
  assert.equal(indexOfBytes(hay, Uint8Array.from([4, 6])), -1);
  assert.equal(indexOfBytes(hay, Uint8Array.from([])), -1);
  assert.equal(indexOfBytes(hay, Uint8Array.from([1, 2, 3, 4, 5, 6])), -1);
});

test('the live decoder reads real extrinsics: signer, recipient, kind, agreement and commitment', () => {
  assert.ok(fixture.cases.length >= 2, 'need a case with an agreement and one without');
  let withAgreement = 0;
  let withoutAgreement = 0;
  for (const c of fixture.cases) {
    const live = decodeSendCall(c.extrinsicHex, { payloadHex: c.payloadHex, callIndex: fixture.callIndex });
    assert.ok(live.ok, `${c.id}: ${live.reason ?? 'should decode'}`);
    assert.equal(live.kind, c.expect.kind, `${c.id}: kind`);
    assert.equal(live.payloadHash, c.expect.payloadHash, `${c.id}: payload_hash read from the live call`);
    assert.equal(live.payloadLen, c.expect.payloadLen, `${c.id}: payload length`);
    // The decoded accounts are raw public keys; re-encoding proves they are the
    // very accounts the sample names, not merely 32 plausible bytes.
    assert.equal(encodeSs58(hexToBytes(live.from), 42), c.expect.from, `${c.id}: signer`);
    assert.equal(encodeSs58(hexToBytes(live.to), 42), c.expect.to, `${c.id}: recipient`);
    if (c.expect.agreement) {
      withAgreement += 1;
      assert.equal(encodeSs58(hexToBytes(live.agreement.account), 42), c.expect.agreement.account, `${c.id}: agreement account`);
      assert.equal(live.agreement.seq, c.expect.agreement.seq, `${c.id}: agreement seq`);
    } else {
      withoutAgreement += 1;
      assert.equal(live.agreement, null, `${c.id}: no agreement tag`);
    }
    // And the extrinsic really is the one the record names.
    assert.equal(blake2_256(hexToBytes(c.extrinsicHex)), c.extrinsicHash, `${c.id}: extrinsic hash`);
  }
  assert.ok(withAgreement > 0 && withoutAgreement > 0, 'both shapes of Option<(AccountId,u32)> must be covered');
});

test('the decoder refuses rather than guesses: wrong payload, wrong call index, rubbish input', () => {
  const c = fixture.cases[0];
  const absent = decodeSendCall(c.extrinsicHex, { payloadHex: '0xdeadbeef', callIndex: fixture.callIndex });
  assert.equal(absent.ok, false);
  assert.match(absent.reason, /does not carry the recorded payload/);

  const wrongCall = decodeSendCall(c.extrinsicHex, {
    payloadHex: c.payloadHex,
    callIndex: { pallet: fixture.callIndex.pallet + 1, call: 0 },
  });
  assert.equal(wrongCall.ok, false, 'a call index that is not messages.send must not decode');
  assert.match(wrongCall.reason, /messages\.send call index/);

  assert.equal(decodeSendCall('not hex', { payloadHex: c.payloadHex, callIndex: fixture.callIndex }).ok, false);
});

test('verifyRow compares against the live commitment when there is one, and says which it used', () => {
  const row = sample.rows.find((r) => r.plaintext !== null);
  const live = { ok: true, kind: row.kind, payloadHash: row.payloadHashOnChain };

  const liveVerdict = verifyRow(row, live);
  assert.equal(liveVerdict.against, 'live');
  assert.equal(liveVerdict.commitment.matches, true);
  assert.equal(liveVerdict.fieldsAgree, true);

  const offlineVerdict = verifyRow(row, null);
  assert.equal(offlineVerdict.against, 'recorded');
  assert.equal(offlineVerdict.commitment.matches, true);
  assert.equal(offlineVerdict.fieldsAgree, null, 'nothing live to agree with');
});

test('verifyRow reports a mismatch instead of hiding it', () => {
  const row = sample.rows.find((r) => r.plaintext !== null);
  const lying = { ok: true, kind: row.kind, payloadHash: `0x${'00'.repeat(32)}` };
  const verdict = verifyRow(row, lying);
  assert.equal(verdict.commitment.matches, false, 'a commitment that does not match must come back false');
  assert.equal(verdict.fieldsAgree, false, 'and the field disagreement must be reported too');

  const tampered = { ...row, plaintext: `${row.plaintext} ` };
  assert.equal(verifyRow(tampered, null).commitment.matches, false, 'one extra byte of plaintext must fail the check');
});

test('a wrong extrinsic hash is caught', () => {
  const c = fixture.cases[0];
  const row = sample.rows.find((r) => r.id === c.id);
  const good = verifyRow(row, null, { extrinsicHex: c.extrinsicHex });
  assert.equal(good.extrinsicHashMatches, true);
  const other = fixture.cases[1] ?? fixture.cases[0];
  const bad = verifyRow(row, null, { extrinsicHex: other.extrinsicHex === c.extrinsicHex ? '0x00' : other.extrinsicHex });
  assert.equal(bad.extrinsicHashMatches, false, 'a different extrinsic must not pass as this row’s');
});

test('MESSAGE_KINDS is the chain’s SCALE order, and every kind in the sample is one of them', () => {
  assert.deepEqual(MESSAGE_KINDS, ['Offer', 'Bid', 'Accept', 'Reject', 'DeliveryNotice', 'DisputeNote', 'Announce', 'Ping']);
  for (const row of sample.rows) assert.ok(MESSAGE_KINDS.includes(row.kind), `${row.kind} is not a MessageKind`);
});

test('the endpoint comes from the record alone: no script here reads the URL', () => {
  const dir = fileURLToPath(new URL('../../src/oversight/', import.meta.url));
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const src = readFileSync(join(dir, name), 'utf8');
    assert.ok(!/location\.search|URLSearchParams/.test(src), `${name} reads a URL flag`);
  }
  assert.equal(sample.provenance.httpEndpoint, sample.provenance.endpoint.replace('ws:', 'http:'));
});

test('an unreachable node is a recorded failure, never a silent success', async () => {
  const rpc = createRpc({
    endpoint: 'http://example.invalid',
    fetchImpl: () => Promise.reject(new Error('getaddrinfo ENOTFOUND')),
    now: () => new Date('2026-10-07T00:00:00Z'),
  });
  const identity = await rpc.identity();
  assert.equal(identity.ok, false);
  assert.equal(identity.error, 'unreachable');

  const block = await rpc.blockAt(702_782);
  assert.equal(block.ok, false);
  assert.equal(block.endpoint, 'http://example.invalid');
});

test('a node that answers gives back its tip and a block’s extrinsics, with provenance', async () => {
  const responses = {
    chain_getHeader: { number: '0xabcdef' },
    chain_getBlockHash: '0xfeed',
    chain_getBlock: { block: { extrinsics: ['0x01', '0x02'] } },
  };
  const rpc = createRpc({
    endpoint: 'http://node.test',
    fetchImpl: (_url, init) => {
      const { method } = JSON.parse(init.body);
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ result: responses[method] }) });
    },
    now: () => new Date('2026-10-07T12:00:00Z'),
  });
  const identity = await rpc.identity();
  assert.equal(identity.ok, true);
  assert.equal(identity.bestBlock, 0xabcdef);
  assert.equal(identity.at, '2026-10-07T12:00:00.000Z');

  const block = await rpc.blockAt(1);
  assert.deepEqual(block.extrinsics, ['0x01', '0x02']);
  assert.equal(block.blockHash, '0xfeed');
  assert.equal(block.endpoint, 'http://node.test');
});

test('an rpc error from the node is surfaced, not swallowed', async () => {
  const rpc = createRpc({
    endpoint: 'http://node.test',
    fetchImpl: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ error: { message: 'unknown block' } }) }),
  });
  const block = await rpc.blockAt(99);
  assert.equal(block.ok, false);
  assert.equal(block.error, 'unknown block');
});
