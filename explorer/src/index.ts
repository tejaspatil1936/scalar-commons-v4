/**
 * Explorer entry point.
 *
 * Connects to a node first and only then starts listening: a process that
 * accepted requests before it had a chain behind it would answer them with
 * plausible-looking empty pages, which is the one failure an explorer must not
 * have.
 */

import { connectExplorerChain } from './chain.js';
import { readIntEnv } from './config.js';
import { createExplorerServer } from './server.js';

const rpcEndpoint = process.env.EXPLORER_RPC_ENDPOINT ?? 'ws://127.0.0.1:9944';
// Port 0 is meaningful (ask the OS for any free port), so the range starts there.
const port = readIntEnv('EXPLORER_PORT', process.env.EXPLORER_PORT, 8080, 0, 65_535);
const host = process.env.EXPLORER_HOST ?? '127.0.0.1';

const chain = await connectExplorerChain({ rpcEndpoint });
const info = chain.chainInfo();
const server = createExplorerServer({ chain });

server.listen(port, host, () => {
  console.log(
    `[explorer] serving ${info.chain} (${info.specName} spec ${info.specVersion}) from ${rpcEndpoint} on http://${host}:${port}`,
  );
});

/** Closes the socket and the node connection so a restart does not leak a subscription. */
async function shutdown(signal: string): Promise<void> {
  console.log(`[explorer] ${signal} received, shutting down`);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await chain.disconnect();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
