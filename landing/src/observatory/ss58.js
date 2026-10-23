// TRANSITIONAL (SITE-REDESIGN.md phase 3): the SS58 encoder moved to
// src/network/ss58.js with the network page. src/faucet/address.js, the
// oversight blakejs shim and test/oversight/verify.test.mjs still import it
// from here until their own phases re-point them; the integrator deletes this
// file once nothing does.
export * from '../network/ss58.js';
