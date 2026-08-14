import {
  canonicalManifestValue,
  digestCanonicalManifest,
  encodeBase64URL,
  parseSha256Base64URL,
  requireExactJSONObject,
  webCryptoBuffer
} from '@open-pencil/scene-graph'

import {
  CODEPEN_EXPECTED_MEDIA_TYPES,
  CODEPEN_SOURCE_BYTE_LIMITS,
  CODEPEN_SOURCE_KINDS,
  CODEPEN_STATIC_EVIDENCE_FORMAT,
  CODEPEN_STATIC_EVIDENCE_LIMITS,
  CODEPEN_STATIC_EVIDENCE_SCHEMA_VERSION,
  deepFreeze,
  parseCodePenURL,
  type CodePenFetchedSources,
  type CodePenSourceEvidence,
  type CodePenSourceInput,
  type CodePenSourceKind,
  type CodePenStaticEvidence,
  type CodePenStaticEvidenceInput,
  type CodePenStaticEvidencePayload
} from './contracts'
import { analyzeCodePenStaticSources } from './static-analysis'

const DEFAULT_MEDIA_TYPES: Readonly<Record<CodePenSourceKind, string>> = Object.freeze({
  html: 'text/html',
  css: 'text/css',
  js: 'text/javascript'
})

export async function createCodePenStaticEvidence(
  input: CodePenStaticEvidenceInput
): Promise<CodePenStaticEvidence> {
  const pen = parseCodePenURL(input.penURL)
  const sourceCandidate: unknown = input.sources
  if (!sourceCandidate || typeof sourceCandidate !== 'object') {
    throw new TypeError('CodePen sources must be an object')
  }

  let totalBytes = 0
  const sources = {} as Record<CodePenSourceKind, CodePenSourceEvidence>
  for (const kind of CODEPEN_SOURCE_KINDS) {
    const normalized = normalizeSourceInput(input.sources[kind], kind)
    const bytes = new TextEncoder().encode(normalized.text)
    if (bytes.byteLength > CODEPEN_SOURCE_BYTE_LIMITS[kind]) {
      throw new Error(
        `CodePen ${kind} source exceeds the ${CODEPEN_SOURCE_BYTE_LIMITS[kind]} byte limit`
      )
    }
    totalBytes += bytes.byteLength
    if (totalBytes > CODEPEN_STATIC_EVIDENCE_LIMITS.maxTotalSourceBytes) {
      throw new Error(
        `CodePen sources exceed the ${CODEPEN_STATIC_EVIDENCE_LIMITS.maxTotalSourceBytes} total byte limit`
      )
    }
    sources[kind] = {
      kind,
      url: pen.sourceURLs[kind],
      mediaType: normalized.mediaType,
      byteLength: bytes.byteLength,
      digest: await sha256(bytes),
      text: normalized.text
    }
  }

  const analysis = analyzeCodePenStaticSources(pen, sources)
  const payload: CodePenStaticEvidencePayload = deepFreeze({
    format: CODEPEN_STATIC_EVIDENCE_FORMAT,
    schemaVersion: CODEPEN_STATIC_EVIDENCE_SCHEMA_VERSION,
    pen,
    sources,
    resources: analysis.resources,
    risks: analysis.risks,
    summary: {
      blockers: analysis.risks.filter((risk) => risk.severity === 'block').length,
      warnings: analysis.risks.filter((risk) => risk.severity === 'warning').length,
      infos: analysis.risks.filter((risk) => risk.severity === 'info').length,
      safeForStaticAIAnalysis: !analysis.risks.some(
        (risk) => risk.code === 'secret-like-material-present'
      ),
      safeToExecute: false
    },
    policy: {
      analysis: 'static-advisory',
      aiInputTrust: 'untrusted-data',
      sourceInstructions: 'non-authoritative',
      sourceCodeExecution: 'blocked',
      externalResourceFetching: 'blocked',
      mainWebViewRendering: 'blocked',
      isolatedRendering: 'host-required'
    }
  })
  return deepFreeze({
    payload,
    integrity: {
      algorithm: 'SHA-256',
      digest: await digestCanonicalManifest(payload)
    }
  })
}

/**
 * Validate the desktop main-only fetch result before promoting it into
 * immutable evidence. Bytes, metadata, endpoint URLs, and digests must agree.
 */
