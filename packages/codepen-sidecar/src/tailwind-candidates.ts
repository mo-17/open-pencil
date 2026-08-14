const MAX_CANDIDATES = 20_000
const MAX_CANDIDATE_BYTES = 256
const SAFE_CANDIDATE = /^[!A-Za-z0-9_@#$%&*+,./:=[\]()-]+$/

export class CodePenTailwindCandidateError extends Error {
  readonly code = 'tailwind-candidate-limit'

  constructor() {
    super('CodePen export blocked: generated Tailwind candidates exceed the safety limit')
    this.name = 'CodePenTailwindCandidateError'
  }
}

export class CodePenTailwindDirectiveError extends Error {
  readonly code = 'unsafe-tailwind-directive'

  constructor() {
    super('CodePen export blocked: a Tailwind source directive is unsafe')
    this.name = 'CodePenTailwindDirectiveError'
  }
}

function addLiteralCandidates(literal: string, candidates: Set<string>): void {
  for (const rawCandidate of literal.split(/\s+/)) {
    const candidate = rawCandidate.replace(/^["']+|[,"']+$/g, '')
    if (
      candidate.length === 0 ||
      new TextEncoder().encode(candidate).byteLength > MAX_CANDIDATE_BYTES ||
      !SAFE_CANDIDATE.test(candidate)
    ) {
      continue
    }
    candidates.add(candidate)
    if (candidates.size > MAX_CANDIDATES) throw new CodePenTailwindCandidateError()
  }
}

function skipComment(source: string, start: number): number {
  if (source[start + 1] === '/') {
    const newline = source.indexOf('\n', start + 2)
    return newline === -1 ? source.length : newline + 1
  }
  const end = source.indexOf('*/', start + 2)
  return end === -1 ? source.length : end + 2
}

function readQuotedLiteral(source: string, start: number): { end: number; literal: string } {
  const quote = source[start]
  let index = start + 1
  let literal = ''
  while (index < source.length) {
    if (source[index] === '\\') {
      index += 2
      continue
    }
    if (source[index] === quote) return { end: index + 1, literal }
    literal += source[index++]
  }
  return { end: source.length, literal: '' }
}

function skipWhitespace(source: string, start: number): number {
  let index = start
  while (/\s/.test(source[index] ?? '')) index++
  return index
}

function sourceDirectiveEnd(source: string, start: number): number {
  let index = skipWhitespace(source, start)
  if (source.slice(index, index + 6).toLowerCase() !== 'inline') {
    throw new CodePenTailwindDirectiveError()
  }
  index = skipWhitespace(source, index + 6)
  if (source[index++] !== '(') throw new CodePenTailwindDirectiveError()
  index = skipWhitespace(source, index)
  const quote = source[index++]
  if (quote !== '"' && quote !== "'") throw new CodePenTailwindDirectiveError()
  while (index < source.length && source[index] !== quote) {
    if (source[index] === '\\' || source[index] === '{' || source[index] === '}') {
      throw new CodePenTailwindDirectiveError()
    }
    index++
  }
  if (source[index++] !== quote) throw new CodePenTailwindDirectiveError()
  index = skipWhitespace(source, index)
  if (source[index++] !== ')') throw new CodePenTailwindDirectiveError()
  index = skipWhitespace(source, index)
  if (source[index++] !== ';') throw new CodePenTailwindDirectiveError()
  return index
}

export function stripCodePenTailwindDirectives(source: string): string {
  let index = 0
  let copiedUntil = 0
  let output = ''
  while (index < source.length) {
    if (source.startsWith('/*', index)) {
      index = skipComment(source, index)
      continue
    }
    if (source[index] === '"' || source[index] === "'") {
      index = readQuotedLiteral(source, index).end
      continue
    }
    if (source[index] !== '@') {
      index++
      continue
    }
    const directiveStart = index++
    const nameStart = index
    while (/[A-Za-z-]/.test(source[index] ?? '')) index++
    const name = source.slice(nameStart, index).toLowerCase()
    if (name === 'plugin' || name === 'config') throw new CodePenTailwindDirectiveError()
    if (name !== 'source') continue
    index = sourceDirectiveEnd(source, index)
    output += source.slice(copiedUntil, directiveStart)
    copiedUntil = index
  }
  return output + source.slice(copiedUntil)
}

function readTemplateLiteral(
  source: string,
  start: number,
  candidates: Set<string>
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
      addLiteralCandidates(chunk, candidates)
      return { dynamic, end: index + 1 }
    }
    if (source.startsWith('${', index)) {
      addLiteralCandidates(chunk, candidates)
      chunk = ''
      dynamic = true
      index += 2
      continue
    }
    chunk += source[index++]
  }
  return { dynamic, end: source.length }
}

export function extractCodePenTailwindCandidates(files: ReadonlyMap<string, string | Uint8Array>): {
  candidates: readonly string[]
  dynamic: boolean
} {
  const candidates = new Set<string>()
  let dynamic = false
  for (const [path, content] of files) {
    if (typeof content !== 'string' || (!path.startsWith('src/') && !path.endsWith('.vue'))) {
      continue
    }
    let index = 0
    while (index < content.length) {
      if (content.startsWith('//', index) || content.startsWith('/*', index)) {
        index = skipComment(content, index)
        continue
      }
      if (content[index] === '"' || content[index] === "'") {
        const quoted = readQuotedLiteral(content, index)
        addLiteralCandidates(quoted.literal, candidates)
        index = quoted.end
        continue
      }
      if (content[index] === '`') {
        const template = readTemplateLiteral(content, index, candidates)
        dynamic ||= template.dynamic
        index = template.end
        continue
      }
      index++
    }
    dynamic ||= /\bclassName\s*=\s*\{|(?:^|\s):class\s*=/.test(content)
  }
  return { candidates: [...candidates].sort(), dynamic }
}
