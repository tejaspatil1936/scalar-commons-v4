import { Keyring } from '@polkadot/keyring';
import { cryptoWaitReady, mnemonicGenerate } from '@polkadot/util-crypto';

/**
 * Print a fresh agent env file on stdout and the address on stderr:
 *   node dist/keygen.js > agent.env && chmod 600 agent.env
 * The mnemonic goes only to the redirected file; the terminal shows the address.
 */
await cryptoWaitReady();
const mnemonic = mnemonicGenerate();
const address = new Keyring({ type: 'sr25519' }).addFromUri(mnemonic).address;
console.log(`SCALAR_WS=wss://rpc.scalarnet.io\nAGENT_MODE=provider\nAGENT_MNEMONIC=${mnemonic}`);
console.error(`agent address: ${address}`);
