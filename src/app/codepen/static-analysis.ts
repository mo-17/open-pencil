import { containsCodePenSecret } from '@open-pencil/core/lowcode-validation'

import {
  CODEPEN_STATIC_EVIDENCE_LIMITS,
  deepFreeze,
  type CodePenReference,
  type CodePenResourceEvidence,
  type CodePenResourceKind,
  type CodePenResourceScheme,
  type CodePenRiskEvidence,
  type CodePenRiskSeverity,
  type CodePenSourceEvidence,
  type CodePenSourceKind
} from './contracts'

type MutableResource = {
  url: string
  scheme: CodePenResourceScheme
  kinds: Set<CodePenResourceKind>
  discoveredIn: Set<CodePenSourceKind>
  occurrences: number
  external: boolean
  hasQuery: boolean
  hasFragment: boolean
  credentialsRedacted: boolean
  networkPolicy: 'not-fetched' | 'blocked'
}

type RiskAccumulator = Map<string, CodePenRiskEvidence>

const SEVERITY_ORDER: Readonly<Record<CodePenRiskSeverity, number>> = Object.freeze({
  block: 0,
  warning: 1,
  info: 2
})
const SPECIAL_USE_SUFFIXES = new Set([
  'alt',
  'arpa',
  'example',
  'home',
  'internal',
  'invalid',
  'lan',
  'local',
  'localhost',
  'onion',
  'test'
])

const JAVASCRIPT_SCHEME = ['java', 'script:'].join('')

function capture(match: RegExpMatchArray, index: number): string | undefined {
  return (match as Array<string | undefined>)[index]
}

export function analyzeCodePenStaticSources(
  pen: CodePenReference,
  sources: Readonly<Record<CodePenSourceKind, CodePenSourceEvidence>>
): Readonly<{
  resources: readonly CodePenResourceEvidence[]
  risks: readonly CodePenRiskEvidence[]
}> {
  const risks: RiskAccumulator = new Map()
  analyzeActiveContent(sources, risks)
  const resources = collectResources(pen, sources, risks)
  if (resources.some((resource) => resource.networkPolicy === 'not-fetched')) {
    addRisk(
      risks,
      'external-resources-unverified',
      'warning',
      'resources',
      'External HTTPS resources are listed as evidence but were not downloaded or verified.'
    )
  }
  addRisk(
    risks,
    'static-analysis-is-advisory',
    'info',
    'transport',
    'Static pattern analysis cannot prove source code safe; execution remains blocked.'
  )
  return deepFreeze({ resources, risks: orderRisks(risks) })
}

