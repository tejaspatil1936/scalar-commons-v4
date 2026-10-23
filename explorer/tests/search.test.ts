import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { BlockNotFoundError, type ExplorerChain } from '../src/chain.js';
import { searchPath } from '../src/routes.js';
import { createExplorerServer } from '../src/server.js';
import type { ChainInfo } from '../src/types.js';

/** The search field: the four formats resolve to their page; anything else is the "Nothing found" page. */

const ALICE = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
const BLOCK_HASH = `0x${'ab'.repeat(32)}`;
const EXTRINSIC_HASH = `0x${'cd'.repeat(32)}`;
const CHAIN: ChainInfo = { chain: 'Scalar Commons Local Testnet', specName: 'scalar-commons', specVersion: 309, tokenSymbol: 'CMN', tokenDecimals: 12, ss58Format: 42, genesisHash: `0x${'ff'.repeat(32)}` };

describe('the search resolver', () => {
  let server: Server;
  let base: string;
  const chain = {
    chainInfo: () => CHAIN,
    eventFieldTypes: () => null,
    heads: async () => ({ best: 1_166_072, finalized: 1_166_070 }),
    block: async (ref: { kind: string; hash?: string }) => {
      if (ref.hash === BLOCK_HASH) return { number: 7 };
      throw new BlockNotFoundError(`block ${ref.hash} not found on this chain`);
    },
    findExtrinsic: async (hash: string) => (hash === EXTRINSIC_HASH ? { number: 9, index: 2 } : null),
  } as unknown as ExplorerChain;

  beforeAll(async () => {
    server = createExplorerServer({ chain, onError: () => {} });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const go = (q: string) => fetch(`${base}${searchPath(q)}`, { redirect: 'manual' });

  it('resolves a block number, a block hash, an extrinsic hash, an extrinsic id and an address', async () => {
    expect((await go('42')).headers.get('location')).toBe('/block/42');
    expect((await go(' 42 ')).headers.get('location')).toBe('/block/42');
    expect((await go(BLOCK_HASH.toUpperCase().replace('0X', '0x'))).headers.get('location')).toBe(`/block/${BLOCK_HASH}`);
    expect((await go(EXTRINSIC_HASH)).headers.get('location')).toBe('/extrinsic/9/2');
    expect((await go('1166762-1')).headers.get('location')).toBe('/extrinsic/1166762/1');
    const account = await go(ALICE);
    expect(account.status).toBe(302);
    expect(account.headers.get('location')).toBe(`/account/${ALICE}`);
  });

  it('answers "Nothing found" with the field and the four formats for anything else', async () => {
    for (const q of ['nothing-here', '', `0x${'ee'.repeat(32)}`, 'swarm-0007', '0xdead']) {
      const response = await go(q);
      expect(response.status).toBe(404);
      const html = await response.text();
      expect(html).toContain(`Nothing found for ‘${q}’`);
      expect(html).toContain('A block number, such as <span class="sc-mono">1,166,072</span>');
      expect(html).toContain('An account address (SS58)');
      expect(html).toContain('role="search"');
    }
  });
});
