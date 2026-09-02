import { describe, it, expect } from 'vitest';

import { matchRoute, settledEraFromEvent } from '../src/api.ts';

/**
 * Routing and era-event shaping, tested without a chain.
 *
 * Both are reachable by an anonymous request, and both have a failure mode that
 * is worse than an error: routing can be handed bytes the URL spec does not
 * define, and an `EraSettled` event whose fields cannot be found must never be
 * reported as an era that emitted nothing. A supply-capped chain publishing
 * "0 CMN emitted" reads as a fact, not as a decode miss.
 */

describe('matchRoute', () => {
  it('fills path parameters, decoding percent-escapes', () => {
    const matched = matchRoute('/v1/blocks/0x00ff');
    expect(matched?.route.name).toBe('blocks.get');
    expect(matched?.params.id).toBe('0x00ff');

    const escaped = matchRoute('/v1/accounts/a%20b');
    expect(escaped?.params.address).toBe('a b');
  });

  it('returns null for a path no route claims', () => {
    expect(matchRoute('/v1/not-a-real-endpoint')).toBeNull();
  });

  it('raises a 400 rather than a raw URIError on malformed percent-encoding', () => {
    // `decodeURIComponent('%')` throws URIError. Anonymous callers control this
    // byte, so it has to arrive as a client error and never as a fault.
    let caught: unknown;
    try {
      matchRoute('/v1/blocks/%');
    } catch (error) {
      caught = error;
    }
    expect(caught, 'a malformed escape must be rejected, not decoded').toBeDefined();
    expect((caught as { status?: number }).status).toBe(400);
    expect(caught).not.toBeInstanceOf(URIError);
  });

  it('rejects malformed escapes in every parameterised route', () => {
    for (const path of ['/v1/accounts/%', '/v1/agents/%E0%A4%A/events', '/v1/escrows/%/x/1']) {
      expect(() => matchRoute(path), path).toThrow();
      let status: number | undefined;
      try {
        matchRoute(path);
      } catch (error) {
        status = (error as { status?: number }).status;
      }
      expect(status, path).toBe(400);
    }
  });
});

describe('settledEraFromEvent', () => {
  const settled = { blockNumber: 4_242, data: { era: 7, total_emission: '10000000000000000000', total_weight: '900' } };

  it('reports the totals the pallet itself recorded', () => {
    expect(settledEraFromEvent(settled)).toEqual({
      era: 7,
      settled: true,
      totalEmissionPlancks: '10000000000000000000',
      totalWeight: '900',
      settledAtBlock: 4_242,
    });
  });

  it('accepts the camelCase spelling metadata may hand back', () => {
    const camel = { blockNumber: 9, data: { era: 1, totalEmission: '5', totalWeight: '2' } };
    expect(settledEraFromEvent(camel).totalEmissionPlancks).toBe('5');
    expect(settledEraFromEvent(camel).totalWeight).toBe('2');
  });

  it('throws rather than reporting a settled era as having emitted zero', () => {
    // What an unnamed field looks like once ingested: `arg1`, not `total_emission`.
    const unnamed = { blockNumber: 9, data: { era: 3, arg1: '10', arg2: '4' } };
    expect(() => settledEraFromEvent(unnamed)).toThrow(/total_emission/);

    const allUnnamed = { blockNumber: 9, data: { arg0: 3, arg1: '10', arg2: '4' } };
    expect(() => settledEraFromEvent(allUnnamed)).toThrow(/EraSettled/);

    const partial = { blockNumber: 9, data: { era: 3, total_emission: '10' } };
    expect(() => settledEraFromEvent(partial)).toThrow(/total_weight/);

    const noEra = { blockNumber: 9, data: { total_emission: '10', total_weight: '4' } };
    expect(() => settledEraFromEvent(noEra)).toThrow(/era/);
  });
});
