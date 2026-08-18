/**
 * The explorer's read-only view of a live node.
 *
 * Every shape on these pages is decoded against the runtime metadata the node
 * serves at connect time: call arguments come from `method.meta.args`, event
 * fields from `event.meta.fields`, failures from `registry.findMetaError`. None
 * of it is hand-written, because a hand-written shape is a lie the moment the
 * runtime upgrades — and this chain upgrades its economic pallets deliberately.
 *
 * The client is read-only by construction: it exposes no signing key and no
 * `tx` surface at all. An explorer that could submit is an explorer that can be
 * abused.
 */

import { ApiPromise, WsProvider } from '@polkadot/api';
import type { Codec } from '@polkadot/types-codec/types';
import type { DispatchError, EventRecord } from '@polkadot/types/interfaces';
import { u8aToHex } from '@polkadot/util';
import { decodeAddress, encodeAddress } from '@polkadot/util-crypto';

import { collectAccounts } from './accounts.js';
import type { BlockRef } from './routes.js';
import type {
  AccountActivity,
  AccountView,
  BlockSummary,
  BlockView,
  ChainInfo,
  EventView,
  ExtrinsicArg,
  ExtrinsicSummary,
  ExtrinsicView,
  HomeView,
  Outcome,
} from './types.js';

/** Asked for a block the chain does not have (yet, or ever). */
export class BlockNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlockNotFoundError';
  }
}

/** Asked for an extrinsic index the block does not contain. */
export class ExtrinsicNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExtrinsicNotFoundError';
  }
}

/** The address in the URL is not SS58 at all. */
export class InvalidAddressError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidAddressError';
  }
}

export interface ConnectOptions {
  readonly rpcEndpoint: string;
  /** How long to wait for the first connection before giving up. */
  readonly connectTimeoutMs?: number;
  /**
   * How many blocks back the account view walks looking for activity.
   *
   * Substrate keeps no account-to-extrinsic index, so this is a scan, and the
   * window bounds what one page view costs the node. The page states the window
   * it used rather than implying it searched all history.
   */
  readonly accountScanBlocks?: number;
}

export interface ExplorerChain {
  chainInfo(): ChainInfo;
  home(recentBlocks?: number): Promise<HomeView>;
  block(ref: BlockRef): Promise<BlockView>;
  extrinsic(ref: BlockRef, index: number): Promise<ExtrinsicView>;
  account(address: string): Promise<AccountView>;
  disconnect(): Promise<void>;
}

const DEFAULT_CONNECT_TIMEOUT_MS = 15_000;
const DEFAULT_ACCOUNT_SCAN_BLOCKS = 50;
/** How many blocks the account scan decodes at once — enough to be quick, bounded so one page view cannot flood the node. */
const SCAN_CONCURRENCY = 8;

/**
 * Pulls a required item out of the runtime metadata.
 *
 * polkadot-js types every pallet lookup as possibly-undefined, because what a
 * runtime exposes is only known once its metadata is read. Resolving through
 * this guard turns "the connected runtime does not have what the explorer needs"
 * into one specific error instead of a `TypeError` half a page into rendering.
 */
function fromMetadata<T>(value: T | undefined, message: string): T {
  if (value === undefined) {
    throw new Error(message);
  }
  return value;
}

/**
 * Reads a named field out of a decoded struct.
 *
 * Structs decode to `Map`s, so fields are looked up by the name the metadata
 * gave them rather than by a shape written here. A runtime that renames a field
 * therefore produces a loud, specific failure instead of a silently blank page.
 */
function structField(value: Codec, name: string, context: string): Codec {
  const fields = value as unknown as Map<string, Codec>;
  const field = fields instanceof Map ? fields.get(name) : undefined;
  if (field === undefined) {
    throw new Error(`${context}: decoded value has no "${name}" field`);
  }
  return field;
}

/** Renders a decoded value the way a reader wants it: plain when it is plain, JSON when it is structured. */
function humanValue(value: Codec): string {
  const human = value.toHuman();
  return typeof human === 'string' ? human : JSON.stringify(human);
}

/** Reads a numeric codec as a bigint without going through `number` (balances exceed 2^53). */
function toBigInt(value: Codec | undefined | null): bigint | null {
  if (value === undefined || value === null) {
    return null;
  }
  const maybe = value as { toBigInt?: () => bigint };
  return typeof maybe.toBigInt === 'function' ? maybe.toBigInt() : BigInt(value.toString());
}

