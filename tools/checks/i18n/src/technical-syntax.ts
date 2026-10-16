// Product names, protocols, formats, units and schema/type names are copied, not translated.
// These are text-level terms, never message IDs. Ordinary prose does not belong here.
const TECHNICAL_TERMS = new Set([
  'Apache',
  'API',
  'ACK',
  'A/B',
  'Capacitor',
  'Cloudflare',
  'CRUD',
  'CSP',
  'CSS',
  'DNT',
  'Do Not Track',
  'EEA',
  'Electron',
  'Escape',
  'Expo',
  'Figma',
  'Figma Desktop',
  'Flutter',
  'FPS',
  'GA4',
  'GIF',
  'Google Tag Manager',
  'HTML',
  'HTTP',
  'HTTPS',
  'http(s)',
  'Hz',
  'ID',
  'iOS',
  'JSON',
  'JWT',
  'LIST',
  'macOS',
  'Management API',
  'MiB',
  'MIME',
  'MotionSpec',
  'Mpx',
  'NestJS',
  'Next.js',
  'Node.js',
  'OFL',
  'OIDC',
  'OpenPencil',
  'OpenStreetMap',
  'PEM',
  'PKCE',
  'Plausible',
  'PNG',
  'PostHog',
  'POST',
  'px',
  'React',
  'React Native',
  'RLS',
  'SEO',
  'Smart Match',
  'SQL',
  'Stripe',
  'Supabase',
  'Taro',
  'Tauri',
  'UI',
  'uni-app',
  'URI',
  'URL',
  'UUID',
  'Vue',
  'WebM',
  'WeChat',
  'Upsert',
  'YYYY-MM-DD',
  'ms',
  'X',
  'Y',
  'R',
  'G',
  'B',
  'A'
])

const HTML_TERMS = new Set([
  'head',
  'meta',
  'link',
  'style',
  'rel',
  'href',
  'as',
  'type',
  'media',
  'crossorigin',
  'nonce',
  'hash',
  'refresh',
  'style-src',
  'unsafe-inline',
  'accept',
  'name'
])
const HTML_CONTEXT =
  /\b(?:HTML|CSS|CSP|stylesheet|Link (?:rel|href|as|type|media|crossorigin)|meta refresh|head styles?|structured link|structured meta|crossorigin|chooser accept|radio inputs)\b/i
