export const CODE_BLOCK_LAYOUT = Object.freeze({
  headerHeight: 60,
  inset: 12,
  headerInset: 8,
  copyWidth: 64,
  actionHeight: 44,
  lineHeight: 1.55,
  headerFontSize: 12,
  languageFontSize: 11,
  copyMinimumWidth: 108
})

/** Tabs advance to authored tab stops; the stored and copied source is never rewritten. */
export function codeBlockCanvasLine(line: string, tabSize: number): string {
  let column = 0
  return Array.from(line, (character) => {
    const size = character === '\t' ? tabSize - (column % tabSize) : 1
    column += size
    return character === '\t' ? ' '.repeat(size) : character
  }).join('')
}
