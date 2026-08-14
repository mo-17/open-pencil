export const CODEPEN_STATIC_EVIDENCE_FORMAT = 'openpencil.codepen-static-evidence' as const
export const CODEPEN_STATIC_EVIDENCE_SCHEMA_VERSION = 1 as const

export const CODEPEN_STATIC_EVIDENCE_LIMITS = Object.freeze({
  maxURLLength: 2_048,
  maxHTMLBytes: 1024 * 1024,
  maxCSSBytes: 1024 * 1024,
  maxJavaScriptBytes: 1024 * 1024,
  maxTotalSourceBytes: 3 * 1024 * 1024,
  maxResources: 256,
  maxResourceReferenceLength: 2_048,
  defaultTimeoutMs: 15_000,
  maxTimeoutMs: 60_000
})

/** This describes a future host renderer. It does not grant rendering authority. */
export const CODEPEN_ISOLATED_RENDERER_CONTRACT = Object.freeze({
  version: 1,
  processIsolation: 'required',
  mainWebViewAccess: 'forbidden',
  sourceJavaScript: 'disabled',
  inlineEventHandlers: 'disabled',
  networkAccess: 'disabled',
  persistentStorage: 'disabled',
  navigation: 'disabled',
  popups: 'disabled'
} as const)

export type CodePenSourceKind = 'html' | 'css' | 'js'
export type CodePenRiskSeverity = 'block' | 'warning' | 'info'
export type CodePenResourceScheme = 'https' | 'http' | 'data' | 'javascript' | 'other'
export type CodePenResourceKind =
  | 'image'
  | 'font'
  | 'stylesheet'
  | 'script'
  | 'media'
  | 'document'
  | 'other'

export interface CodePenReference {
  readonly provider: 'codepen'
  readonly owner: string
  readonly slug: string
  readonly url: string
  readonly sourceURLs: Readonly<Record<CodePenSourceKind, string>>
}

export interface CodePenSourceInput {
  readonly text: string
  readonly mediaType?: string
}

export interface CodePenStaticEvidenceInput {
  readonly penURL: string
  readonly sources: Readonly<Record<CodePenSourceKind, string | CodePenSourceInput>>
}

export interface CodePenSourceEvidence {
  readonly kind: CodePenSourceKind
  readonly url: string
  readonly mediaType: string
  readonly byteLength: number
  readonly digest: string
  readonly text: string
}

export interface CodePenResourceEvidence {
  /** Query values, fragments, credentials, and data payloads are never retained here. */
  readonly url: string
  readonly scheme: CodePenResourceScheme
  readonly kinds: readonly CodePenResourceKind[]
  readonly discoveredIn: readonly CodePenSourceKind[]
  readonly occurrences: number
  readonly external: boolean
  readonly hasQuery: boolean
  readonly hasFragment: boolean
  readonly credentialsRedacted: boolean
  readonly networkPolicy: 'not-fetched' | 'blocked'
}

export interface CodePenRiskEvidence {
  readonly code: string
  readonly severity: CodePenRiskSeverity
  readonly source: CodePenSourceKind | 'resources' | 'transport'
  readonly count: number
  readonly message: string
}

export interface CodePenStaticEvidencePayload {
  readonly format: typeof CODEPEN_STATIC_EVIDENCE_FORMAT
  readonly schemaVersion: typeof CODEPEN_STATIC_EVIDENCE_SCHEMA_VERSION
  readonly pen: CodePenReference
  readonly sources: Readonly<Record<CodePenSourceKind, CodePenSourceEvidence>>
  readonly resources: readonly CodePenResourceEvidence[]
  readonly risks: readonly CodePenRiskEvidence[]
  readonly summary: Readonly<{
    blockers: number
    warnings: number
    infos: number
    safeForStaticAIAnalysis: boolean
    safeToExecute: false
  }>
  readonly policy: Readonly<{
    analysis: 'static-advisory'
    aiInputTrust: 'untrusted-data'
    sourceInstructions: 'non-authoritative'
    sourceCodeExecution: 'blocked'
    externalResourceFetching: 'blocked'
    mainWebViewRendering: 'blocked'
    isolatedRendering: 'host-required'
  }>
}

export interface CodePenStaticEvidence {
  readonly payload: CodePenStaticEvidencePayload
  readonly integrity: Readonly<{
    algorithm: 'SHA-256'
    digest: string
  }>
}

