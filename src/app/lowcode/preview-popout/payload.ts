import {
  parseCompilerPreviewPopoutRequest,
  type CompilerPreviewPopoutRequest
} from '../preview-pane/popout/url'

const PREVIEW_POPOUT_PAYLOAD_KEYS = new Set<PropertyKey>([
  'url',
  'port',
  'path',
  'controls',
  'revision'
])

interface CompilerPreviewPopoutPayloadCandidate {
  url?: unknown
  port?: unknown
  path?: unknown
  controls?: unknown
  revision?: unknown
}

export type CompilerPreviewPopoutPayload = CompilerPreviewPopoutRequest &
  Readonly<{ revision: number }>

/** Validate the native-to-wrapper payload again before touching the iframe. */
export function parseCompilerPreviewPopoutPayload(value: unknown): CompilerPreviewPopoutPayload {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Compiler preview popout payload must be an object')
  }
  const source = value as CompilerPreviewPopoutPayloadCandidate
  if (
    Reflect.ownKeys(value).some((key) => !PREVIEW_POPOUT_PAYLOAD_KEYS.has(key)) ||
    typeof source.url !== 'string' ||
    typeof source.port !== 'number' ||
    typeof source.path !== 'string' ||
    typeof source.revision !== 'number' ||
    !Number.isSafeInteger(source.revision) ||
    source.revision < 1
  ) {
    throw new Error('Compiler preview popout payload is invalid')
  }
  const request = parseCompilerPreviewPopoutRequest({
    url: source.url,
    port: source.port,
    path: source.path,
    controls: source.controls
  })
  return Object.freeze({ ...request, revision: source.revision })
}
