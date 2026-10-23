// Code in the shared style (SITE-REDESIGN.md §3, Code block): --text on
// --bg-2, the mono face, no syntax colours. A Shiki theme whose one colour is
// a token's CSS variable, so the built HTML carries `color:var(--text)` and
// never a colour literal (Shiki's bundled themes emit hex pairs into every span).
import type { MarkdownOptions } from 'vitepress'

const TEXT = 'var(--text)'

export const plainCodeTheme = {
  name: 'scalar-plain',
  type: 'light',
  colors: {
    'editor.foreground': TEXT,
    'editor.background': 'var(--bg-2)',
  },
  tokenColors: [{ settings: { foreground: TEXT } }],
} satisfies NonNullable<MarkdownOptions['theme']>
