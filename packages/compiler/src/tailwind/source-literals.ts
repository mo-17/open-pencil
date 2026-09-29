export function skipSourceComment(source: string, start: number): number {
  if (source[start + 1] === '/') {
    const newline = source.indexOf('\n', start + 2)
    return newline === -1 ? source.length : newline + 1
  }
  const end = source.indexOf('*/', start + 2)
  return end === -1 ? source.length : end + 2
}

export function readSourceQuotedLiteral(
  source: string,
  start: number
): { value: string; end: number } {
  const quote = source[start]
  let value = ''
  let index = start + 1
  while (index < source.length) {
    if (source[index] === '\\') {
      index += 2
      continue
    }
    if (source[index] === quote) return { value, end: index + 1 }
    value += source[index++]
  }
  return { value: '', end: source.length }
}

function templateLiteral(
  source: string,
  start: number,
  visit: (value: string) => void
): { dynamic: boolean; end: number } {
  let chunk = ''
  let dynamic = false
  let index = start + 1
  while (index < source.length) {
    if (source[index] === '\\') {
      index += 2
      continue
    }
    if (source[index] === '`') {
      visit(chunk)
      return { dynamic, end: index + 1 }
    }
    if (source.startsWith('${', index)) {
      visit(chunk)
      chunk = ''
      dynamic = true
      index += 2
      continue
    }
    chunk += source[index++]
  }
  return { dynamic, end: source.length }
}

/** Visit static strings without evaluating generated JavaScript or importing code. */
export function scanSourceLiterals(source: string, visit: (value: string) => void): boolean {
  let dynamic = false
  let index = 0
  while (index < source.length) {
    if (source.startsWith('//', index) || source.startsWith('/*', index)) {
      index = skipSourceComment(source, index)
      continue
    }
    if (source[index] === '"' || source[index] === "'") {
      const literal = readSourceQuotedLiteral(source, index)
      visit(literal.value)
      index = literal.end
      continue
    }
    if (source[index] === '`') {
      const literal = templateLiteral(source, index, visit)
      dynamic ||= literal.dynamic
      index = literal.end
      continue
    }
    index += 1
  }
  return dynamic
}
