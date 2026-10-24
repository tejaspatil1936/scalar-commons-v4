/**
 * The explorer's page-scoped rules, appended to the shared chrome at
 * `/chrome.css`. Layout only: vertical rhythm between blocks of a page and
 * long values that must wrap. Tokens only — no colour, size or step of its own.
 */
export const EXPLORER_CSS = `
/* explorer: page-scoped layout on the shared chrome */
.ex-page { padding-bottom: var(--s-8); }
.ex-search { padding-top: var(--s-7); padding-bottom: var(--s-6); }
.ex-block { margin-top: var(--s-6); }
.ex-head { margin-bottom: var(--s-3); }
.ex-wrap { overflow-wrap: anywhere; word-break: break-all; }
.ex-address { margin-top: calc(-1 * var(--s-4)); }
.ex-agent > .sc-row { margin-bottom: var(--s-4); }
.ex-formats { margin-bottom: var(--s-4); }
.sc-table time { white-space: nowrap; }
.sc-stat-value a { color: inherit; }
/* the home page's two side-by-side tables: five columns must fit half the container at 1440 without scrolling */
.ex-compact .sc-table th, .ex-compact .sc-table td { padding-inline: var(--s-2); }
@media (max-width: 640px) {
  /* balances can be long figures: one per row on a phone */
  .ex-balances .sc-stats { grid-template-columns: minmax(0, 1fr); }
  .ex-balances .sc-stats > .sc-stat:nth-child(n) { border-left: 0; border-top: 1px solid var(--border); }
  .ex-balances .sc-stats > .sc-stat:first-child { border-top: 0; }
}
`;
