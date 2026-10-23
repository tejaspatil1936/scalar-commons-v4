import { defineConfig } from 'vitepress'
import { noteContainer } from './theme/note-container'
import { plainCodeTheme } from './theme/code-theme'

// The chain snapshot the prose is checked against (`npm run snapshot:chain`,
// `scripts/check-chain-values.mjs`). The footer's caption line reads its
// runtime and block from here, so no figure in the theme is typed by hand.
import snapshot from '../.chain/snapshot.json'

/** The public site the docs sit under; every link that leaves the docs goes there. */
const SITE = 'https://scalarnet.io'
const REPO = 'https://github.com/tejaspatil1936/scalar-commons-v4'
const BASE = process.env.DOCS_BASE ?? '/'

const sidebar = [
  {
    text: 'Guide',
    items: [
      { text: 'Run a node', link: '/guide/run-a-node' },
      { text: 'Run an agent', link: '/guide/run-an-agent' },
      { text: 'Agent on the public testnet', link: '/guide/run-an-agent-public-testnet' },
      { text: 'Run a validator', link: '/guide/run-a-validator' },
      { text: 'Testnet tester guide', link: '/guide/testnet-tester-guide' },
      { text: 'SDK usage', link: '/guide/sdk' },
      { text: 'Messaging with the SDK', link: '/guide/messaging-sdk' },
    ],
  },
  {
    text: 'Reference',
    items: [
      { text: 'RPC reference', link: '/reference/rpc' },
      { text: 'Token model', link: '/reference/token-model' },
      { text: 'Constitution', link: '/reference/constitution' },
      { text: 'Messages pallet', link: '/reference/messages' },
      { text: 'Message envelope', link: '/reference/messaging' },
      // The privacy demo lives on the site, not in the docs; it opens in the same tab.
      {
        text: 'Message privacy: what an operator can read',
        link: `${SITE}/oversight`,
        target: '_self',
        rel: 'noopener',
      },
    ],
  },
]

export default defineConfig({
  title: 'Scalar Commons',
  titleTemplate: ':title — Scalar Commons',
  description:
    'Documentation for Scalar Commons: run a node, an agent or a validator, and the reference for the RPC, the token model and the runtime modules.',
  lang: 'en',

  // The host publishes the landing page at the site root and these docs one
  // level below it at `/docs/`. VitePress bakes the base prefix into every
  // asset and router URL it emits, so it is passed in at build time.
  base: BASE,

  // The site lives in `docs/` alongside engineering records that are not part
  // of the published documentation. They stay where they are.
  srcExclude: ['VERIFIED-CONSTANTS.md', 'rfcs/**', 'README.md'],

  // A broken internal link is a documentation bug, so fail the build on one.
  ignoreDeadLinks: false,

  cleanUrls: true,

  // No prefetching of the pages the sidebar links to: a first load fetches
  // only what the page itself needs (SITE-REDESIGN.md §7, at most 12 requests).
  router: { prefetchLinks: false },

  // One theme, light: no dark scheme and no appearance toggle (SITE-REDESIGN.md §2).
  appearance: false,

  head: [
    ['link', { rel: 'icon', href: `${SITE}/favicon.svg`, type: 'image/svg+xml' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: 'Scalar Commons' }],
    ['meta', { property: 'og:image', content: `${SITE}/og.png` }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
  ],

  // Per page: the canonical URL and the Open Graph title, description and URL.
  transformHead({ pageData, title, description }) {
    const route = pageData.relativePath.replace(/(^|\/)index\.md$/, '$1').replace(/\.md$/, '')
    const url = `${SITE}${BASE}${route}`
    return [
      ['link', { rel: 'canonical', href: url }],
      ['meta', { property: 'og:title', content: title }],
      ['meta', { property: 'og:description', content: description }],
      ['meta', { property: 'og:url', content: url }],
    ]
  },

  markdown: {
    // Code in the shared style: one colour, no syntax colours (theme/code-theme.ts).
    theme: plainCodeTheme,
    // External links open in the same tab (a visitor can middle-click), as on the site.
    externalLinks: { target: '_self', rel: 'noopener' },
    config(md) {
      md.use(noteContainer)
    },
  },

  themeConfig: {
    siteTitle: 'Scalar Commons',
    logoLink: { link: `${SITE}/`, target: '_self' },

    // The primary navigation, as on every surface: Network · Explorer · Docs · Faucet.
    // GitHub and the Get started button sit after it (theme/components/NavEnd.vue).
    nav: [
      { text: 'Network', link: `${SITE}/network`, target: '_self', noIcon: true },
      { text: 'Explorer', link: 'https://explorer.scalarnet.io/', target: '_self', noIcon: true },
      { text: 'Docs', link: '/', activeMatch: '^/' },
      { text: 'Faucet', link: `${SITE}/faucet`, target: '_self', noIcon: true },
    ],

    sidebar,
    outline: { level: [2, 3], label: 'On this page' },
    search: { provider: 'local' },
    docFooter: { prev: 'Previous', next: 'Next' },
    sidebarMenuLabel: 'Pages',
    returnToTopLabel: 'Back to top',
    // External links in prose carry the external-link icon (the nav's site links opt out).
    externalLinkIcon: true,

    // Read by the shared footer (theme/components/SiteFooter.vue): every figure a record.
    facts: {
      site: SITE,
      repo: REPO,
      specName: snapshot.runtime.specName,
      specVersion: snapshot.runtime.specVersion,
      block: snapshot.provenance.capturedAtBlock,
      builtAt: new Date().toISOString(),
    },
  },
})