function analyzeActiveContent(
  sources: Readonly<Record<CodePenSourceKind, CodePenSourceEvidence>>,
  risks: RiskAccumulator
): void {
  const html = sources.html.text
  const css = sources.css.text
  const js = sources.js.text
  if (js.trim()) {
    addRisk(
      risks,
      'javascript-source-present',
      'block',
      'js',
      'JavaScript source is retained as untrusted evidence and must never be executed by the analyzer.'
    )
  }
  addPatternRisk(
    risks,
    html,
    /<script\b/gi,
    'script-element-present',
    'block',
    'html',
    'HTML contains script elements; static analysis never executes them.'
  )
  addPatternRisk(
    risks,
    html,
    /\son[a-z][a-z0-9_-]*\s*=/gi,
    'inline-event-handler-present',
    'block',
    'html',
    'HTML contains inline event handlers; they require an isolated host review.'
  )
  addPatternRisk(
    risks,
    html,
    /<(?:iframe|object|embed|portal)\b/gi,
    'active-embed-present',
    'block',
    'html',
    'HTML contains an active embedded browsing or plugin context.'
  )
  addPatternRisk(
    risks,
    html,
    /<meta\b[^>]*http-equiv\s*=\s*["']?refresh\b/gi,
    'navigation-directive-present',
    'block',
    'html',
    'HTML contains a refresh/navigation directive.'
  )
  addPatternRisk(
    risks,
    html,
    /<form\b/gi,
    'form-submission-present',
    'warning',
    'html',
    'HTML contains forms; submission behavior is not imported or executed.'
  )
  addPatternRisk(
    risks,
    css,
    /@import\b/gi,
    'css-import-present',
    'warning',
    'css',
    'CSS contains imports; referenced stylesheets are not fetched during static analysis.'
  )
  addPatternRisk(
    risks,
    css,
    /(?:expression\s*\(|-moz-binding\s*:)/gi,
    'active-css-present',
    'block',
    'css',
    'CSS contains a legacy active-code construct.'
  )
  addPatternRisk(
    risks,
    js,
    /\b(?:eval\s*\(|new\s+Function\b|Function\s*\()/g,
    'dynamic-code-evaluation-present',
    'block',
    'js',
    'JavaScript contains dynamic code evaluation.'
  )
  addPatternRisk(
    risks,
    js,
    /\b(?:fetch\s*\(|XMLHttpRequest\b|WebSocket\b|EventSource\b|sendBeacon\s*\()/g,
    'network-api-present',
    'block',
    'js',
    'JavaScript contains a network API.'
  )
  addPatternRisk(
    risks,
    js,
    /\b(?:localStorage|sessionStorage|indexedDB|document\.cookie|serviceWorker)\b/g,
    'persistent-state-api-present',
    'warning',
    'js',
    'JavaScript references persistent browser state or service workers.'
  )
  addPatternRisk(
    risks,
    js,
    /\b(?:Worker\s*\(|SharedWorker\s*\(|window\.open\s*\(|postMessage\s*\()/g,
    'cross-context-api-present',
    'block',
    'js',
    'JavaScript references workers, popups, or cross-context messaging.'
  )
  if (containsCodePenSecret(`${html}\n${css}\n${js}`)) {
    addRisk(
      risks,
      'secret-like-material-present',
      'block',
      'transport',
      'Source contains secret-like material; no matching value is copied into the risk report.'
    )
  }
}

function collectResources(
  pen: CodePenReference,
  sources: Readonly<Record<CodePenSourceKind, CodePenSourceEvidence>>,
  risks: RiskAccumulator
): CodePenResourceEvidence[] {
  const resources = new Map<string, MutableResource>()
  const add = (raw: string, source: CodePenSourceKind, hintedKind: CodePenResourceKind) => {
    const value = raw.trim()
    if (!value || value.startsWith('#') || /^(?:\{\{|\$\{)/.test(value)) return
    if (value.length > CODEPEN_STATIC_EVIDENCE_LIMITS.maxResourceReferenceLength) {
      addRisk(
        risks,
        'resource-reference-too-long',
        'warning',
        source,
        'A resource reference exceeded the evidence length limit and was omitted.'
      )
      return
    }
    const normalized = normalizeResource(value, sources[source].url, pen)
    if (!normalized) return
    const classified = classifyResource(normalized.url)
    const kinds = [hintedKind, classified].filter(
      (kind, index, values): kind is CodePenResourceKind =>
        kind !== 'other' && values.indexOf(kind) === index
    )
    if (kinds.length === 0) kinds.push('other')
    const existing = resources.get(normalized.url)
    if (existing) {
      existing.occurrences += 1
      for (const kind of kinds) existing.kinds.add(kind)
      existing.discoveredIn.add(source)
      existing.hasQuery ||= normalized.hasQuery
      existing.hasFragment ||= normalized.hasFragment
      existing.credentialsRedacted ||= normalized.credentialsRedacted
      if (normalized.networkPolicy === 'blocked') existing.networkPolicy = 'blocked'
      return
    }
    if (resources.size >= CODEPEN_STATIC_EVIDENCE_LIMITS.maxResources) {
      addRisk(
        risks,
        'resource-list-truncated',
        'warning',
        'resources',
        `The resource list is limited to ${CODEPEN_STATIC_EVIDENCE_LIMITS.maxResources} entries.`
      )
      return
    }
    resources.set(normalized.url, {
      ...normalized,
      kinds: new Set(kinds),
      discoveredIn: new Set([source]),
      occurrences: 1
    })
  }

  for (const match of sources.html.text.matchAll(
    /\b(src|href|poster)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi
  )) {
    const attribute = match[1].toLowerCase()
    add(
      capture(match, 2) ?? capture(match, 3) ?? capture(match, 4) ?? '',
      'html',
      attribute === 'href' ? 'document' : 'image'
    )
  }
  for (const match of sources.html.text.matchAll(
    /<script\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi
  )) {
    add(capture(match, 1) ?? capture(match, 2) ?? capture(match, 3) ?? '', 'html', 'script')
  }
  for (const match of sources.html.text.matchAll(
    /\bsrcset\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi
  )) {
    const set = capture(match, 1) ?? capture(match, 2) ?? capture(match, 3) ?? ''
    if (set.trim().toLowerCase().startsWith('data:')) add(set, 'html', 'image')
    else {
      for (const candidate of set.split(',')) {
        add(candidate.trim().split(/\s+/, 1)[0] ?? '', 'html', 'image')
      }
    }
  }
  collectCSSResources(sources.html.text, 'html', add)
  collectCSSResources(sources.css.text, 'css', add)
  for (const match of sources.js.text.matchAll(/https?:\/\/[^\s"'`\\)\]}]+/g)) {
    add(match[0], 'js', 'other')
  }

  const result = [...resources.values()]
    .sort((left, right) => compareStrings(left.url, right.url))
    .map((resource): CodePenResourceEvidence => {
      inspectResourcePolicy(resource, risks)
      return deepFreeze({
        url: resource.url,
        scheme: resource.scheme,
        kinds: [...resource.kinds].sort(),
        discoveredIn: [...resource.discoveredIn].sort(),
        occurrences: resource.occurrences,
        external: resource.external,
        hasQuery: resource.hasQuery,
        hasFragment: resource.hasFragment,
        credentialsRedacted: resource.credentialsRedacted,
        networkPolicy: resource.networkPolicy
      })
    })
  return deepFreeze(result)
}

function collectCSSResources(
  text: string,
  source: CodePenSourceKind,
  add: (raw: string, source: CodePenSourceKind, kind: CodePenResourceKind) => void
): void {
  for (const match of text.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)'"}]+))\s*\)/gi)) {
    add(capture(match, 1) ?? capture(match, 2) ?? capture(match, 3) ?? '', source, 'other')
  }
  for (const match of text.matchAll(
    /@import\s+(?:url\(\s*)?(?:"([^"]*)"|'([^']*)'|([^\s;)'"}]+))/gi
  )) {
    add(capture(match, 1) ?? capture(match, 2) ?? capture(match, 3) ?? '', source, 'stylesheet')
  }
}

function normalizeResource(
  raw: string,
  baseURL: string,
  pen: CodePenReference
): Omit<MutableResource, 'kinds' | 'discoveredIn' | 'occurrences'> | null {
  let parsed: URL
  try {
    parsed = new URL(raw, baseURL)
  } catch {
    return null
  }
  const hasQuery = parsed.search.length > 0
  const hasFragment = parsed.hash.length > 0
  const credentialsRedacted = Boolean(parsed.username || parsed.password)
  let scheme: CodePenResourceScheme
  let networkPolicy: 'not-fetched' | 'blocked'
  let url: string

  if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
    scheme = parsed.protocol === 'https:' ? 'https' : 'http'
    parsed.username = ''
    parsed.password = ''
    parsed.search = ''
    parsed.hash = ''
    url = parsed.href
    networkPolicy =
      scheme === 'https' && !credentialsRedacted && isPublicNetworkHostname(parsed.hostname)
        ? 'not-fetched'
        : 'blocked'
  } else if (parsed.protocol === 'data:') {
    scheme = 'data'
    url = `data:${parsed.pathname.split(';', 1)[0] || 'application/octet-stream'};[payload-omitted]`
    networkPolicy = 'blocked'
  } else if (parsed.protocol === JAVASCRIPT_SCHEME) {
    scheme = 'javascript'
    url = `${scheme}:[payload-omitted]`
    networkPolicy = 'blocked'
  } else {
    scheme = 'other'
    url = `${parsed.protocol || 'unknown:'}[payload-omitted]`
    networkPolicy = 'blocked'
  }
  return {
    url,
    scheme,
    external:
      parsed.protocol === 'http:' || parsed.protocol === 'https:'
        ? parsed.origin !== new URL(pen.url).origin
        : true,
    hasQuery,
    hasFragment,
    credentialsRedacted,
    networkPolicy
  }
}

function inspectResourcePolicy(resource: MutableResource, risks: RiskAccumulator): void {
  if (resource.credentialsRedacted) {
    addRisk(
      risks,
      'resource-credentials-present',
      'block',
      'resources',
      'A resource URL contained credentials; they were removed from the evidence list.'
    )
  }
  if (resource.scheme === 'http') {
    addRisk(
      risks,
      'insecure-http-resource-present',
      'block',
      'resources',
      'An insecure HTTP resource was listed and will not be fetched.'
    )
  }
  if (resource.scheme !== 'https' && resource.scheme !== 'http') {
    addRisk(
      risks,
      'active-or-embedded-resource-present',
      'block',
      'resources',
      'A data, JavaScript, or unsupported resource scheme was listed without its payload.'
    )
  } else if (resource.networkPolicy === 'blocked') {
    addRisk(
      risks,
      'non-public-resource-host-present',
      'block',
      'resources',
      'A resource references an IP literal, loopback, special-use, or non-public hostname.'
    )
  }
  if (resource.kinds.has('script')) {
    addRisk(
      risks,
      'external-script-resource-present',
      'block',
      'resources',
      'An external script is listed as evidence and will not be fetched or executed.'
    )
  }
}

function classifyResource(url: string): CodePenResourceKind {
  let pathname: string
  try {
    pathname = new URL(url).pathname.toLowerCase()
  } catch {
    pathname = url.toLowerCase()
  }
  if (/\.(?:png|jpe?g|gif|webp|avif|svg|ico)$/.test(pathname)) return 'image'
  if (/\.(?:woff2?|ttf|otf|eot)$/.test(pathname)) return 'font'
  if (pathname.endsWith('.css')) return 'stylesheet'
  if (/\.(?:m?js|cjs)$/.test(pathname)) return 'script'
  if (/\.(?:mp4|webm|mp3|wav|ogg)$/.test(pathname)) return 'media'
  if (/\.(?:html?|pdf)$/.test(pathname)) return 'document'
  return 'other'
}

function isPublicNetworkHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  if (
    normalized.endsWith('.') ||
    normalized.includes(':') ||
    normalized.startsWith('[') ||
    normalized.endsWith(']')
  ) {
    return false
  }
  const labels = normalized.split('.')
  if (labels.length === 4 && labels.every((part) => /^\d{1,3}$/.test(part))) return false
  if (labels.length < 2 || labels.some((label) => !/^[a-z0-9-]+$/.test(label))) return false
  if (labels.some((label) => !label || label.startsWith('-') || label.endsWith('-'))) return false
  if (labels.some((label) => label.startsWith('xn--'))) return false
  const suffix = labels.at(-1)
  return Boolean(suffix && !SPECIAL_USE_SUFFIXES.has(suffix) && !/^\d+$/.test(suffix))
}

function addPatternRisk(
  risks: RiskAccumulator,
  text: string,
  pattern: RegExp,
  code: string,
  severity: CodePenRiskSeverity,
  source: CodePenRiskEvidence['source'],
  message: string
): void {
  let count = 0
  for (const _match of text.matchAll(pattern)) count += 1
  if (count > 0) addRisk(risks, code, severity, source, message, count)
}

function addRisk(
  risks: RiskAccumulator,
  code: string,
  severity: CodePenRiskSeverity,
  source: CodePenRiskEvidence['source'],
  message: string,
  count = 1
): void {
  const key = `${severity}:${source}:${code}`
  const current = risks.get(key)
  risks.set(key, { code, severity, source, count: (current?.count ?? 0) + count, message })
}

function orderRisks(risks: RiskAccumulator): CodePenRiskEvidence[] {
  return [...risks.values()].sort(
    (left, right) =>
      SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity] ||
      compareStrings(left.code, right.code) ||
      compareStrings(left.source, right.source)
  )
}

function compareStrings(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}
