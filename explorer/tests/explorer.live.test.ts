import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import { ApiPromise, WsProvider } from '@polkadot/api';
import { Keyring } from '@polkadot/keyring';
import type { KeyringPair } from '@polkadot/keyring/types';
import { cryptoWaitReady, mnemonicGenerate } from '@polkadot/util-crypto';

import { connectExplorerChain, type ExplorerChain } from '../src/chain.js';
import { createExplorerServer } from '../src/server.js';

/**
 * These tests run against the LIVE devnet RPC. Nothing here is mocked and
 * nothing is skippable: an explorer's entire job is to render what a real node
 * really returns, so a mocked chain would assert nothing about the thing that
 * can actually break — type shapes decoded from runtime metadata.
 *
 * If the node is unreachable the suite FAILS rather than skipping. An
 * unreachable node is a blocking finding, per issue #71.
 */

const RPC_ENDPOINT = process.env.EXPLORER_RPC_ENDPOINT ?? 'ws://127.0.0.1:9944';

/** Genesis-endowed devnet account used only to author one real signed extrinsic. */
const TEST_SEED = process.env.EXPLORER_TEST_SEED ?? '//Eve';

const ONE_CMN = 1_000_000_000_000n;

let api: ApiPromise;
let chain: ExplorerChain;
let server: Server;
let baseUrl: string;
let keyring: Keyring;

/** A real signed extrinsic, on a real block, authored by this suite. */
interface Fixture {
  blockNumber: number;
  blockHash: string;
  extrinsicIndex: number;
  extrinsicHash: string;
  sender: string;
  recipient: string;
}
let transfer: Fixture;

async function get(path: string): Promise<{ status: number; body: string }> {
  const response = await fetch(`${baseUrl}${path}`);
  return { status: response.status, body: await response.text() };
}

/** Signs and submits one transfer, then locates it in the block it landed in. */
async function submitTransfer(sender: KeyringPair, recipient: string): Promise<Fixture> {
  const tx = api.tx.balances.transferKeepAlive(recipient, ONE_CMN);
  const blockHash = await new Promise<string>((resolve, reject) => {
    tx.signAndSend(sender, { nonce: -1 }, (result) => {
      if (result.isError) {
        reject(new Error(`transfer submission failed: ${result.status.type}`));
      } else if (result.status.isInBlock) {
        resolve(result.status.asInBlock.toHex());
      }
    }).catch(reject);
  });

  const signedBlock = await api.rpc.chain.getBlock(blockHash);
  const index = signedBlock.block.extrinsics.findIndex((ex) => ex.hash.toHex() === tx.hash.toHex());
  if (index < 0) {
    throw new Error(`submitted extrinsic ${tx.hash.toHex()} is not in block ${blockHash}`);
  }

  return {
    blockNumber: signedBlock.block.header.number.toNumber(),
    blockHash,
    extrinsicIndex: index,
    extrinsicHash: tx.hash.toHex(),
    sender: sender.address,
    recipient,
  };
}

beforeAll(async () => {
  await cryptoWaitReady();
  keyring = new Keyring({ type: 'sr25519', ss58Format: 42 });

  api = await ApiPromise.create({
    provider: new WsProvider(RPC_ENDPOINT),
    noInitWarn: true,
    throwOnConnect: true,
  });

  chain = await connectExplorerChain({ rpcEndpoint: RPC_ENDPOINT });
  server = createExplorerServer({ chain });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  transfer = await submitTransfer(keyring.addFromUri(TEST_SEED), keyring.addFromMnemonic(mnemonicGenerate()).address);
});

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  await chain?.disconnect();
  await api?.disconnect();
});

describe('connection', () => {
  it('reports the runtime it is connected to, read from live metadata', async () => {
    const info = chain.chainInfo();
    expect(info.chain).toBe((await api.rpc.system.chain()).toString());
    expect(info.specName).toBe(api.runtimeVersion.specName.toString());
    expect(info.specVersion).toBe(api.runtimeVersion.specVersion.toNumber());
    expect(info.tokenSymbol).toBe(api.registry.chainTokens[0]);
    expect(info.tokenDecimals).toBe(api.registry.chainDecimals[0]);
    expect(info.genesisHash).toBe(api.genesisHash.toHex());
  });

  it('fails loudly when the endpoint is unreachable rather than serving empty pages', async () => {
    await expect(
      connectExplorerChain({ rpcEndpoint: 'ws://127.0.0.1:1', connectTimeoutMs: 5_000 }),
    ).rejects.toThrow(/cannot reach the node/i);
  });
});

describe('home view', () => {
  it('shows the live chain identity and links recent blocks', async () => {
    const head = (await api.rpc.chain.getHeader()).number.toNumber();
    const { status, body } = await get('/');
    expect(status).toBe(200);
    expect(body).toContain((await api.rpc.system.chain()).toString());
    expect(body).toContain(api.runtimeVersion.specVersion.toString());
    expect(body).toContain(`href="/block/${head}"`);
  });
});

