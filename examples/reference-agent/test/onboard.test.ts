import { describe, expect, it } from 'vitest';
import { findTx, formatCmn, nextStep, registrationNeed } from '../src/onboard-plan.js';

const CMN = 10n ** 12n;
// spec 306: agents.minStake 1 000 CMN, baseRegistrationFee 50 CMN, existentialDeposit 0.01 CMN.
const costs = { stake: 1_000n * CMN, registrationFee: 50n * CMN, existentialDeposit: CMN / 100n };

describe('formatCmn', () => {
  it('prints exact decimals, never a float', () => {
    expect(formatCmn(1_100n * CMN)).toBe('1100');
    expect(formatCmn(108_157_107n)).toBe('0.000108157107');
    expect(formatCmn(1_047_224_459_000_000n)).toBe('1047.224459');
    expect(formatCmn(0n)).toBe('0');
  });
});

describe('registrationNeed', () => {
  it('is stake + registration fee + existential deposit, as the daemon checks it', () => {
    expect(registrationNeed(costs)).toBe(1_050_010_000_000_000n);
  });
});

describe('nextStep', () => {
  const need = registrationNeed(costs);

  it('sends an unfunded, unregistered account to the faucet', () => {
    expect(nextStep({ registered: false, free: 0n, need }).step).toBe('faucet');
  });

  it('offers registration once the balance covers it, and never registers on its own', () => {
    const s = nextStep({ registered: false, free: 1_100n * CMN, need });
    expect(s.step).toBe('register');
    expect(s.message).toMatch(/register --yes/);
  });

  it('is one planck short means faucet, not a register that fails and pays a fee', () => {
    expect(nextStep({ registered: false, free: need - 1n, need }).step).toBe('faucet');
  });

  it('a registered agent goes straight to the heartbeat test transaction', () => {
    expect(nextStep({ registered: true, free: 49n * CMN, need }).step).toBe('heartbeat');
  });
});

describe('findTx', () => {
  const items = [
    { id: '754159-1', hash: '0xaa', section: 'emissions', method: 'claim', success: true },
    { id: '754074-1', hash: '0xbb', section: 'agents', method: 'heartbeat', success: true },
  ];

  it('finds the indexed extrinsic by hash, case-insensitively', () => {
    expect(findTx(items, '0xBB')?.id).toBe('754074-1');
  });

  it('returns undefined while the indexer has not caught up', () => {
    expect(findTx(items, '0xcc')).toBeUndefined();
  });
});
