// Nightwatch — the docs theme. It consumes the chrome synced from
// landing/src/chrome (tokens, chrome, print; the fonts resolve beside
// chrome.css) and adds only the rules the docs' own surfaces need (docs.css).
// No default-theme nav, sidebar, footer or hero: the Layout is the chrome's.
import type { Theme } from 'vitepress'
import Layout from './Layout.vue'
import './chrome/tokens.css'
import './chrome/chrome.css'
import './chrome/print.css'
import './docs.css'

export default {
  Layout,
} satisfies Theme
