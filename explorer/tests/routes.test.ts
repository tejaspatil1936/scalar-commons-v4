import { describe, it, expect } from 'vitest';

import { accountPath, activityPath, blockPath, blocksPath, extrinsicPath, parseBlockRef, parseExtrinsicId, parseRoute, searchPath } from '../src/routes.js';

const ALICE = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
const BLOCK_HASH = `0x${'12'.repeat(32)}`;

describe('parseBlockRef', () => {
  it('accepts a block number', () => {
    expect(parseBlockRef('218193')).toEqual({ kind: 'number', number: 218193 });
  });

  it('accepts a 32-byte block hash, normalised to lower case', () => {
    expect(parseBlockRef(`0x${'AB'.repeat(32)}`)).toEqual({
      kind: 'hash',
      hash: `0x${'ab'.repeat(32)}`,
    });
  });

  it('rejects anything else rather than guessing', () => {
    expect(parseBlockRef('latest')).toBeNull();
    expect(parseBlockRef('-1')).toBeNull();
    expect(parseBlockRef('1.5')).toBeNull();
    expect(parseBlockRef('0xdead')).toBeNull();
    expect(parseBlockRef('')).toBeNull();
  });

  it('rejects a number no u32 block number can hold, instead of passing it to the node', () => {
    // The runtime's BlockNumber is u32; anything above it cannot name a block,
    // and encoding it would fail inside polkadot-js rather than here — which
    // would surface as "the node did not answer" for what is a client typo.
    expect(parseBlockRef('4294967295')).toEqual({ kind: 'number', number: 4_294_967_295 });
    expect(parseBlockRef('4294967296')).toBeNull();
    expect(parseBlockRef('9007199254740991')).toBeNull();
  });
});

describe('parseRoute', () => {
  it('routes the index page', () => {
    expect(parseRoute('/')).toEqual({ kind: 'home' });
  });

  it('routes a block view by number and by hash, with the tab in the URL', () => {
    expect(parseRoute('/block/42')).toEqual({ kind: 'block', ref: { kind: 'number', number: 42 }, tab: 'extrinsics' });
    expect(parseRoute(`/block/${BLOCK_HASH}`)).toEqual({
      kind: 'block',
      ref: { kind: 'hash', hash: BLOCK_HASH },
      tab: 'extrinsics',
    });
    expect(parseRoute('/block/42?tab=events')).toEqual({ kind: 'block', ref: { kind: 'number', number: 42 }, tab: 'events' });
    expect(parseRoute('/block/42?tab=nope')).toEqual({ kind: 'badRequest', message: 'not a block tab: nope' });
  });

  it('routes the block list by page, the search field, and the extrinsic id the search accepts', () => {
    expect(parseRoute('/blocks')).toEqual({ kind: 'blocks', offset: 0 });
    expect(parseRoute('/blocks?offset=50')).toEqual({ kind: 'blocks', offset: 50 });
    expect(parseRoute('/blocks?offset=x')).toEqual({ kind: 'badRequest', message: 'not a page offset: x' });
    expect(parseRoute(searchPath('42'))).toEqual({ kind: 'search', query: '42' });
    expect(parseRoute('/search?q=%20hello%20')).toEqual({ kind: 'search', query: 'hello' });
    expect(parseExtrinsicId('1166762-1')).toEqual({ number: 1166762, index: 1 });
    expect(parseExtrinsicId('1166762')).toBeNull();
    expect(parseExtrinsicId('4294967296-0')).toBeNull();
  });

  it('routes an extrinsic view as (block, index) — the only stable coordinate on chain', () => {
    expect(parseRoute('/extrinsic/42/3')).toEqual({
      kind: 'extrinsic',
      ref: { kind: 'number', number: 42 },
      index: 3,
    });
  });

  it('routes an account view with its tab and page', () => {
    expect(parseRoute(`/account/${ALICE}`)).toEqual({ kind: 'account', address: ALICE, tab: 'extrinsics', offset: 0 });
    expect(parseRoute(`/account/${ALICE}?tab=activity&offset=25`)).toEqual({ kind: 'account', address: ALICE, tab: 'activity', offset: 25 });
    expect(parseRoute(`/account/${ALICE}?tab=nope`)).toEqual({ kind: 'badRequest', message: 'not an account tab: nope' });
  });

  it('reports a bad reference as a bad request, not as a missing page', () => {
    expect(parseRoute('/block/not-a-block')).toEqual({
      kind: 'badRequest',
      message: 'not a block number or block hash: not-a-block',
    });
    expect(parseRoute('/extrinsic/42/x')).toEqual({
      kind: 'badRequest',
      message: 'not an extrinsic index: x',
    });
    expect(parseRoute('/account/nonsense')).toEqual({
      kind: 'badRequest',
      message: 'not a valid SS58 account address: nonsense',
    });
  });

  it('reports an undecodable path segment as a bad request, not as a thrown error', () => {
    // decodeURIComponent throws URIError on a lone "%". Letting that escape
    // would unwind to the server's catch-all and be reported as 502 — blaming
    // the node for a malformed URL the node never saw.
    expect(parseRoute('/block/%')).toEqual({
      kind: 'badRequest',
      message: 'not a valid URL-encoded path segment: %',
    });
    expect(parseRoute('/extrinsic/%/0')).toEqual({
      kind: 'badRequest',
      message: 'not a valid URL-encoded path segment: %',
    });
    expect(parseRoute('/extrinsic/1/%')).toEqual({
      kind: 'badRequest',
      message: 'not a valid URL-encoded path segment: %',
    });
    expect(parseRoute('/account/%E0%A4%A')).toEqual({
      kind: 'badRequest',
      message: 'not a valid URL-encoded path segment: %E0%A4%A',
    });
  });

  it('reports a block number beyond u32 as a bad request', () => {
    expect(parseRoute('/block/9007199254740991')).toEqual({
      kind: 'badRequest',
      message: 'not a block number or block hash: 9007199254740991',
    });
  });

  it('reports unknown paths as not found', () => {
    expect(parseRoute('/nope')).toEqual({ kind: 'notFound' });
    expect(parseRoute('/block')).toEqual({ kind: 'notFound' });
  });
});

describe('path builders', () => {
  it('round-trips every view through parseRoute', () => {
    expect(parseRoute(blockPath({ kind: 'number', number: 7 }))).toEqual({
      kind: 'block',
      ref: { kind: 'number', number: 7 },
      tab: 'extrinsics',
    });
    expect(parseRoute(blockPath({ kind: 'hash', hash: BLOCK_HASH }, 'events'))).toEqual({
      kind: 'block',
      ref: { kind: 'hash', hash: BLOCK_HASH },
      tab: 'events',
    });
    expect(parseRoute(blocksPath(25))).toEqual({ kind: 'blocks', offset: 25 });
    expect(blocksPath()).toBe('/blocks');
    expect(parseRoute(accountPath(ALICE, { tab: 'activity', offset: 50 }))).toEqual({ kind: 'account', address: ALICE, tab: 'activity', offset: 50 });
    expect(parseRoute(activityPath(ALICE, 25, 'dispute'))).toEqual({ kind: 'activity', agent: ALICE, filter: 'dispute', offset: 25 });
    expect(parseRoute(extrinsicPath({ kind: 'number', number: 7 }, 2))).toEqual({
      kind: 'extrinsic',
      ref: { kind: 'number', number: 7 },
      index: 2,
    });
    expect(parseRoute(accountPath(ALICE))).toEqual({ kind: 'account', address: ALICE, tab: 'extrinsics', offset: 0 });
  });
});
