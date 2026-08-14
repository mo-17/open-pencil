import {
  abortable,
  createRequestClock,
  noCredentialGetRequest,
  readBoundedStream,
  strictContentLength,
  throwIfAborted
} from '@/app/network/safe-fetch'

import {
  CODEPEN_EXPECTED_MEDIA_TYPES,
  CODEPEN_SOURCE_BYTE_LIMITS,
  CODEPEN_SOURCE_KINDS,
  CODEPEN_STATIC_EVIDENCE_LIMITS,
  parseCodePenURL,
  type CodePenSourceInput,
  type CodePenSourceKind,
  type CodePenStaticEvidence,
  type LoadCodePenStaticEvidenceOptions
} from './contracts'
import { createCodePenStaticEvidence } from './evidence'

/**
 * Fetches only the three documented CodePen URL-extension endpoints. It has no
 * implicit fetch implementation, follows no redirects, sends no credentials,
 * rejects opaque/missing final URLs, and bounds the decoded response stream.
 */
export async function loadCodePenStaticEvidence(
  penURL: string,
  options: LoadCodePenStaticEvidenceOptions = {}
): Promise<CodePenStaticEvidence> {
  const pen = parseCodePenURL(penURL)
  if (typeof options.fetchImpl !== 'function') {
    throw new TypeError('A host-owned CodePen fetch implementation is required')
  }
  const clock = requestClock(options.signal, options.timeoutMs)
  try {
    const sources = {} as Record<CodePenSourceKind, CodePenSourceInput>
    for (const kind of CODEPEN_SOURCE_KINDS) {
      throwIfAborted(clock.signal)
      const requestedURL = pen.sourceURLs[kind]
      const response = await abortable(
        options.fetchImpl(requestedURL, sourceRequestInit(kind, clock.signal)),
        clock.signal
      )
      sources[kind] = await readSourceResponse(response, requestedURL, kind, clock.signal)
    }
    throwIfAborted(clock.signal)
    return await createCodePenStaticEvidence({ penURL: pen.url, sources })
  } finally {
    clock.dispose()
  }
}

async function readSourceResponse(
  response: Response,
  requestedURL: string,
  kind: CodePenSourceKind,
  signal: AbortSignal
): Promise<CodePenSourceInput> {
  try {
    throwIfAborted(signal)
    if (!response.url) throw new Error(`CodePen ${kind} response did not expose its final URL`)
    if (response.url !== requestedURL) {
      throw new Error(`CodePen ${kind} source redirects are not allowed`)
    }
    if (response.status !== 200) {
      throw new Error(`CodePen ${kind} source returned HTTP ${response.status}`)
    }
    const mediaType = normalizeMediaType(response.headers.get('content-type') ?? '')
    if (!CODEPEN_EXPECTED_MEDIA_TYPES[kind].includes(mediaType)) {
      throw new Error(`CodePen ${kind} source returned an unsupported media type`)
    }
    const bytes = await readBoundedResponseBody(
      response,
      CODEPEN_SOURCE_BYTE_LIMITS[kind],
      signal,
      `CodePen ${kind} source`
    )
    let text: string
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      throw new Error(`CodePen ${kind} source must contain valid UTF-8`)
    }
    return { text, mediaType }
  } catch (error) {
    if (response.body && !response.bodyUsed) {
      await response.body.cancel(error).catch(() => undefined)
    }
    throw error
  }
}

async function readBoundedResponseBody(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
  label: string
): Promise<Uint8Array> {
  const announced = strictContentLength(response.headers.get('content-length'), label)
  if (announced !== undefined && announced > maxBytes) {
    throw new Error(`${label} exceeds the ${maxBytes} byte limit`)
  }
  if (!response.body) throw new Error(`${label} response body is not stream-readable`)
  return readBoundedStream(response.body, maxBytes, signal, label)
}

function sourceRequestInit(kind: CodePenSourceKind, signal: AbortSignal): RequestInit {
  return noCredentialGetRequest([...CODEPEN_EXPECTED_MEDIA_TYPES[kind]].join(', '), signal)
}

function requestClock(callerSignal: AbortSignal | undefined, value: number | undefined) {
  const timeoutMs = value ?? CODEPEN_STATIC_EVIDENCE_LIMITS.defaultTimeoutMs
  return createRequestClock({
    callerSignal,
    timeoutMs,
    maximumTimeoutMs: CODEPEN_STATIC_EVIDENCE_LIMITS.maxTimeoutMs,
    label: 'CodePen'
  })
}

function normalizeMediaType(value: string): string {
  return value.split(';', 1)[0]?.trim().toLowerCase() ?? ''
}
