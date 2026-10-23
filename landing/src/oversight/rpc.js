// The live read: JSON-RPC over HTTP, straight at a node, with provenance.
//
// /observatory reads the indexer's REST API because the public chain has one.
// This page reads a devnet, which does not, so it POSTs JSON-RPC to the node
// itself. Three methods are enough — `chain_getBlockHash`, `chain_getBlock`
// and `chain_getHeader` — and none of them needs state, which matters because
// the node keeps only a few hundred blocks of it while keeping every block
// body. That is what lets a row recorded an hour ago still be re-read now.
//
// Every read carries where it came from and when, so the Sources switch has
// something true to show. A read that fails is a recorded failure, never a
// silent fall back to the file: `offline` is a state the page displays.

// The endpoint is the one in the record and nothing else. The site's rule is
// one URL per page with no flags in it (test/observatory.test.mjs holds the
// observatory to that), and an endpoint a visitor could set from the address
// bar would be both a mode switch and a way to point the page at a host of
// their choosing. A demo on another machine edits the record instead.

/**
 * A tiny JSON-RPC client. `fetchImpl` and `now` are injected so the tests can
 * drive it without a network or a clock.
 */
export function createRpc({ endpoint, fetchImpl = fetch, now = () => new Date(), timeoutMs = 8000 }) {
  let calls = 0;

  async function call(method, params = []) {
    const at = now().toISOString();
    calls += 1;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: calls, jsonrpc: '2.0', method, params }),
        signal: controller?.signal,
      });
      if (!response.ok) return { ok: false, endpoint, method, at, error: `HTTP ${response.status}` };
      const body = await response.json();
      if (body.error) return { ok: false, endpoint, method, at, error: body.error.message ?? 'rpc error' };
      return { ok: true, endpoint, method, at, result: body.result };
    } catch (error) {
      // A browser blocks http:// from an https:// page, and a viewer who is not
      // on the node's host cannot reach it at all. Both arrive here, and both
      // mean the same thing to the page: offline.
      return { ok: false, endpoint, method, at, error: error?.name === 'AbortError' ? 'timed out' : 'unreachable' };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  return {
    endpoint,
    call,
    /** The chain's tip, and the genesis hash that identifies which chain it is. */
    async identity() {
      const [header, genesis] = await Promise.all([call('chain_getHeader'), call('chain_getBlockHash', ['0x0'])]);
      if (!header.ok) return { ok: false, error: header.error, at: header.at, endpoint };
      return {
        ok: true,
        endpoint,
        at: header.at,
        bestBlock: Number.parseInt(header.result?.number ?? '0x0', 16),
        genesisHash: genesis.ok ? genesis.result : null,
      };
    },
    /** One block's extrinsics, by height. Block bodies survive state pruning. */
    async blockAt(number) {
      const hash = await call('chain_getBlockHash', [`0x${number.toString(16)}`]);
      if (!hash.ok) return { ok: false, error: hash.error, at: hash.at, endpoint };
      const block = await call('chain_getBlock', [hash.result]);
      if (!block.ok) return { ok: false, error: block.error, at: block.at, endpoint };
      return {
        ok: true,
        endpoint,
        at: block.at,
        blockHash: hash.result,
        extrinsics: block.result?.block?.extrinsics ?? [],
      };
    },
  };
}
