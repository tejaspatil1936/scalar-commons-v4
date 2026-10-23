// TRANSITIONAL (SITE-REDESIGN.md phase 3): the SCALE decoders moved to
// src/network/scale.js with the network page. src/oversight/verify.js still
// imports them from here until the oversight phase re-points it; the
// integrator deletes this file once nothing does.
export * from '../network/scale.js';
