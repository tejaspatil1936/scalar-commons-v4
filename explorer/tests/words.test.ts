import { describe, it, expect } from 'vitest';

import { CHIPS, KINDS, accountFields, callWords, describeEvent, eventWords, kindOf } from '../src/words.js';

/**
 * The one table from `pallet.Event` to plain words, shared by the activity
 * feed and the block and extrinsic pages, and the call table beside it.
 */

const ALICE = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
const BOB = '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty';
const TOKEN = { decimals: 12, symbol: 'CMN' };

describe('eventWords', () => {
  it('names the agent events in plain words, with a badge for disputes and slashes', () => {
    expect(eventWords('escrow', 'AgreementCreated')).toEqual({ label: 'Agreement opened', kind: 'agreement' });
    expect(eventWords('agents', 'HeartbeatSent')).toEqual({ label: 'Heartbeat sent', kind: 'heartbeat' });
    expect(eventWords('escrow', 'DisputeOpened')).toEqual({ label: 'Dispute opened', badge: 'Dispute', kind: 'dispute' });
    expect(eventWords('agents', 'SlashExecuted')).toEqual({ label: 'Agent slashed', badge: 'Slashed', kind: 'slash' });
    expect(eventWords('messages', 'MessageSent').label).toBe('Message sent');
    expect(eventWords('oracle', 'BatchResponseSubmitted').label).toBe('Oracle answers submitted');
    expect(eventWords('system', 'ExtrinsicFailed')).toEqual({ label: 'Extrinsic failed', badge: 'Failed', omit: ['dispatch_info', 'dispatchInfo'] });
  });

  it('falls back to the method name as words for an event it does not know, never dropping it', () => {
    expect(eventWords('newPallet', 'SomethingHappened')).toEqual({ label: 'Something happened' });
  });

  it('classifies events into the indexer’s families, exactly', () => {
    expect(KINDS).toEqual(['agreement', 'dispute', 'message', 'registration', 'slash', 'heartbeat', 'oracle_vote']);
    expect(kindOf('escrow', 'DeliveryConfirmed')).toBe('agreement');
    expect(kindOf('escrow', 'DisputeResolved')).toBe('dispute');
    expect(kindOf('messages', 'Anything')).toBe('message');
    expect(kindOf('agents', 'AgentRegistered')).toBe('registration');
    expect(kindOf('agents', 'SlashAppealed')).toBe('slash');
    expect(kindOf('oracle', 'OracleResponseSubmitted')).toBe('oracle_vote');
    expect(kindOf('balances', 'Transfer')).toBeNull();
    expect(kindOf('system', 'ExtrinsicSuccess')).toBeNull();
  });

  it('offers the six chips of the network page in order', () => {
    expect(CHIPS.map((c) => c.label)).toEqual(['All', 'Agreements', 'Disputes', 'Messages', 'Registrations', 'Slashes']);
    expect(CHIPS.map((c) => c.kind)).toEqual([null, 'agreement', 'dispute', 'message', 'registration', 'slash']);
  });
});

describe('callWords', () => {
  it('says what a call does, and splits an unknown one into words', () => {
    expect(callWords('agents', 'heartbeat')).toBe('Send a heartbeat');
    expect(callWords('escrow', 'createAgreement')).toBe('Open an agreement');
    expect(callWords('escrow', 'disputeDelivery')).toBe('Dispute a delivery');
    expect(callWords('balances', 'transferKeepAlive')).toBe('Transfer tokens (keeping the sender alive)');
    expect(callWords('timestamp', 'set')).toBe('Set the block time (inherent)');
    expect(callWords('newPallet', 'doTheThing')).toBe('Do the thing');
  });
});

describe('describeEvent', () => {
  it('formats a balance in CMN at two decimals with the full value in the title, from the typed kind or the field name', () => {
    expect(describeEvent('escrow', 'AgreementCreated', [{ name: 'amount', value: '12500000000000', kind: 'balance' }], TOKEN)).toBe('amount <span title="12.5 CMN">12.50 CMN</span>');
    expect(describeEvent('balances', 'Transfer', [{ name: 'amount', value: '12,500,000,000,000' }], TOKEN)).toBe('amount <span title="12.5 CMN">12.50 CMN</span>');
    expect(describeEvent('transactionPayment', 'TransactionFeePaid', [{ name: 'actual_fee', value: '108157176', kind: 'balance' }, { name: 'tip', value: '0', kind: 'balance' }], TOKEN)).toBe('actual fee <span title="0.000108157176 CMN">&lt;0.01 CMN</span>');
  });

  it('links accounts, or leaves them out when the table already names them', () => {
    const fields = [{ name: 'buyer', value: ALICE, kind: 'account' as const }, { name: 'provider', value: BOB }, { name: 'seq', value: '3', kind: 'plain' as const }];
    const shown = describeEvent('escrow', 'AgreementCreated', fields, TOKEN);
    expect(shown).toContain(`href="/account/${ALICE}"`);
    expect(shown).toContain(`href="/account/${BOB}"`);
    expect(shown).toContain('agreement #3');
    const hidden = describeEvent('escrow', 'AgreementCreated', fields, TOKEN, { showAccounts: false });
    expect(hidden).toBe('agreement #3');
    expect(accountFields(fields)).toEqual([ALICE, BOB]);
  });

  it('truncates hashes with the full value in the title, drops noise fields, humanizes names and escapes values', () => {
    expect(describeEvent('escrow', 'DisputeOpened', [{ name: 'request_id', value: `0x${'86'.repeat(32)}` }], TOKEN)).toBe(`request id <span class="sc-mono" title="0x${'86'.repeat(32)}">0x868686…868686</span>`);
    expect(describeEvent('system', 'ExtrinsicSuccess', [{ name: 'dispatchInfo', value: '{"weight":1}' }], TOKEN)).toBe('');
    expect(describeEvent('session', 'NewSession', [{ name: 'sessionIndex', value: '15' }], TOKEN)).toBe('session index 15');
    expect(describeEvent('x', 'Y', [{ name: 'note', value: '<b>hi</b>' }], TOKEN)).toBe('note &lt;b&gt;hi&lt;/b&gt;');
    expect(describeEvent('x', 'Y', [{ name: 'a', value: '1' }, { name: 'b', value: '2' }], TOKEN)).toBe('a 1 · b 2');
  });
});
