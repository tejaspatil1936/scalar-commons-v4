// TRANSITIONAL (SITE-REDESIGN.md phase 3): /observatory is now a redirect to
// /network (src/network.mjs renders both). This module remains only because
// src/oversight.mjs still imports the retired Pulse nav entry from it; the
// oversight phase drops that import and the integrator deletes this file.
export const PULSE_NAV = { key: 'pulse', label: 'Pulse', href: 'pulse' };