const TOKEN_PATTERN =
  /\$?[A-Za-z_][A-Za-z0-9_$]*(?:[./_-][A-Za-z0-9_$*]+)*(?:\(\))?(?:\.\.\.)?|[./#][a-z]+/g
const CODE_IDENTIFIER =
  /^(?:[A-Z][A-Z0-9]*_[A-Z0-9_]+|[a-z_][a-z0-9]*_[A-Za-z0-9_]*(?:\.\.\.)?|\$?[a-z]+[A-Z][A-Za-z0-9]*|__[A-Za-z0-9_]+\(\))$/
const FILE_EXTENSIONS = new Set([
  '.fig',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.svg',
  '.pdf',
  '.json',
  '.ttf',
  '.otf',
  '.zip',
  '.css'
])

function completeToken(value: string, index: number, token: string, term = false): boolean {
  const prefix = value.slice(0, index)
  const suffix = value.slice(index + token.length)
  return term
    ? !/[A-Za-z0-9_$]$/.test(prefix) && !/^(?:[A-Za-z0-9_$]|\.[A-Za-z0-9_$])/.test(suffix)
    : !/[A-Za-z0-9_$./_-]$/.test(prefix) && !/^(?:[A-Za-z0-9_$[(/_-]|\.[A-Za-z0-9_$])/.test(suffix)
}

function occurrences(value: string, token: string, term = false): number[] {
  const result: number[] = []
  let offset = value.indexOf(token)
  while (offset !== -1) {
    if (completeToken(value, offset, token, term)) result.push(offset)
    offset = value.indexOf(token, offset + token.length)
  }
  return result
}

function exampleSyntax(source: string): Set<string> {
  const result = new Set<string>()
  // These examples are input syntax, not English labels or lists of UI actions.
  if (source === 'id, name, email') result.add(source)
  for (const match of source.matchAll(/\{\s*[a-z][A-Za-z0-9]*(?:\s*,\s*[a-z][A-Za-z0-9]*)+\s*\}/g))
    result.add(match[0])
  for (const match of source.matchAll(/['`]([A-Za-z][A-Za-z0-9_@.+-]*)['`]/g)) result.add(match[0])
  for (const match of source.matchAll(/\bG-(?:\.\.\.|X+)\b|\bG-\.\.\./g)) result.add(match[0])
  const expressionExample = source.match(/e\.g\. ([a-z][A-Za-z0-9]* [><=]+ \d+)$/)
  if (expressionExample) result.add(expressionExample[1])
  if (source.startsWith('e.g. ') && source.includes(',')) {
    const examples = source.slice(5).split(/,\s*/)
    if (examples.every((example) => /^[a-z][A-Za-z0-9]*$|^'[a-z][A-Za-z0-9]*'$/.test(example))) {
      for (const example of examples) result.add(example)
    }
  }
  if (/\b(?:locale|e\.g\. US)\b/.test(source)) {
    const example = source.match(/e\.g\. ([A-Za-z]{2})$/)
    if (example) result.add(example[1])
  }
  if (/\bv\{version\}/.test(source)) result.add('v')
  return result
}

function sourceSyntax(source: string): Set<string> {
  const result = exampleSyntax(source)
  for (const match of source.matchAll(TOKEN_PATTERN)) {
    const token = match[0]
    if (!completeToken(source, match.index, token)) continue
    if (token === 'e.g') continue
    if (
      CODE_IDENTIFIER.test(token) ||
      FILE_EXTENSIONS.has(token) ||
      /^(?:[a-z]+\.[a-z][A-Za-z0-9.]*|[/#][a-z]+)$/.test(token) ||
      /^(?:image\/\*|(?:image|application|text|audio|video|font|model)\/[a-z]+)$/.test(token) ||
      /^v\d+$/.test(token)
    )
      result.add(token)
  }
  return result
}

function sourceTechnicalTerms(source: string): Set<string> {
  const tokens = sourceSyntax(source)
  for (const token of TECHNICAL_TERMS) {
    if (occurrences(source, token, true).length > 0) tokens.add(token)
  }
  if (HTML_CONTEXT.test(source)) {
    for (const token of HTML_TERMS) {
      if (occurrences(source.toLowerCase(), token, true).length > 0) tokens.add(token)
    }
  }
  for (const token of [
    'public',
    'null',
    'upsert',
    'update/delete',
    'secret/service_role/management'
  ]) {
    if (
      (source === token || /\b(?:schema|SQL|nullable|sign-in|polic|key)/i.test(source)) &&
      occurrences(source, token).length > 0
    )
      tokens.add(token)
  }
  if (source === 'nullable') tokens.add('null')
  if (source === 'not null') tokens.add('null')
  if (/\b(?:id|ids|ID|IDs)\b/.test(source))
    for (const token of ['id', 'ids', 'ID', 'IDs']) tokens.add(token)
  if (source.includes('Row Level Security')) tokens.add('RLS')
  if (source.includes('Do Not Track')) tokens.add('DNT')
  if (source.includes('false')) tokens.add('false')
  if (source.includes('nonce/hash')) tokens.add('nonce')
  if (source.includes('payloadJson') && source.includes('entries')) tokens.add('entries')
  return tokens
}

export function technicalText(source: string, localized: string): string {
  let result = localized
  const tokens = sourceTechnicalTerms(source)
  for (const token of [...tokens].sort((a, b) => b.length - a.length)) {
    const positions = occurrences(
      result,
      token,
      TECHNICAL_TERMS.has(token) || HTML_TERMS.has(token)
    )
    for (const index of positions.reverse()) {
      result =
        result.slice(0, index) + ' '.repeat(token.length) + result.slice(index + token.length)
    }
  }
  return result
}

export function changedTechnicalSyntax(source: string, localized: string): string[] {
  // Preserve actual API identifiers, calls, environment variables and complete code
  // inputs. Prose examples such as frame/page or #fragment are not immutable APIs.
  const syntax = new Set(
    [...sourceSyntax(source)].filter(
      (token) => !TECHNICAL_TERMS.has(token) && CODE_IDENTIFIER.test(token)
    )
  )
  if (/^['`][A-Za-z][A-Za-z0-9_@.+-]*['`]$/.test(source)) syntax.add(source)
  if (source === 'public' || (source.startsWith('{') && isTechnicalMessage(source)))
    syntax.add(source)
  return [...syntax].filter((token) => occurrences(localized, token, true).length === 0)
}

export function isTechnicalMessage(value: string, inputExample = false): boolean {
  if (technicalText(value, value).trim() === '') return value.length > 0
  if (inputExample && /^[a-z]+(?:-[a-z]+){2,}$/.test(value)) return true
  if (value === '</> HTML') return true
  if (!value.startsWith('{') || !value.endsWith('}')) return false
  try {
    const json: unknown = JSON.parse(value)
    const syntax = (item: unknown): boolean => {
      if (typeof item === 'string') return /^[A-Za-z0-9_/-]+$/.test(item) && /[0-9_/-]/.test(item)
      if (item === null || typeof item === 'number' || typeof item === 'boolean') return true
      if (Array.isArray(item)) return item.every(syntax)
      return (
        typeof item === 'object' &&
        Object.entries(item).every(([key, entry]) => /^[A-Za-z0-9_/-]+$/.test(key) && syntax(entry))
      )
    }
    return syntax(json)
  } catch {
    return false
  }
}