/** One extrinsic, fully decoded — the block, extrinsic and account views are all projections of this. */
interface DecodedExtrinsic {
  readonly index: number;
  readonly section: string;
  readonly method: string;
  readonly hash: string;
  readonly isSigned: boolean;
  readonly signer: string | null;
  readonly nonce: number | null;
  readonly tip: bigint | null;
  readonly lengthBytes: number;
  readonly args: readonly ExtrinsicArg[];
  readonly events: readonly EventView[];
  readonly outcome: Outcome;
  readonly accounts: readonly string[];
}

interface DecodedBlock {
  readonly number: number;
  readonly hash: string;
  readonly parentHash: string;
  readonly stateRoot: string;
  readonly extrinsicsRoot: string;
  readonly timestampMs: bigint | null;
  readonly extrinsics: readonly DecodedExtrinsic[];
}

/**
 * Connects to a node and returns the explorer's reader.
 *
 * Rejects loudly when the endpoint is unreachable. An explorer that starts
 * anyway would serve pages that look like chain state and are not — which is
 * worse than serving nothing, because a visitor cannot tell the difference.
 */
export async function connectExplorerChain(options: ConnectOptions): Promise<ExplorerChain> {
  const provider = new WsProvider(options.rpcEndpoint);
  const timeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  const scanBlocks = Math.max(1, options.accountScanBlocks ?? DEFAULT_ACCOUNT_SCAN_BLOCKS);

  let api: ApiPromise;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    api = await Promise.race([
      ApiPromise.create({ provider, noInitWarn: true, throwOnConnect: true }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } catch (error) {
    await provider.disconnect().catch(() => undefined);
    throw new Error(
      `cannot reach the node at ${options.rpcEndpoint}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }

  const ss58Format = api.registry.chainSS58 ?? 42;

  const info: ChainInfo = {
    chain: (await api.rpc.system.chain()).toString(),
    specName: api.runtimeVersion.specName.toString(),
    specVersion: api.runtimeVersion.specVersion.toNumber(),
    tokenSymbol: api.registry.chainTokens[0] ?? 'UNIT',
    tokenDecimals: api.registry.chainDecimals[0] ?? 12,
    ss58Format,
    genesisHash: api.genesisHash.toHex(),
  };

  /** Normalises any accepted address form to this chain's SS58 format. */
  function normalizeAddress(address: string): string {
    try {
      return encodeAddress(decodeAddress(address), ss58Format);
    } catch (error) {
      throw new InvalidAddressError(
        `not a valid SS58 account address: ${address} (${
          error instanceof Error ? error.message : String(error)
        })`,
      );
    }
  }

  /** Turns a URL block reference into the (number, hash) pair everything else works from. */
  async function resolveBlock(ref: BlockRef): Promise<{ number: number; hash: string }> {
    if (ref.kind === 'latest') {
      const header = await api.rpc.chain.getHeader();
      return { number: header.number.toNumber(), hash: header.hash.toHex() };
    }
    if (ref.kind === 'number') {
      const hash = await api.rpc.chain.getBlockHash(ref.number);
      // A block the chain has not authored yet answers with the zero hash
      // rather than an error, so this check is what turns "the future" into 404.
      if (hash.isEmpty) {
        throw new BlockNotFoundError(`block ${ref.number} not found on this chain`);
      }
      return { number: ref.number, hash: hash.toHex() };
    }
    try {
      const header = await api.rpc.chain.getHeader(ref.hash);
      return { number: header.number.toNumber(), hash: header.hash.toHex() };
    } catch (error) {
      throw new BlockNotFoundError(
        `block ${ref.hash} not found on this chain (${
          error instanceof Error ? error.message : String(error)
        })`,
      );
    }
  }

  /** Reads the dispatch outcome of one extrinsic out of the block's event records. */
  function outcomeOf(records: readonly EventRecord[]): Outcome {
    for (const record of records) {
      if (record.event.section !== 'system') {
        continue;
      }
      if (record.event.method === 'ExtrinsicSuccess') {
        return { kind: 'success' };
      }
      if (record.event.method === 'ExtrinsicFailed') {
        // The first field of the event is the `DispatchError` the runtime
        // returned; it is decoded from metadata like everything else here.
        const dispatchError = record.event.data[0] as DispatchError | undefined;
        if (dispatchError === undefined) {
          return { kind: 'failed', reason: 'ExtrinsicFailed carried no error' };
        }
        if (dispatchError.isModule) {
          // Module errors are indices into metadata; resolving them through the
          // registry is what turns "Module { index: 26, error: [3,0,0,0] }" into
          // "agents.NotRegistered" without hard-coding a single error name here.
          const meta = api.registry.findMetaError(dispatchError.asModule);
          return { kind: 'failed', reason: `${meta.section}.${meta.name}` };
        }
        return { kind: 'failed', reason: dispatchError.type };
      }
    }
    return { kind: 'unknown' };
  }

  /** Names each event field from metadata, falling back to its position for unnamed tuple variants. */
  function eventView(record: EventRecord, index: number): EventView {
    const fieldsMeta = record.event.meta.fields;
    const fields = record.event.data.map((value, position) => {
      const name = fieldsMeta[position]?.name;
      return {
        name: name !== undefined && name.isSome ? name.unwrap().toString() : String(position),
        value: humanValue(value),
      };
    });
    return {
      index,
      section: record.event.section,
      method: record.event.method,
      fields,
    };
  }

  /** Decodes one block: header, timestamp, and every extrinsic with its events and outcome. */
  async function decodeBlock(hash: string): Promise<DecodedBlock> {
    const [signedBlock, apiAt] = await Promise.all([api.rpc.chain.getBlock(hash), api.at(hash)]);
    const systemEvents = fromMetadata(
      apiAt.query.system?.events,
      `runtime at block ${hash} exposes no system.events storage`,
    );
    const records = (await systemEvents()) as unknown as EventRecord[];
    const timestampMs = apiAt.query.timestamp?.now ? toBigInt(await apiAt.query.timestamp.now()) : null;

    const extrinsics = signedBlock.block.extrinsics.map((extrinsic, index): DecodedExtrinsic => {
      const mine = records.filter(
        (record) => record.phase.isApplyExtrinsic && record.phase.asApplyExtrinsic.toNumber() === index,
      );

      const argsMeta = extrinsic.method.meta.args;
      const args = extrinsic.method.args.map((value, position): ExtrinsicArg => {
        const meta = argsMeta[position];
        const typeName = meta?.typeName;
        return {
          name: meta ? meta.name.toString() : String(position),
          type:
            typeName !== undefined && typeName.isSome
              ? typeName.unwrap().toString()
              : (meta?.type.toString() ?? value.toRawType()),
          value: humanValue(value),
        };
      });

      // The signer is an `Address` (a MultiAddress on this runtime), so it is
      // resolved through the same codec walk as everything else rather than by
      // assuming which variant it is.
      const signer = extrinsic.isSigned ? (collectAccounts([extrinsic.signer], ss58Format)[0] ?? null) : null;

      const accounts = collectAccounts(
        [
          ...(extrinsic.isSigned ? [extrinsic.signer] : []),
          ...extrinsic.method.args,
          ...mine.flatMap((record) => Array.from(record.event.data)),
        ],
        ss58Format,
      );

      return {
        index,
        section: extrinsic.method.section,
        method: extrinsic.method.method,
        hash: extrinsic.hash.toHex(),
        isSigned: extrinsic.isSigned,
        signer,
        nonce: extrinsic.isSigned ? extrinsic.nonce.toNumber() : null,
        tip: extrinsic.isSigned ? extrinsic.tip.toBigInt() : null,
        lengthBytes: extrinsic.encodedLength,
        args,
        events: mine.map((record) => eventView(record, records.indexOf(record))),
        outcome: outcomeOf(mine),
        accounts,
      };
    });

    return {
      number: signedBlock.block.header.number.toNumber(),
      hash: signedBlock.block.header.hash.toHex(),
      parentHash: signedBlock.block.header.parentHash.toHex(),
      stateRoot: signedBlock.block.header.stateRoot.toHex(),
      extrinsicsRoot: signedBlock.block.header.extrinsicsRoot.toHex(),
      timestampMs,
      extrinsics,
    };
  }

  function summarize(decoded: DecodedExtrinsic): ExtrinsicSummary {
    return {
      index: decoded.index,
      section: decoded.section,
      method: decoded.method,
      hash: decoded.hash,
      isSigned: decoded.isSigned,
      signer: decoded.signer,
      outcome: decoded.outcome,
    };
  }

  /** Runs `task` over `items` a few at a time, keeping input order. */
  async function mapLimited<T, R>(
    items: readonly T[],
    limit: number,
    task: (item: T) => Promise<R>,
  ): Promise<R[]> {
    const results: R[] = [];
    for (let start = 0; start < items.length; start += limit) {
      results.push(...(await Promise.all(items.slice(start, start + limit).map(task))));
    }
    return results;
  }

  return {
    chainInfo(): ChainInfo {
      return info;
    },

    async home(recentBlocks = 10): Promise<HomeView> {
      const header = await api.rpc.chain.getHeader();
      const head = header.number.toNumber();
      const numbers = Array.from(
        { length: Math.min(recentBlocks, head + 1) },
        (_unused, offset) => head - offset,
      );

      const summaries = await mapLimited(numbers, SCAN_CONCURRENCY, async (number): Promise<BlockSummary> => {
        const { hash } = await resolveBlock({ kind: 'number', number });
        const decoded = await decodeBlock(hash);
        return {
          number: decoded.number,
          hash: decoded.hash,
          timestampMs: decoded.timestampMs,
          extrinsicCount: decoded.extrinsics.length,
        };
      });

      const first = summaries[0];
      if (first === undefined) {
        throw new BlockNotFoundError('the chain has produced no blocks');
      }

      return { chain: info, head: first, recentBlocks: summaries };
    },

    async block(ref: BlockRef): Promise<BlockView> {
      const { hash } = await resolveBlock(ref);
      const [decoded, runtimeVersion] = await Promise.all([
        decodeBlock(hash),
        api.rpc.state.getRuntimeVersion(hash),
      ]);
      return {
        number: decoded.number,
        hash: decoded.hash,
        parentHash: decoded.parentHash,
        stateRoot: decoded.stateRoot,
        extrinsicsRoot: decoded.extrinsicsRoot,
        timestampMs: decoded.timestampMs,
        specVersion: runtimeVersion.specVersion.toNumber(),
        extrinsics: decoded.extrinsics.map(summarize),
      };
    },

    async extrinsic(ref: BlockRef, index: number): Promise<ExtrinsicView> {
      const { hash } = await resolveBlock(ref);
      const decoded = await decodeBlock(hash);
      const extrinsic = decoded.extrinsics[index];
      if (extrinsic === undefined) {
        throw new ExtrinsicNotFoundError(
          `block ${decoded.number} has no extrinsic at index ${index} (it has ${decoded.extrinsics.length})`,
        );
      }
      return {
        block: { number: decoded.number, hash: decoded.hash },
        index: extrinsic.index,
        hash: extrinsic.hash,
        section: extrinsic.section,
        method: extrinsic.method,
        isSigned: extrinsic.isSigned,
        signer: extrinsic.signer,
        nonce: extrinsic.nonce,
        tip: extrinsic.tip,
        lengthBytes: extrinsic.lengthBytes,
        args: extrinsic.args,
        events: extrinsic.events,
        outcome: extrinsic.outcome,
        accounts: extrinsic.accounts,
      };
    },

    async account(address: string): Promise<AccountView> {
      const publicKey = (() => {
        try {
          return decodeAddress(address);
        } catch (error) {
          throw new InvalidAddressError(
            `not a valid SS58 account address: ${address} (${
              error instanceof Error ? error.message : String(error)
            })`,
          );
        }
      })();
      const normalized = normalizeAddress(address);

      const header = await api.rpc.chain.getHeader();
      const headNumber = header.number.toNumber();
      const headHash = header.hash.toHex();

      const apiAt = await api.at(headHash);
      const systemAccount = fromMetadata(
        apiAt.query.system?.account,
        'runtime exposes no system.account storage',
      );
      const account = await systemAccount(normalized);
      const balances = structField(account, 'data', 'system.account');
      const balance = (name: string): bigint =>
        toBigInt(structField(balances, name, 'system.account.data')) ?? 0n;

      const from = Math.max(0, headNumber - scanBlocks + 1);
      const numbers = Array.from({ length: headNumber - from + 1 }, (_unused, offset) => headNumber - offset);
      const scanned = await mapLimited(numbers, SCAN_CONCURRENCY, async (number) => {
        const hash = await api.rpc.chain.getBlockHash(number);
        return decodeBlock(hash.toHex());
      });

      const activity: AccountActivity[] = [];
      for (const decoded of scanned) {
        for (const extrinsic of decoded.extrinsics) {
          if (!extrinsic.accounts.includes(normalized)) {
            continue;
          }
          activity.push({
            blockNumber: decoded.number,
            blockHash: decoded.hash,
            extrinsicIndex: extrinsic.index,
            section: extrinsic.section,
            method: extrinsic.method,
            role: extrinsic.signer === normalized ? 'signer' : 'touched',
            outcome: extrinsic.outcome,
          });
        }
      }

      return {
        address: normalized,
        publicKey: u8aToHex(publicKey),
        free: balance('free'),
        reserved: balance('reserved'),
        frozen: balance('frozen'),
        nonce: Number(toBigInt(structField(account, 'nonce', 'system.account')) ?? 0n),
        at: { number: headNumber, hash: headHash },
        scanned: { from, to: headNumber },
        activity,
      };
    },

    async disconnect(): Promise<void> {
      await api.disconnect();
    },
  };
}
