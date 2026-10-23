// The docs theme: VitePress's default theme (nav, sidebar, outline, local
// search, previous/next, not-found) with its variables set to the shared
// tokens in custom.css (SITE-REDESIGN.md §5.6). The theme's own Inter files
// are left out: the chrome's fonts.css (Inter variable, JetBrains Mono) is
// the only face on every surface. Nothing is drawn here.
import type { Theme } from 'vitepress'
import DefaultTheme from 'vitepress/theme-without-fonts'
import './custom.css'

export default DefaultTheme satisfies Theme
