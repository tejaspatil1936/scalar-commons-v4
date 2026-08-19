import { describe, it, expect } from 'vitest';

import { accountPath, blockPath, extrinsicPath, parseBlockRef, parseRoute } from '../src/routes.js';

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
    });
    expect(parseRoute(blockPath({ kind: 'hash', hash: BLOCK_HASH }))).toEqual({
      kind: 'block',
      ref: { kind: 'hash', hash: BLOCK_HASH },
    });
    expect(parseRoute(extrinsicPath({ kind: 'number', number: 7 }, 2))).toEqual({
      kind: 'extrinsic',
      ref: { kind: 'number', number: 7 },
      index: 2,
    });
    expect(parseRoute(accountPath(ALICE))).toEqual({ kind: 'account', address: ALICE });
  });
});
