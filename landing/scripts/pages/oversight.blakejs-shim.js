// A stand-in for the `blakejs` package, used by scripts/pages/oversight.mjs
// ONLY while `blakejs` is absent from node_modules (it is in package.json on
// the oversight branch; this checkout's lockfile does not carry it yet). The
// bytes are the same: src/oversight/verify.js hashes with blake2b-256 and
// test/oversight/verify.test.mjs asserts that blakejs and the observatory's
// own blake2b agree byte for byte. Once `npm ci` installs blakejs the alias is
// not applied and this file is dead code to delete.
import { blake2b as observatoryBlake2b } from '../../src/observatory/ss58.js';

export function blake2b(input, key = undefined, outlen = 64) {
  if (key !== undefined && key !== null) throw new Error('blakejs shim: keyed blake2b is not supported');
  const bytes = input instanceof Uint8Array ? input : new TextEncoder().encode(String(input));
  return observatoryBlake2b(bytes, outlen);
}
