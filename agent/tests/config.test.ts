import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  const base = { AGENT_MNEMONIC: 'test test test test test test test test test test test junk' };

  it('applies defaults', () => {
    const c = loadConfig({ ...base });
    expect(c.ws).toBe('ws://127.0.0.1:9944');
    expect(c.mode).toBe('provider');
    expect(c.heartbeatEveryBlocks).toBe(600n);
    expect(c.stake).toBe(1000n * 1_000_000_000_000n);
    expect(c.name).toBe('operator-reference-agent');
  });

  it('refuses to start without a key', () => {
    expect(() => loadConfig({})).toThrow(/AGENT_MNEMONIC/);
  });

  it('accepts AGENT_URI for dev keys instead of a mnemonic', () => {
    expect(loadConfig({ AGENT_URI: '//Alice//ref' }).secret).toBe('//Alice//ref');
  });

  it('rejects an unknown mode', () => {
    expect(() => loadConfig({ ...base, AGENT_MODE: 'chaos' })).toThrow(/AGENT_MODE/);
  });

  it('parses fractional CMN amounts into plancks without float error', () => {
    const c = loadConfig({ ...base, STAKE_CMN: '1000.5', BUYER_AMOUNT_CMN: '0.1' });
    expect(c.stake).toBe(1_000_500_000_000_000n);
    expect(c.buyerAmount).toBe(100_000_000_000n);
  });

  it('rejects garbage numbers rather than defaulting silently', () => {
    expect(() => loadConfig({ ...base, STAKE_CMN: 'lots' })).toThrow(/STAKE_CMN/);
    expect(() => loadConfig({ ...base, HEARTBEAT_BLOCKS: '-5' })).toThrow(/HEARTBEAT_BLOCKS/);
  });

  it('never includes the secret in its printable summary', () => {
    const c = loadConfig({ ...base });
    expect(JSON.stringify(c.redacted())).not.toContain('junk');
  });
});
