/**
 * Live-node client for the faucet.
 *
 * Everything here reads its type shapes from the runtime metadata the node
 * serves — nothing about the balances pallet is hand-written. The faucet spends
 * from an ordinary pre-funded devnet account via `balances.transferKeepAlive`;
 * there is deliberately **no mint path**. All minting on this chain flows
 * through the emissions pallet, and a faucet that could mint would be a hole in
 * the supply cap.
 */

import { ApiPromise, WsProvider } from '@polkadot/api';
import { Keyring } from '@polkadot/keyring';
import type { KeyringPair } from '@polkadot/keyring/types';
import { cryptoWaitReady } from '@polkadot/util-crypto';

import { ConnectionSupervisor, type ConnectionStatus, type ReconnectPolicy } from './reconnect.js';

export type { ConnectionStatus } from './reconnect.js';

/** Static facts about the connected chain, read from metadata at connect time. */
export interface ChainInfo {
  readonly chain: string;
  readonly specName: string;
  readonly specVersion: number;
  readonly tokenSymbol: string;
  readonly tokenDecimals: number;
  readonly ss58Format: number;
}

/** Where a transfer landed on chain. */
export interface TransferReceipt {
  readonly blockHash: string;
  readonly txHash: string;
}

export interface ChainClient {
  /** SS58 address of the pre-funded account the faucet spends from. */
  readonly faucetAddress: string;
  chainInfo(): ChainInfo;
  /** Minimum balance for an account to exist, from `balances.existentialDeposit`. */
  existentialDeposit(): bigint;
  /** Free (spendable) balance in plancks. */
  freeBalance(address: string): Promise<bigint>;
  /** Signs and submits a transfer from the faucet account, resolving on inclusion. */
  transfer(dest: string, amountPlancks: bigint): Promise<TransferReceipt>;
  /**
   * State of the node socket.
   *
   * Read before answering `/health`, and read again when a request fails: a
   * drip cannot be served without a node, and the difference between "the
   * faucet is broken" and "the faucet is waiting for its node" is only visible
   * from here.
   */
  connection(): ConnectionStatus;
  disconnect(): Promise<void>;
}

export interface ConnectOptions {
  readonly rpcEndpoint: string;
  /** Seed/URI of the pre-funded devnet account (e.g. `//Ferdie`). */
  readonly faucetSeed: string;
  readonly ss58Format?: number;
  /** Overrides the reconnect backoff; the defaults are what production runs. */
  readonly reconnectPolicy?: Partial<ReconnectPolicy>;
  /** Where connection loss and recovery are reported. Defaults to the console. */
  readonly logger?: Pick<Console, 'log' | 'error'>;
}

/**
 * Pulls a required item out of the runtime metadata.
 *
 * polkadot-js types pallet lookups as possibly-undefined because the metadata is
 * only known at runtime. Resolving them through this guard turns "the connected
 * runtime is missing something the faucet needs" into a startup failure with a
 * specific message, instead of a `TypeError` on the first request.
 */
function fromMetadata<T>(value: T | undefined, message: string): T {
  if (value === undefined) {
    throw new Error(message);
  }
  return value;
}

/** Raised when the node refuses or fails the transfer. */
export class TransferFailedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'TransferFailedError';
  }
}

/**
 * Connects to the node and resolves the faucet signer.
 *
 * Rejects loudly if the endpoint is unreachable *at startup*: a faucet that
 * starts up without a chain behind it would answer requests it cannot honour.
 * A socket lost **after** startup is a different thing and is not fatal — it is
 * handed to a {@link ConnectionSupervisor}, which reconnects on a capped backoff
 * while `/health` reports the faucet as temporarily unavailable. Before that
 * supervisor existed, one node restart took the public faucet down until a human
 * restarted the unit (2026-09-09, 74 minutes).
 */
