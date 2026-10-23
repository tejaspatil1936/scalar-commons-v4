import { describe, it, expect } from 'vitest';

import { escapeHtml, formatBalance, formatCmn, formatTimestamp, humanize, isoOf, relativeTime, shortHash } from '../src/format.js';

describe('formatBalance', () => {
  it('renders whole tokens with the chain symbol', () => {
    expect(formatBalance(1_000_000_000_000n, 12, 'CMN')).toBe('1 CMN');
  });

  it('keeps the fractional part but trims trailing zeros', () => {
    expect(formatBalance(1_500_000_000_000n, 12, 'CMN')).toBe('1.5 CMN');
    expect(formatBalance(1n, 12, 'CMN')).toBe('0.000000000001 CMN');
  });

  it('groups the integer part so genesis-scale balances stay readable', () => {
    expect(formatBalance(1_000_050_000_000_000_000_000n, 12, 'CMN')).toBe('1,000,050,000 CMN');
  });

  it('renders zero without a fractional part', () => {
    expect(formatBalance(0n, 12, 'CMN')).toBe('0 CMN');
  });

  it('honours the decimals the chain actually reports', () => {
    expect(formatBalance(12_345n, 3, 'FOO')).toBe('12.345 FOO');
  });
});

describe('shortHash', () => {
  it('elides the middle of a 32-byte hash', () => {
    const hash = `0x${'ab'.repeat(32)}`;
    expect(shortHash(hash)).toBe('0xabababab…abababab');
  });

  it('leaves short values alone', () => {
    expect(shortHash('0xdeadbeef')).toBe('0xdeadbeef');
  });
});

describe('escapeHtml', () => {
  it('neutralises markup so chain data can never inject into a page', () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;',
    );
    expect(escapeHtml("it's & so")).toBe('it&#39;s &amp; so');
  });
});

describe('formatTimestamp', () => {
  it('renders the millisecond timestamp the timestamp pallet stores as ISO-8601', () => {
    expect(formatTimestamp(1_787_086_860_000n)).toBe('2026-08-18T21:01:00.000Z');
  });

  it('reports nothing when a block carries no timestamp', () => {
    expect(formatTimestamp(null)).toBe('unknown');
  });

  it('says a timestamp is out of range rather than throwing on it', () => {
    // Date only spans ±8.64e15 ms; toISOString() throws RangeError past that.
    // A timestamp that far out is not reachable on a sane runtime, but an
    // uncaught RangeError here would 502 the whole page rather than mark one
    // field as unreadable.
    expect(formatTimestamp(8_640_000_000_000_000n)).toBe('+275760-09-13T00:00:00.000Z');
    expect(formatTimestamp(8_640_000_000_000_001n)).toBe('out of range (8640000000000001 ms)');
    expect(formatTimestamp(-8_640_000_000_000_001n)).toBe('out of range (-8640000000000001 ms)');
  });
});

describe('formatCmn: at most two decimals in a table, the full value belongs in the title', () => {
  it('rounds half up to hundredths on the integer string, grouping the whole part', () => {
    expect(formatCmn(1_084_514_632_607_691n, 12, 'CMN')).toBe('1,084.51 CMN');
    expect(formatCmn(1_000_051_912_360_000_000_000n, 12, 'CMN')).toBe('1,000,051,912.36 CMN');
    expect(formatCmn(1_500_000_000_000n, 12, 'CMN')).toBe('1.50 CMN');
    expect(formatCmn(1_005_000_000_000n, 12, 'CMN')).toBe('1.01 CMN');
    expect(formatCmn(1_004_999_999_999n, 12, 'CMN')).toBe('1.00 CMN');
    expect(formatCmn(0n, 12, 'CMN')).toBe('0.00 CMN');
    expect(formatCmn(12_345n, 3, 'FOO')).toBe('12.35 FOO');
    expect(formatCmn(7n, 0, 'X')).toBe('7.00 X');
  });

  it('says "<0.01" for a value that is not zero but rounds to nothing, never "0.00"', () => {
    expect(formatCmn(108_157_176n, 12, 'CMN')).toBe('<0.01 CMN');
    expect(formatCmn(1n, 12, 'CMN')).toBe('<0.01 CMN');
    expect(formatCmn(-1n, 12, 'CMN')).toBe('-<0.01 CMN');
    expect(formatCmn(-1_500_000_000_000n, 12, 'CMN')).toBe('-1.50 CMN');
  });
});

describe('relativeTime: "4 min ago" under a day, the date beyond it, no clock of its own', () => {
  const now = Date.UTC(2026, 9, 23, 12, 0, 0);
  it('counts seconds, minutes and hours', () => {
    expect(relativeTime(now - 4_000, now)).toBe('4 s ago');
    expect(relativeTime(now, now)).toBe('0 s ago');
    expect(relativeTime(now + 5_000, now)).toBe('0 s ago');
    expect(relativeTime(now - 4 * 60_000, now)).toBe('4 min ago');
    expect(relativeTime(now - 59 * 60_000 - 20_000, now)).toBe('59 min ago');
    expect(relativeTime(now - 2 * 3_600_000, now)).toBe('2 h ago');
    expect(relativeTime(now - 23 * 3_600_000, now)).toBe('23 h ago');
  });
  it('gives the date for anything a day or more old', () => {
    expect(relativeTime(now - 24 * 3_600_000, now)).toBe('22 Oct 2026');
    expect(relativeTime(Date.UTC(2026, 7, 18, 21, 1), now)).toBe('18 Aug 2026');
  });
  it('turns a block timestamp into an ISO instant, or null when it has none', () => {
    expect(isoOf(1_787_086_860_000n)).toBe('2026-08-18T21:01:00.000Z');
    expect(isoOf(null)).toBeNull();
    expect(isoOf(8_640_000_000_000_001n)).toBeNull();
  });
});

describe('humanize: an identifier as words in sentence case', () => {
  it('splits camel case and snake case', () => {
    expect(humanize('transferKeepAlive')).toBe('Transfer keep alive');
    expect(humanize('dispatch_info')).toBe('Dispatch info');
    expect(humanize('ExtrinsicSuccess')).toBe('Extrinsic success');
    expect(humanize('request_id')).toBe('Request id');
    expect(humanize('set')).toBe('Set');
  });
});