export async function createCodePenStaticEvidenceFromFetchedSources(
  value: unknown
): Promise<CodePenStaticEvidence> {
  if (!isPlainRecord(value)) throw new TypeError('Fetched CodePen sources must be an object')
  requireExactJSONObject(
    value,
    ['canonicalUrl', 'html', 'css', 'js', 'sources'],
    'Fetched CodePen sources'
  )
  if (typeof value.canonicalUrl !== 'string') {
    throw new TypeError('Fetched CodePen canonicalUrl must be text')
  }
  const pen = parseCodePenURL(value.canonicalUrl)
  if (!Array.isArray(value.sources) || value.sources.length !== CODEPEN_SOURCE_KINDS.length) {
    throw new TypeError('Fetched CodePen metadata must contain exactly html, css, and js')
  }

  const metadata = new Map<CodePenSourceKind, CodePenFetchedSources['sources'][number]>()
  for (const [index, entry] of value.sources.entries()) {
    if (!isPlainRecord(entry)) {
      throw new TypeError(`Fetched CodePen metadata[${index}] must be an object`)
    }
    requireExactJSONObject(
      entry,
      ['kind', 'url', 'byteLength', 'digest', 'contentType'],
      `Fetched CodePen metadata[${index}]`
    )
    if (!CODEPEN_SOURCE_KINDS.includes(entry.kind as CodePenSourceKind)) {
      throw new TypeError(`Fetched CodePen metadata[${index}].kind is not supported`)
    }
    const kind = entry.kind as CodePenSourceKind
    if (metadata.has(kind)) {
      throw new TypeError(`Fetched CodePen metadata contains duplicate ${kind}`)
    }
    if (
      typeof entry.url !== 'string' ||
      typeof entry.byteLength !== 'number' ||
      typeof entry.digest !== 'string' ||
      typeof entry.contentType !== 'string'
    ) {
      throw new TypeError(`Fetched CodePen metadata[${index}] fields have invalid types`)
    }
    metadata.set(kind, entry as CodePenFetchedSources['sources'][number])
  }

  const sources = {} as Record<CodePenSourceKind, CodePenSourceInput>
  for (const kind of CODEPEN_SOURCE_KINDS) {
    const entry = metadata.get(kind)
    if (!entry) throw new TypeError(`Fetched CodePen metadata is missing ${kind}`)
    if (entry.url !== pen.sourceURLs[kind]) {
      throw new Error(`Fetched CodePen ${kind} final URL does not match the canonical endpoint`)
    }
    const text = value[kind]
    if (typeof text !== 'string') throw new TypeError(`Fetched CodePen ${kind} must be text`)
    const bytes = new TextEncoder().encode(text)
    if (!Number.isSafeInteger(entry.byteLength) || entry.byteLength !== bytes.byteLength) {
      throw new Error(`Fetched CodePen ${kind} byte length does not match its metadata`)
    }
    const expectedDigest = parseSha256Base64URL(entry.digest, `Fetched CodePen ${kind} digest`)
    if ((await sha256(bytes)) !== expectedDigest) {
      throw new Error(`Fetched CodePen ${kind} SHA-256 digest does not match its metadata`)
    }
    sources[kind] = { text, mediaType: entry.contentType }
  }
  return createCodePenStaticEvidence({ penURL: pen.url, sources })
}

export async function verifyCodePenStaticEvidenceIntegrity(
  evidence: CodePenStaticEvidence
): Promise<string> {
  const candidate: unknown = evidence
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new TypeError('CodePen evidence must be an object')
  }
  const keys = Object.keys(evidence)
  if (keys.length !== 2 || !keys.includes('payload') || !keys.includes('integrity')) {
    throw new TypeError('CodePen evidence must contain exactly payload and integrity')
  }
  const payload: unknown = evidence.payload
  if (!isPlainRecord(payload)) {
    throw new TypeError('CodePen evidence payload must be an object')
  }
  if (
    payload.format !== CODEPEN_STATIC_EVIDENCE_FORMAT ||
    payload.schemaVersion !== CODEPEN_STATIC_EVIDENCE_SCHEMA_VERSION
  ) {
    throw new TypeError('CodePen evidence format or schema version is not supported')
  }
  const integrity: unknown = evidence.integrity
  if (!isPlainRecord(integrity)) {
    throw new TypeError('CodePen evidence integrity must be an object')
  }
  if (integrity.algorithm !== 'SHA-256') {
    throw new TypeError('CodePen evidence integrity algorithm must be SHA-256')
  }
  const expected = parseSha256Base64URL(
    evidence.integrity.digest,
    'CodePen evidence integrity digest'
  )
  const actual = await digestCanonicalManifest(evidence.payload)
  if (actual !== expected) throw new Error('CodePen evidence SHA-256 digest mismatch')
  return actual
}

export function serializeCodePenStaticEvidence(evidence: CodePenStaticEvidence): string {
  return `${JSON.stringify(canonicalManifestValue(evidence), null, 2)}\n`
}

function normalizeSourceInput(
  value: string | CodePenSourceInput,
  kind: CodePenSourceKind
): Required<CodePenSourceInput> {
  const candidate: unknown = typeof value === 'string' ? { text: value } : value
  if (!isPlainRecord(candidate)) {
    throw new TypeError(`CodePen ${kind} source must be text`)
  }
  const source = candidate
  if (typeof source.text !== 'string') throw new TypeError(`CodePen ${kind} source must be text`)
  if (source.mediaType !== undefined && typeof source.mediaType !== 'string') {
    throw new TypeError(`CodePen ${kind} source media type must be text`)
  }
  const mediaType = normalizeMediaType(
    typeof source.mediaType === 'string' ? source.mediaType : DEFAULT_MEDIA_TYPES[kind]
  )
  if (!CODEPEN_EXPECTED_MEDIA_TYPES[kind].includes(mediaType)) {
    throw new TypeError(`CodePen ${kind} source media type is not supported`)
  }
  return { text: source.text, mediaType }
}

function normalizeMediaType(value: string): string {
  return value.split(';', 1)[0]?.trim().toLowerCase() ?? ''
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', webCryptoBuffer(bytes))
  return encodeBase64URL(new Uint8Array(digest))
}
