const BARE_PACKAGE_SPECIFIER_RE =
  /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)(?:\/[A-Za-z0-9._-]+)*$/

export function isSafeBarePackageSpecifier(specifier: string): boolean {
  if (
    !BARE_PACKAGE_SPECIFIER_RE.test(specifier) ||
    specifier.includes('?') ||
    specifier.includes('#') ||
    specifier.includes('\\')
  ) {
    return false
  }
  const segments = specifier.split('/')
  return segments.every((segment) => segment !== '.' && segment !== '..')
}

type CodeFrame = { kind: 'code'; templateDepth: number | null }
type Frame = CodeFrame | { kind: 'single' | 'double' | 'template' | 'line' | 'block' }

function consumeQuoted(frame: Frame, char: string): 'pop' | 'skip' | 'continue' {
  if (frame.kind !== 'single' && frame.kind !== 'double') return 'continue'
  if (char === '\\') return 'skip'
  if ((frame.kind === 'single' && char === "'") || (frame.kind === 'double' && char === '"')) {
    return 'pop'
  }
  return 'continue'
}

function beginsDynamicImport(source: string, index: number): boolean {
  const identifier = /[A-Za-z0-9_$]/
  if (
    !source.startsWith('import', index) ||
    (index > 0 && identifier.test(source[index - 1])) ||
    identifier.test(source[index + 6] ?? '')
  ) {
    return false
  }
  let cursor = index + 6
  while (/\s/.test(source[cursor] ?? '')) cursor += 1
  return source[cursor] === '('
}

/** Bounded lexer that ignores text/comments while detecting executable import(...). */
// eslint-disable-next-line complexity
export function containsDynamicImport(source: string): boolean {
  const stack: Frame[] = [{ kind: 'code', templateDepth: null }]
  for (let index = 0; index < source.length; index++) {
    const frame = stack.at(-1)
    if (!frame) return false
    const char = source[index]
    const next = source[index + 1]
    if (frame.kind === 'line') {
      if (char === '\n') stack.pop()
      continue
    }
    if (frame.kind === 'block') {
      if (char === '*' && next === '/') {
        stack.pop()
        index += 1
      }
      continue
    }
    const quoted = consumeQuoted(frame, char)
    if (quoted !== 'continue') {
      if (quoted === 'pop') stack.pop()
      else index += 1
      continue
    }
    if (frame.kind === 'template') {
      if (char === '\\') index += 1
      else if (char === '`') stack.pop()
      else if (char === '$' && next === '{') {
        stack.push({ kind: 'code', templateDepth: 1 })
        index += 1
      }
      continue
    }
    if (frame.kind !== 'code') continue
    if (char === '/' && next === '/') {
      stack.push({ kind: 'line' })
      index += 1
      continue
    }
    if (char === '/' && next === '*') {
      stack.push({ kind: 'block' })
      index += 1
      continue
    }
    if (char === "'" || char === '"') {
      stack.push({ kind: char === "'" ? 'single' : 'double' })
      continue
    }
    if (char === '`') {
      stack.push({ kind: 'template' })
      continue
    }
    if (frame.templateDepth !== null) {
      if (char === '{') frame.templateDepth += 1
      if (char === '}') {
        frame.templateDepth -= 1
        if (frame.templateDepth === 0) stack.pop()
        continue
      }
    }
    if (beginsDynamicImport(source, index)) return true
  }
  return false
}