export async function connectChain(options: ConnectOptions): Promise<ChainClient> {
  await cryptoWaitReady();

  // `false` disables the provider's own retry loop: reconnection is the
  // supervisor's job, and two loops on one socket race each other.
  const provider = new WsProvider(options.rpcEndpoint, false);
  let api: ApiPromise;
  try {
    await provider.connect();
    api = await ApiPromise.create({ provider, noInitWarn: true, throwOnConnect: true });
  } catch (error) {
    await provider.disconnect().catch(() => undefined);
    throw new Error(
      `cannot reach the node at ${options.rpcEndpoint}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const ss58Format = options.ss58Format ?? api.registry.chainSS58 ?? 42;
  const keyring = new Keyring({ type: 'sr25519', ss58Format });
  const signer: KeyringPair = keyring.addFromUri(options.faucetSeed);

  const info: ChainInfo = {
    chain: (await api.rpc.system.chain()).toString(),
    specName: api.runtimeVersion.specName.toString(),
    specVersion: api.runtimeVersion.specVersion.toNumber(),
    tokenSymbol: api.registry.chainTokens[0] ?? 'CMN',
    tokenDecimals: api.registry.chainDecimals[0] ?? 12,
    ss58Format,
  };

  // Resolve everything the faucet needs out of the live metadata up front, and
  // fail startup if the connected runtime does not expose it. This is what makes
  // "read real metadata, do not guess type shapes" enforceable rather than
  // aspirational: a runtime without these items is a runtime this faucet cannot
  // serve, and finding that out at boot beats finding out mid-request.
  //
  // Each of these is re-read from `api` per call rather than captured here, and
  // that matters now that the client reconnects: polkadot-js reloads metadata on
  // every reconnect and rebuilds `api.tx`/`api.query` when it does, so a handle
  // captured at startup would outlive the metadata it was decorated against. A
  // node that came back with an upgraded runtime would then be sent a call
  // encoded from the old one — the exact "plausible-looking nonsense" this file
  // exists to avoid. The startup calls below stay because they are the guard;
  // only the results are no longer kept.
  const transferKeepAliveOf = () =>
    fromMetadata(
      api.tx.balances?.transferKeepAlive,
      `runtime at ${options.rpcEndpoint} exposes no balances.transferKeepAlive call`,
    );
  const queryAccountOf = () =>
    fromMetadata(
      api.query.system?.account,
      `runtime at ${options.rpcEndpoint} exposes no system.account storage`,
    );
  const existentialDepositOf = () =>
    (
      fromMetadata(
        api.consts.balances?.existentialDeposit,
        `runtime at ${options.rpcEndpoint} exposes no balances.existentialDeposit constant`,
      ) as unknown as { toBigInt(): bigint }
    ).toBigInt();

  transferKeepAliveOf();
  queryAccountOf();
  existentialDepositOf();

  // One signer means one nonce stream. Submissions are chained onto this promise
  // so only one transfer is in flight at a time: concurrent requests would
  // otherwise read the same next-nonce and one of the two would be dropped as a
  // duplicate. Serialising costs a block of latency under load and is the reason
  // the faucet never reports success for a transfer that was silently discarded.
  let queue: Promise<unknown> = Promise.resolve();

  async function submitTransfer(dest: string, amountPlancks: bigint): Promise<TransferReceipt> {
    const nonce = await api.rpc.system.accountNextIndex(signer.address);
    return new Promise<TransferReceipt>((resolve, reject) => {
      let unsub: (() => void) | undefined;
      const settle = (fn: () => void) => {
        if (unsub) {
          unsub();
          unsub = undefined;
        }
        fn();
      };

      // transferKeepAlive, not transferAllowDeath: a drip must never be able to
      // reap the faucet account itself.
      transferKeepAliveOf()(dest, amountPlancks)
        .signAndSend(signer, { nonce }, ({ status, dispatchError, txHash }) => {
          if (dispatchError) {
            let reason = dispatchError.toString();
            if (dispatchError.isModule) {
              // Decode the pallet error against live metadata for a real message.
              const meta = api.registry.findMetaError(dispatchError.asModule);
              reason = `${meta.section}.${meta.name}: ${meta.docs.join(' ').trim()}`;
            }
            settle(() => reject(new TransferFailedError(reason)));
            return;
          }
          if (status.isInvalid || status.isDropped || status.isUsurped) {
            settle(() => reject(new TransferFailedError(`transaction ${status.type.toLowerCase()}`)));
            return;
          }
          if (status.isInBlock) {
            settle(() =>
              resolve({ blockHash: status.asInBlock.toHex(), txHash: txHash.toHex() }),
            );
          }
        })
        .then((u) => {
          unsub = u;
        })
        .catch((error: unknown) => {
          reject(
            new TransferFailedError(error instanceof Error ? error.message : String(error)),
          );
        });
    });
  }

  // Attached only once the API is ready and the runtime has been checked, so a
  // failed startup stays a startup failure instead of becoming a retry loop
  // behind a process that is already exiting.
  const supervisor = new ConnectionSupervisor({
    provider,
    endpoint: options.rpcEndpoint,
    ...(options.reconnectPolicy === undefined ? {} : { policy: options.reconnectPolicy }),
    ...(options.logger === undefined ? {} : { logger: options.logger }),
    label: '[faucet]',
  });

  return {
    faucetAddress: signer.address,

    chainInfo: () => info,

    existentialDeposit: () => existentialDepositOf(),

    async freeBalance(address: string): Promise<bigint> {
      const account = await queryAccountOf()(address);
      return (account as unknown as { data: { free: { toBigInt(): bigint } } }).data.free.toBigInt();
    },

    transfer(dest: string, amountPlancks: bigint): Promise<TransferReceipt> {
      // Chain onto the queue regardless of whether the previous submission
      // succeeded, so one failure does not wedge the faucet permanently.
      const result = queue.then(
        () => submitTransfer(dest, amountPlancks),
        () => submitTransfer(dest, amountPlancks),
      );
      queue = result.catch(() => undefined);
      return result;
    },

    connection: () => supervisor.status(),

    async disconnect(): Promise<void> {
      // Stop supervising first: a deliberate close must not be met with a
      // reconnect, which is what would happen if the order were reversed.
      supervisor.stop();
      await api.disconnect();
    },
  };
}
