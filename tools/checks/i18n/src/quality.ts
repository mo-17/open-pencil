const PLACEHOLDER_PATTERN = /\{([A-Za-z][A-Za-z0-9_]*)\}/g
const CODE_LITERAL_PATTERN =
  /\$[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+(?:\s*\/\s*\.[A-Za-z_][A-Za-z0-9_]*)*/g

export function placeholders(value: string): string[] {
  return [...value.matchAll(PLACEHOLDER_PATTERN)].map((match) => match[1]).sort()
}

export function visibleTranslationText(value: string): string {
  return value.replaceAll(PLACEHOLDER_PATTERN, '')
}

export function isNonLinguisticMessageSyntax(value: string): boolean {
  if (placeholders(value).length > 0 && /^[\s,/·]*$/.test(visibleTranslationText(value))) {
    return true
  }
  if (!/^https?:\/\/[^/]/.test(value) || /[\s\p{Cc}{}\\]/u.test(value)) return false
  try {
    const url = new URL(value)
    return Boolean(url.hostname) && !url.username && !url.password
  } catch {
    return false
  }
}

export function normalizedTranslationText(value: string): string {
  return value.normalize('NFKC').replaceAll(/\s+/g, ' ').trim()
}

export function isIdenticalEnglishProse(source: string, localized: string): boolean {
  return (
    normalizedTranslationText(source) === normalizedTranslationText(localized) &&
    !(source === localized && isNonLinguisticMessageSyntax(source))
  )
}

function isCompleteCodeLiteral(value: string, offset: number, literal: string): boolean {
  const prefix = value.slice(0, offset)
  const suffix = value.slice(offset + literal.length)
  return (
    !/[\p{L}\p{N}\p{M}_$]$/u.test(prefix) &&
    !/^[\p{L}\p{N}\p{M}_$[(]/u.test(suffix) &&
    !/^\.[\p{L}\p{N}\p{M}_$.[(]/u.test(suffix) &&
    !/^\s*\/\s*\./.test(suffix)
  )
}

export function hasMixedLatinAndCjk(value: string, source?: string): boolean {
  let visibleText = visibleTranslationText(value)
  // Only remove explicit dollar-rooted references present in unquoted source prose.
  // Quoted labels, product names, acronyms and bare identifiers still need review.
  if (source && !/["'`]/.test(source) && !/["'`]/.test(value)) {
    const sourceLiterals = new Set(
      [...source.matchAll(CODE_LITERAL_PATTERN)]
        .filter((match) => isCompleteCodeLiteral(source, match.index, match[0]))
        .map((match) => match[0])
    )
    visibleText = visibleText.replaceAll(CODE_LITERAL_PATTERN, (literal: string, offset: number) =>
      sourceLiterals.has(literal) && isCompleteCodeLiteral(visibleText, offset, literal)
        ? ''
        : literal
    )
  }
  return (
    /\p{Script=Latin}/u.test(visibleText) &&
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(visibleText)
  )
}
