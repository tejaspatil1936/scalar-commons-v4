import { createHash } from 'node:crypto';
import type { AgentConfig, AgreementView, Chain, Emit } from './types.js';

/** Persistent per-agent memory, so a restart never repeats a finished step. */
export interface AgentState {
  /** `buyer:seq` keys we already accepted as provider. */
  accepted: string[];
  /** `buyer:seq` keys we already delivered as provider. */
  delivered: string[];
  /** `provider:seq` keys we already confirmed as buyer. */
  confirmed: string[];
}

const key = (counterparty: string, seq: number) => `${counterparty}:${seq}`;

/**
 * The work stub: a deterministic delivery hash for one agreement.
 *
 * A real worker would do the work named by `deliverableHash` and hash its
 * output. The stub commits to the agreement identity instead, so the delivery
 * proof is reproducible and never collides across agreements.
 */
export function deliveryHashFor(a: AgreementView): string {
  const h = createHash('sha256')
    .update(`scalar-reference-agent/v1|${a.buyer}|${a.provider}|${a.seq}|${a.deliverableHash}`)
    .digest('hex');
  return `0x${h}`;
}

/**
 * The reference worker: one `tick()` is one pass of
 * register → heartbeat → accept → deliver → (buyer) confirm/open → claim.
 *
 * Each step is independent and failure-isolated: an error is logged with its
 * step name and the tick carries on, so a bad agreement cannot stop the
 * heartbeat. Nothing is retried inside a tick; the next tick is the retry, and
 * each one is a fresh, logged attempt (the SDK's no-silent-retry rule).
 */
export class Agent {
  constructor(
    readonly chain: Chain,
    readonly config: AgentConfig,
    readonly emit: Emit,
    readonly state: AgentState = { accepted: [], delivered: [], confirmed: [] },
  ) {}

  private async step<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
    try {
      return await fn();
    } catch (err) {
      this.emit('error', { step: name, message: err instanceof Error ? err.message : String(err) });
      return undefined;
    }
  }

  async tick(): Promise<void> {
    const registered = await this.ensureRegistered();
    if (!registered) return;
    await this.step('heartbeat', () => this.maybeHeartbeat());
    const { mode } = this.config;
    if (mode === 'provider' || mode === 'both') await this.step('provider', () => this.provide());
    if (mode === 'buyer' || mode === 'both') await this.step('buyer', () => this.buy());
    await this.step('claim', () => this.maybeClaim());
  }

  /** Returns true when the agent is (now) registered and the tick may continue. */
  private async ensureRegistered(): Promise<boolean> {
    const already = await this.step('registered-check', () => this.chain.isRegistered(this.config.address));
    if (already === undefined) return false;
    if (already) return true;
    const tx = await this.step('register', () => this.chain.register(this.config.stake, this.config.name));
    if (tx === undefined) return false;
    this.emit('register', { stake: this.config.stake.toString(), name: this.config.name, tx });
    return true;
  }

  private async maybeHeartbeat(): Promise<void> {
    const [head, last] = await Promise.all([this.chain.head(), this.chain.lastHeartbeat(this.config.address)]);
    // Economic why: the heartbeat multiplier rewards liveness, and the grace
    // period is far longer than our interval, so one missed tick costs nothing.
    if (last !== null && head - last < this.config.heartbeatEveryBlocks) return;
    const tx = await this.chain.heartbeat();
    this.emit('heartbeat', { block: head.toString(), previous: last === null ? null : last.toString(), tx });
  }

  private async provide(): Promise<void> {
    const head = await this.chain.head();
    const mine = (await this.chain.agreementsAsProvider(this.config.address)).filter(
      (a) => a.provider === this.config.address && a.status === 'Created' && head <= a.deliverBy,
    );
    for (const a of mine) {
      const k = key(a.buyer, a.seq);
      if (this.chain.supportsAccept() && !this.state.accepted.includes(k)) {
        const tx = await this.step('accept', () => this.chain.acceptAgreement(a.buyer, a.seq));
        if (tx !== undefined) {
          this.state.accepted.push(k);
          this.emit('accept', { buyer: a.buyer, seq: a.seq, tx });
        }
      }
      if (this.state.delivered.includes(k)) continue;
      // recordDelivery is rejected before created_at + MinDeliveryBlocks; wait
      // instead of paying for a transaction that is bound to fail.
      if (head < a.createdAt + this.config.minDeliveryBlocks) continue;
      const proof = deliveryHashFor(a);
      const tx = await this.step('deliver', () => this.chain.recordDelivery(a.buyer, a.seq, proof));
      if (tx !== undefined) {
        this.state.delivered.push(k);
        this.emit('deliver', { buyer: a.buyer, seq: a.seq, amount: a.amount.toString(), proof, tx });
      }
    }
  }

  private async buy(): Promise<void> {
    const me = this.config.address;
    const mine = (await this.chain.agreementsAsBuyer(me)).filter((a) => a.buyer === me);

    for (const a of mine) {
      const k = key(a.provider, a.seq);
      if (a.status !== 'Delivered' || this.state.confirmed.includes(k)) continue;
      const tx = await this.step('confirm', () => this.chain.confirmDelivery(a.provider, a.seq));
      if (tx !== undefined) {
        this.state.confirmed.push(k);
        this.emit('confirm', { provider: a.provider, seq: a.seq, amount: a.amount.toString(), tx });
      }
    }

    // Guards before funds move: cap and affordability are checked before the
    // create call reserves anything.
    if (mine.length >= this.config.buyerMaxOpen) return;
    if ((await this.chain.freeBalance(me)) < this.config.buyerAmount) return;
    const busy = new Set(mine.map((a) => a.provider));
    const { buyerPeers } = this.config;
    // An allowlist (BUYER_PEERS) lets an operator point a buyer at providers it
    // trusts to deliver; without one, any other registered agent qualifies.
    const peer = (await this.chain.registeredAgents()).find(
      (p) => p !== me && !busy.has(p) && (buyerPeers.length === 0 || buyerPeers.includes(p)),
    );
    if (peer === undefined) return;

    const head = await this.chain.head();
    const deliverBy = head + this.config.buyerDeliverWithin;
    const deliverable = `0x${createHash('sha256').update(`scalar-reference-agent/v1|${me}|${peer}|${head}`).digest('hex')}`;
    const tx = await this.step('create', () =>
      this.chain.createAgreement(peer, this.config.buyerAmount, deliverable, deliverBy),
    );
    if (tx !== undefined) {
      this.emit('create', {
        provider: peer,
        amount: this.config.buyerAmount.toString(),
        deliverBy: deliverBy.toString(),
        tx,
      });
    }
  }

  private async maybeClaim(): Promise<void> {
    const pending = await this.chain.pendingEmissions(this.config.address);
    if (pending <= 0n) return;
    const tx = await this.chain.claim();
    this.emit('claim', { pending: pending.toString(), tx });
  }
}
