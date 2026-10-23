// The docs theme: VitePress's default theme (sidebar, right-hand outline,
// local search, previous/next) with its variables set to the shared tokens
// (custom.css), the shared chrome's sheets synced from landing/src/chrome, and
// three additions in the chrome's markup: GitHub and Get started at the end of
// the nav bar, the site footer under every page, and a plain 404.
// The default theme's Layout and the stylesheets it needs are imported one by
// one: the package entry also pulls in its own Inter files (the chrome
// self-hosts Inter) and the team, sponsor and code-group styles, which these
// docs never render (SITE-REDESIGN.md §7, page weight).
import 'vitepress/dist/client/theme-default/styles/vars.css'
import 'vitepress/dist/client/theme-default/styles/base.css'
import 'vitepress/dist/client/theme-default/styles/icons.css'
import 'vitepress/dist/client/theme-default/styles/utils.css'
import 'vitepress/dist/client/theme-default/styles/components/custom-block.css'
import 'vitepress/dist/client/theme-default/styles/components/vp-code.css'
import 'vitepress/dist/client/theme-default/styles/components/vp-doc.css'
import DefaultLayout from 'vitepress/dist/client/theme-default/Layout.vue'
import type { Theme } from 'vitepress'
import { h } from 'vue'
import NavEnd from './components/NavEnd.vue'
import NavScreenEnd from './components/NavScreenEnd.vue'
import SiteFooter from './components/SiteFooter.vue'
import NotFound from './components/NotFound.vue'
import DocsHome from './components/DocsHome.vue'
import './chrome/tokens.css'
import './chrome/fonts.css'
import './chrome/chrome.css'
import './custom.css'

export default {
  Layout: () =>
    h(DefaultLayout, null, {
      'nav-bar-content-after': () => h(NavEnd),
      'nav-screen-content-after': () => h(NavScreenEnd),
      'layout-bottom': () => h(SiteFooter),
      'not-found': () => h(NotFound),
    }),
  enhanceApp({ app }) {
    app.component('DocsHome', DocsHome)
  },
} satisfies Theme
