import { parsePreviewSidecarReady } from '../sidecar-ready'
import { parseCompilerPreviewPopoutControls, type CompilerPreviewPopoutControls } from './controls'

export const MAX_COMPILER_PREVIEW_POPOUT_PATH_BYTES = 2_048

const COMPILER_PREVIEW_PATH = /^\/[A-Za-z0-9/_.:*~-]*$/

export type CompilerPreviewPopoutRequest = Readonly<{
  url: string
  port: number
  path: string
  controls: CompilerPreviewPopoutControls
}>

const PREVIEW_POPOUT_REQUEST_KEYS = new Set<PropertyKey>(['url', 'port', 'path', 'controls'])

interface CompilerPreviewPopoutRequestCandidate {
  url?: unknown
  port?: unknown
  path?: unknown
  controls?: unknown
}

/**
 * Keep the path accepted by the webview identical to the native command's
 * narrow compiler-route grammar. It is a route, never an arbitrary URL.
 */
export function parseCompilerPreviewPopoutPath(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > MAX_COMPILER_PREVIEW_POPOUT_PATH_BYTES ||
    !COMPILER_PREVIEW_PATH.test(value) ||
    value.includes('//') ||
    value.split('/').some((segment) => segment === '.' || segment === '..')
  ) {
    throw new Error('Compiler preview path must be a canonical root-relative route')
  }
  return value
}

/** Revalidate the whole request at the JS/native trust boundary. */
export function parseCompilerPreviewPopoutRequest(value: unknown): CompilerPreviewPopoutRequest {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Compiler preview popout request must be an object')
  }
  if (
    Reflect.ownKeys(value).length !== PREVIEW_POPOUT_REQUEST_KEYS.size ||
    Reflect.ownKeys(value).some((key) => !PREVIEW_POPOUT_REQUEST_KEYS.has(key))
  ) {
    throw new Error('Compiler preview popout request contains invalid fields')
  }
  const source = value as CompilerPreviewPopoutRequestCandidate
  const ready = parsePreviewSidecarReady({
    type: 'ready',
    url: source.url,
    port: source.port
  })
  return Object.freeze({
    url: ready.url,
    port: ready.port,
    path: parseCompilerPreviewPopoutPath(source.path),
    controls: parseCompilerPreviewPopoutControls(source.controls)
  })
}