describe('block view', () => {
  it('renders the head block with the hash the node reports', async () => {
    const header = await api.rpc.chain.getHeader();
    const { status, body } = await get('/block/latest');
    expect(status).toBe(200);
    // "latest" moves, so assert on the block the page says it rendered.
    const rendered = /<h1>Block (\d+)<\/h1>/.exec(body);
    expect(rendered).not.toBeNull();
    const renderedNumber = Number(rendered?.[1]);
    expect(renderedNumber).toBeGreaterThanOrEqual(header.number.toNumber());
    const renderedHash = (await api.rpc.chain.getBlockHash(renderedNumber)).toHex();
    expect(body).toContain(renderedHash);
  });

  it('resolves a block by number and by hash to the same block', async () => {
    const byNumber = await get(`/block/${transfer.blockNumber}`);
    const byHash = await get(`/block/${transfer.blockHash}`);
    expect(byNumber.status).toBe(200);
    expect(byHash.status).toBe(200);
    expect(byNumber.body).toContain(transfer.blockHash);
    expect(byHash.body).toContain(`Block ${transfer.blockNumber}`);
  });

  it('lists exactly the extrinsics the node put in the block, each linked', async () => {
    const signedBlock = await api.rpc.chain.getBlock(transfer.blockHash);
    const { body } = await get(`/block/${transfer.blockNumber}`);
    for (const [index, ex] of signedBlock.block.extrinsics.entries()) {
      expect(body).toContain(`href="/extrinsic/${transfer.blockNumber}/${index}"`);
      expect(body).toContain(`${ex.method.section}.${ex.method.method}`);
    }
    expect(body).toContain('balances.transferKeepAlive');
    expect(body).toContain(`href="/block/${signedBlock.block.header.parentHash.toHex()}"`);
  });

  it('404s a block the chain has not produced', async () => {
    const head = (await api.rpc.chain.getHeader()).number.toNumber();
    const { status, body } = await get(`/block/${head + 10_000_000}`);
    expect(status).toBe(404);
    expect(body).toContain('not found');
  });
});

describe('extrinsic view', () => {
  it('decodes the signed transfer from runtime metadata: signer, args, outcome, events', async () => {
    const { status, body } = await get(`/extrinsic/${transfer.blockNumber}/${transfer.extrinsicIndex}`);
    expect(status).toBe(200);
    expect(body).toContain('balances.transferKeepAlive');
    expect(body).toContain(transfer.extrinsicHash);
    expect(body).toContain(transfer.sender);
    expect(body).toContain(transfer.recipient);
    expect(body).toContain('balances.Transfer');
    expect(body).toContain('success');
    expect(body).toContain(`href="/block/${transfer.blockNumber}"`);
  });

  it('links the accounts the extrinsic touched — sender and recipient both', async () => {
    const { body } = await get(`/extrinsic/${transfer.blockNumber}/${transfer.extrinsicIndex}`);
    expect(body).toContain(`href="/account/${transfer.sender}"`);
    expect(body).toContain(`href="/account/${transfer.recipient}"`);
  });

  it('renders the timestamp inherent of the same block as unsigned', async () => {
    const signedBlock = await api.rpc.chain.getBlock(transfer.blockHash);
    const inherentIndex = signedBlock.block.extrinsics.findIndex(
      (ex) => !ex.isSigned && ex.method.section === 'timestamp',
    );
    expect(inherentIndex).toBeGreaterThanOrEqual(0);
    const { status, body } = await get(`/extrinsic/${transfer.blockNumber}/${inherentIndex}`);
    expect(status).toBe(200);
    expect(body).toContain('timestamp.set');
    expect(body).toContain('unsigned');
  });

  it('404s an extrinsic index the block does not have', async () => {
    const signedBlock = await api.rpc.chain.getBlock(transfer.blockHash);
    const { status } = await get(
      `/extrinsic/${transfer.blockNumber}/${signedBlock.block.extrinsics.length + 5}`,
    );
    expect(status).toBe(404);
  });
});

describe('account view', () => {
  it('shows balances that match a direct storage read', async () => {
    const { status, body } = await get(`/account/${transfer.recipient}`);
    expect(status).toBe(200);
    const onChain = await api.query.system.account(transfer.recipient);
    // The recipient was created by this suite's transfer, so its free balance is
    // exactly the drip — a value the page must print, not approximate.
    expect(onChain.data.free.toBigInt()).toBe(ONE_CMN);
    expect(body).toContain('1 CMN');
    expect(body).toContain(transfer.recipient);
  });

  it('lists the extrinsic that touched the account, linked back to block and extrinsic', async () => {
    const { body } = await get(`/account/${transfer.recipient}`);
    expect(body).toContain(`href="/block/${transfer.blockNumber}"`);
    expect(body).toContain(`href="/extrinsic/${transfer.blockNumber}/${transfer.extrinsicIndex}"`);
    expect(body).toContain('balances.transferKeepAlive');
  });

  it('finds the same extrinsic from the sender side', async () => {
    const { body } = await get(`/account/${transfer.sender}`);
    expect(body).toContain(`href="/extrinsic/${transfer.blockNumber}/${transfer.extrinsicIndex}"`);
  });

  it('400s an address that is not valid SS58', async () => {
    const { status, body } = await get('/account/not-an-address');
    expect(status).toBe(400);
    expect(body).toContain('SS58');
  });
});

describe('http surface', () => {
  it('answers HEAD without a body, so a health check costs nothing to read', async () => {
    const response = await fetch(`${baseUrl}/`, { method: 'HEAD' });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
  });

  it('refuses anything but a read — an explorer has no state to change', async () => {
    const response = await fetch(`${baseUrl}/`, { method: 'POST' });
    expect(response.status).toBe(405);
  });
});

describe('search', () => {
  it('sends a block number to that block', async () => {
    const response = await fetch(`${baseUrl}/search?q=${transfer.blockNumber}`, { redirect: 'manual' });
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(`/block/${transfer.blockNumber}`);
  });

  it('sends an account address to that account', async () => {
    const response = await fetch(`${baseUrl}/search?q=${transfer.sender}`, { redirect: 'manual' });
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(`/account/${transfer.sender}`);
  });
});
