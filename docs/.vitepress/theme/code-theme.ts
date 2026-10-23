// The Ledger's code: ink on paper-2, no hue (SITE-ROUND2.md §1.2, `Code`).
// A Shiki theme whose every colour is a Ledger token's CSS variable, so the
// built HTML carries `color:var(--ink)` and never a colour literal (Shiki's
// bundled themes emit --shiki-light/--shiki-dark hex pairs into every span).
// Keywords print in ink too; docs.css sets them at weight 500 by the variable
// they carry, `--nw-code-keyword`, which it defines as var(--ink). Comments and
// strings print in ink-2; everything else in ink.
import type { MarkdownOptions } from 'vitepress'

const INK = 'var(--ink)'
const INK_2 = 'var(--ink-2)'
const KEYWORD = 'var(--nw-code-keyword)'

export const ledgerCodeTheme = {
  name: 'ledger-ink',
  type: 'light',
  colors: {
    'editor.foreground': INK,
    'editor.background': 'var(--paper-2)',
  },
  tokenColors: [
    { settings: { foreground: INK } },
    {
      scope: ['comment', 'punctuation.definition.comment', 'string.quoted.docstring.multi'],
      settings: { foreground: INK_2 },
    },
    {
      scope: [
        'string',
        'string.quoted',
        'string.template',
        'string.regexp',
        'string.unquoted.plain.out.yaml',
        'markup.inline.raw',
      ],
      settings: { foreground: INK_2 },
    },
    {
      scope: [
        'keyword',
        'keyword.control',
        'keyword.other',
        'storage',
        'storage.type',
        'storage.modifier',
        'constant.language',
        'variable.language',
        'support.function.builtin.shell',
        'entity.name.tag.yaml',
        'support.type.property-name.toml',
      ],
      settings: { foreground: KEYWORD },
    },
    {
      // Operators, accessors and a BigInt's `n` are punctuation, not keywords: ink at weight 400.
      scope: ['keyword.operator', 'keyword.operator.accessor', 'storage.type.numeric', 'punctuation'],
      settings: { foreground: INK },
    },
  ],
} satisfies NonNullable<MarkdownOptions['theme']>
