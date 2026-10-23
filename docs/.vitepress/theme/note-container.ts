// `::: note LABEL` — a MarginNote. markdown-it-container is bundled inside
// VitePress and not resolvable from docs/, so the container rule is written
// here (the same algorithm: a fence of three or more colons, the name, an
// optional label, closed by a colon fence of at least the opening length).
// The rendered markup is the chrome's `marginNote` from templates.mjs:
// <aside class="nw-note"> leader · <div class="nw-note-body"> label · text.
import type MarkdownIt from 'markdown-it'
import type StateBlock from 'markdown-it/lib/rules_block/state_block.mjs'

const NAME = 'note'
const MARKER = 0x3a /* : */
const MIN_MARKERS = 3

export function noteContainer(md: MarkdownIt): void {
  function rule(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
    let pos = state.bMarks[startLine] + state.tShift[startLine]
    let max = state.eMarks[startLine]
    if (state.src.charCodeAt(pos) !== MARKER) return false

    let mem = pos
    while (pos <= max && state.src.charCodeAt(pos) === MARKER) pos++
    const markerCount = pos - mem
    if (markerCount < MIN_MARKERS) return false

    const markup = state.src.slice(mem, pos)
    const params = state.src.slice(pos, max)
    if (params.trim().split(/\s+/, 1)[0] !== NAME) return false
    if (silent) return true

    let nextLine = startLine
    let autoClosed = false
    for (;;) {
      nextLine++
      if (nextLine >= endLine) break
      pos = state.bMarks[nextLine] + state.tShift[nextLine]
      max = state.eMarks[nextLine]
      if (pos < max && state.sCount[nextLine] < state.blkIndent) break
      if (state.src.charCodeAt(pos) !== MARKER) continue
      if (state.sCount[nextLine] - state.blkIndent >= 4) continue
      mem = pos
      while (pos <= max && state.src.charCodeAt(pos) === MARKER) pos++
      if (pos - mem < markerCount) continue
      pos = state.skipSpaces(pos)
      if (pos < max) continue
      autoClosed = true
      break
    }

    const oldParent = state.parentType
    const oldLineMax = state.lineMax
    state.parentType = 'container' as StateBlock['parentType']
    state.lineMax = nextLine

    let token = state.push('container_note_open', 'aside', 1)
    token.markup = markup
    token.block = true
    token.info = params
    token.map = [startLine, nextLine]

    state.md.block.tokenize(state, startLine + 1, nextLine)

    token = state.push('container_note_close', 'aside', -1)
    token.markup = state.src.slice(mem, pos)
    token.block = true

    state.parentType = oldParent
    state.lineMax = oldLineMax
    state.line = nextLine + (autoClosed ? 1 : 0)
    return true
  }

  md.block.ruler.before('fence', 'container_note', rule, {
    alt: ['paragraph', 'reference', 'blockquote', 'list'],
  })
  md.renderer.rules.container_note_open = (tokens, idx) => {
    const label = tokens[idx].info.trim().slice(NAME.length).trim()
    return (
      `<aside class="nw-note" data-note><span class="nw-leader" aria-hidden="true"></span>` +
      `<div class="nw-note-body"><span class="nw-label">${md.utils.escapeHtml(label)}</span>`
    )
  }
  md.renderer.rules.container_note_close = () => '</div></aside>\n'
}
