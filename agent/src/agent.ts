import type { AgentConfig, Chain, Emit } from './types.js';

/** Persistent per-agent memory, so a restart never repeats a finished step. */
export interface AgentState {
  accepted: string[];
  delivered: string[];
  confirmed: string[];
}

export class Agent {
  constructor(
    readonly chain: Chain,
    readonly config: AgentConfig,
    readonly emit: Emit,
    readonly state: AgentState = { accepted: [], delivered: [], confirmed: [] },
  ) {}

  async tick(): Promise<void> {
    throw new Error('not implemented');
  }
}