export interface LoadCodePenStaticEvidenceOptions {
  /** Deliberately has no global-fetch fallback. The caller owns the network authority. */
  readonly fetchImpl?: typeof globalThis.fetch
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
}

/** JSON-safe result expected from the desktop's main-only CodePen fetch command. */
export interface CodePenFetchedSources {
  readonly canonicalUrl: string
  readonly html: string
  readonly css: string
  readonly js: string
  readonly sources: readonly Readonly<{
    kind: CodePenSourceKind
    url: string
    byteLength: number
    digest: string
    contentType: string
  }>[]
}

export interface CodePenIsolatedRenderViewport {
  readonly id: string
  readonly width: number
  readonly height: number
  readonly deviceScaleFactor: number
}

export interface CodePenIsolatedRenderRequest {
  readonly evidence: CodePenStaticEvidence
  readonly viewports: readonly CodePenIsolatedRenderViewport[]
  readonly contract: typeof CODEPEN_ISOLATED_RENDERER_CONTRACT
}

export interface CodePenIsolatedRenderCapture {
  readonly viewportId: string
  readonly mediaType: 'image/png'
  readonly byteLength: number
  readonly digest: string
  readonly bytes: Uint8Array
}

/**
 * Host implementations must live outside the editor WebView. Merely matching
 * this interface is not proof of isolation, so core supplies no implementation.
 */
export interface CodePenIsolatedRenderer {
  readonly runtime: 'host-isolated-codepen-renderer-v1'
  capture(request: CodePenIsolatedRenderRequest): Promise<readonly CodePenIsolatedRenderCapture[]>
}

export const CODEPEN_SOURCE_KINDS = Object.freeze(['html', 'css', 'js'] as const)

export const CODEPEN_EXPECTED_MEDIA_TYPES: Readonly<Record<CodePenSourceKind, readonly string[]>> =
  Object.freeze({
    html: Object.freeze(['text/html', 'text/plain']),
    css: Object.freeze(['text/css', 'text/plain']),
    js: Object.freeze([
      'text/javascript',
      'application/javascript',
      'application/x-javascript',
      'text/plain'
    ])
  })

export const CODEPEN_SOURCE_BYTE_LIMITS: Readonly<Record<CodePenSourceKind, number>> =
  Object.freeze({
    html: CODEPEN_STATIC_EVIDENCE_LIMITS.maxHTMLBytes,
    css: CODEPEN_STATIC_EVIDENCE_LIMITS.maxCSSBytes,
    js: CODEPEN_STATIC_EVIDENCE_LIMITS.maxJavaScriptBytes
  })

export function parseCodePenURL(value: string): CodePenReference {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError('CodePen URL must be a non-empty string')
  }
  if (value.length > CODEPEN_STATIC_EVIDENCE_LIMITS.maxURLLength) {
    throw new TypeError('CodePen URL exceeds the length limit')
  }
  if (value.trim() !== value) throw new TypeError('CodePen URL must not contain surrounding space')

  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new TypeError('CodePen URL must be an absolute URL')
  }
  if (parsed.protocol !== 'https:') throw new TypeError('CodePen URL must use HTTPS')
  if (parsed.hostname !== 'codepen.io' || parsed.port !== '') {
    throw new TypeError('CodePen URL must use the canonical codepen.io origin')
  }
  if (parsed.username || parsed.password) {
    throw new TypeError('CodePen URL must not contain credentials')
  }
  if (parsed.search || parsed.hash) {
    throw new TypeError('CodePen URL must not contain a query or fragment')
  }

  const match = /^\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})\/pen\/([A-Za-z0-9]{1,64})$/.exec(
    parsed.pathname
  )
  if (!match) throw new TypeError('CodePen URL must match https://codepen.io/OWNER/pen/SLUG')
  const [, owner, slug] = match
  const canonicalURL = `https://codepen.io/${owner}/pen/${slug}`
  if (value !== canonicalURL) {
    throw new TypeError('CodePen URL must use its canonical spelling')
  }
  return deepFreeze({
    provider: 'codepen',
    owner,
    slug,
    url: canonicalURL,
    sourceURLs: {
      html: `${canonicalURL}.html`,
      css: `${canonicalURL}.css`,
      js: `${canonicalURL}.js`
    }
  })
}

export function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (!value || typeof value !== 'object' || seen.has(value)) return value
  seen.add(value)
  for (const nested of Object.values(value)) deepFreeze(nested, seen)
  return Object.freeze(value)
}
