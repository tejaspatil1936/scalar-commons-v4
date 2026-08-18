import { describe, it, expect } from 'vitest';

import {
  accountPath,
  blockPath,
  classifySearch,
  extrinsicPath,
  parseBlockRef,
  parseRoute,
} from '../src/routes.js';

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

  it('accepts the "latest" alias so a link can always point at the head', () => {
    expect(parseBlockRef('latest')).toEqual({ kind: 'latest' });
  });

  it('rejects anything else rather than guessing', () => {
    expect(parseBlockRef('-1')).toBeNull();
    expect(parseBlockRef('1.5')).toBeNull();
    expect(parseBlockRef('0xdead')).toBeNull();
    expect(parseBlockRef('')).toBeNull();
  });
});

describe('parseRoute', () => {
  it('routes the index page', () => {
    expect(parseRoute('/')).toEqual({ kind: 'home' });
  });

  it('routes a block view by number and by hash', () => {
    expect(parseRoute('/block/42')).toEqual({ kind: 'block', ref: { kind: 'number', number: 42 } });
    expect(parseRoute(`/block/${BLOCK_HASH}`)).toEqual({
      kind: 'block',
      ref: { kind: 'hash', hash: BLOCK_HASH },
    });
  });

  it('routes an extrinsic view as (block, index) — the only stable coordinate on chain', () => {
    expect(parseRoute('/extrinsic/42/3')).toEqual({
      kind: 'extrinsic',
      ref: { kind: 'number', number: 42 },
      index: 3,
    });
  });

  it('routes an account view', () => {
    expect(parseRoute(`/account/${ALICE}`)).toEqual({ kind: 'account', address: ALICE });
  });

  it('routes search with its query string', () => {
    expect(parseRoute('/search?q=42')).toEqual({ kind: 'search', query: '42' });
  });

  it('reports a bad reference as a bad request, not as a missing page', () => {
    expect(parseRoute('/block/not-a-block')).toEqual({
      kind: 'badRequest',
      message: 'not a block number, block hash, or "latest": not-a-block',
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

  it('reports unknown paths as not found', () => {
    expect(parseRoute('/nope')).toEqual({ kind: 'notFound' });
    expect(parseRoute('/block')).toEqual({ kind: 'notFound' });
  });
});

describe('classifySearch', () => {
  it('sends a bare number to the block view', () => {
    expect(classifySearch(' 42 ')).toEqual({ kind: 'block', ref: { kind: 'number', number: 42 } });
  });

  it('sends a 32-byte hash to the block view', () => {
    expect(classifySearch(BLOCK_HASH)).toEqual({ kind: 'block', ref: { kind: 'hash', hash: BLOCK_HASH } });
  });

  it('sends an SS58 address to the account view', () => {
    expect(classifySearch(ALICE)).toEqual({ kind: 'account', address: ALICE });
  });

  it('refuses to guess at anything else', () => {
    expect(classifySearch('hello')).toEqual({
      kind: 'badRequest',
      message: 'not a block number, block hash, or account address: hello',
    });
  });
});

describe('path builders', () => {
  it('round-trips every view through parseRoute', () => {
    expect(parseRoute(blockPath({ kind: 'number', number: 7 }))).toEqual({
      kind: 'block',
      ref: { kind: 'number', number: 7 },
    });
    expect(parseRoute(blockPath({ kind: 'hash', hash: BLOCK_HASH }))).toEqual({
      kind: 'block',
      ref: { kind: 'hash', hash: BLOCK_HASH },
    });
    expect(parseRoute(blockPath({ kind: 'latest' }))).toEqual({ kind: 'block', ref: { kind: 'latest' } });
    expect(parseRoute(extrinsicPath({ kind: 'number', number: 7 }, 2))).toEqual({
      kind: 'extrinsic',
      ref: { kind: 'number', number: 7 },
      index: 2,
    });
    expect(parseRoute(accountPath(ALICE))).toEqual({ kind: 'account', address: ALICE });
  });
});
