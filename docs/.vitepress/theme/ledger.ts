// The Ledger docs theme's data plumbing: the chrome's fixed words (mirrored from
// landing/src/chrome/templates.mjs), the build facts config.mts hands over,
// and the sidebar read as the route list. No figure is typed here.
import { computed } from 'vue'
import { useData, useRoute } from 'vitepress'

export const SITE_NAME = 'Scalar Commons'
export const DISCLAIMER = 'Testnet — the token has no value and the chain may be reset.'
export const SITE_ORIGIN = 'https://scalarnet.io/'
export const EXPLORER_ORIGIN = 'https://explorer.scalarnet.io'
export const DOCS_URL = 'https://scalarnet.io/docs/'
export const REPO_URL = 'https://github.com/tejaspatil1936/scalar-commons-v4'

/** The site nav in the brief's order. The docs live under /docs/, so every landing href is absolute. */
export const NAV = [
  { key: 'observatory', label: 'Observatory', href: `${SITE_ORIGIN}observatory` },
  { key: 'pulse', label: 'Pulse', href: `${SITE_ORIGIN}pulse` },
  { key: 'explorer', label: 'Explorer', href: EXPLORER_ORIGIN },
  { key: 'docs', label: 'Docs', href: DOCS_URL },
  { key: 'oversight', label: 'Oversight', href: `${SITE_ORIGIN}oversight` },
  { key: 'faucet', label: 'Faucet', href: `${SITE_ORIGIN}faucet` },
]

export interface Facts {
  chainName: string
  specVersion: number
  block: number
  genesisHash: string
  nodeVersion: string
  builtAt: string
  pages: number
  drift: number
  checkPassed: boolean
}

export interface Source {
  method: string
  url: string
  fetchedAt?: string | null
  block?: number | null
  raw?: string | null
  computed?: string | null
}

export interface SidebarItem {
  text: string
  link: string
}
export interface SidebarGroup {
  text: string
  items: SidebarItem[]
}

const groups = new Intl.NumberFormat('en-US')
export const formatInt = (n: number | string | bigint): string =>
  groups.format(typeof n === 'bigint' ? n : Number(n))

/** UTC to the second, the way every receipt prints time. */
export const utc = (iso: string | null | undefined): string | null =>
  iso
    ? String(iso)
        .replace('T', ' ')
        .replace(/\.\d+Z$/, 'Z')
        .replace(/Z$/, ' UTC')
    : null

/** `GET api.scalarnet.io/v1/status` style request line for a source. */
export const requestLine = (source: Source): string =>
  `${source.method} ${String(source.url).replace(/^https?:\/\//, '').replace(/^wss?:\/\//, '')}`

export function useFacts() {
  const { theme } = useData()
  return computed(() => theme.value.ledger as Facts)
}

/** Strip the base and a trailing `.html`/`index` so a route matches a sidebar link. */
const normalise = (path: string): string =>
  path
    .replace(/\.html$/, '')
    .replace(/\/index$/, '/')
    .replace(/\/$/, '') || '/'

export function useWatchLog() {
  const { theme, site } = useData()
  const route = useRoute()
  const sidebar = computed(() => (theme.value.sidebar ?? []) as SidebarGroup[])
  const flat = computed(() =>
    sidebar.value.flatMap((g) => g.items.map((item) => ({ ...item, group: g.text }))),
  )
  const currentPath = computed(() => {
    const base = site.value.base.replace(/\/$/, '')
    const path = route.path.startsWith(base) ? route.path.slice(base.length) : route.path
    return normalise(path)
  })
  const currentIndex = computed(() =>
    flat.value.findIndex((p) => normalise(p.link) === currentPath.value),
  )
  const current = computed(() => (currentIndex.value >= 0 ? flat.value[currentIndex.value] : null))
  const prev = computed(() => (currentIndex.value > 0 ? flat.value[currentIndex.value - 1] : null))
  const next = computed(() =>
    currentIndex.value >= 0 && currentIndex.value < flat.value.length - 1
      ? flat.value[currentIndex.value + 1]
      : null,
  )
  const isCurrent = (item: SidebarItem) => normalise(item.link) === currentPath.value
  return { sidebar, flat, current, prev, next, isCurrent }
}
