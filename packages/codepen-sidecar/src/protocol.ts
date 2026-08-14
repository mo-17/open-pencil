import { Buffer } from 'node:buffer'

import {
  CODEPEN_SIDECAR_LIMITS,
  CODEPEN_SIDECAR_PROTOCOL_VERSION,
  type CodePenSidecarOptions,
  type CodePenSidecarTarget
} from '@open-pencil/compiler/codepen/sidecar-wire'

export {
  CODEPEN_SIDECAR_LIMITS,
  CODEPEN_SIDECAR_PROTOCOL_VERSION,
  type CodePenSidecarDiagnostic,
  type CodePenSidecarPrefillData,
  type CodePenSidecarResponse,
  type CodePenSidecarSuccessResult,
  type CodePenSidecarTarget
} from '@open-pencil/compiler/codepen/sidecar-wire'

const encoder = new TextEncoder()
const REQUEST_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const PACKAGE_NAME_RE = /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/

export interface CodePenSidecarFile {
  path: string
  content: string | Uint8Array
}

export interface CodePenSidecarRequest {
  version: typeof CODEPEN_SIDECAR_PROTOCOL_VERSION
  requestId: string
  target: CodePenSidecarTarget
  packageName: string
  files: readonly CodePenSidecarFile[]
  options: Readonly<CodePenSidecarOptions>
}

export class CodePenSidecarProtocolError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'CodePenSidecarProtocolError'
    this.code = code
  }
}

function byteLength(value: string): number {
  return encoder.encode(value).byteLength
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CodePenSidecarProtocolError('invalid-request', `${label} must be an object`)
  }
  return Object.fromEntries(Object.entries(value))
}

function assertExactKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>,
  label: string
): void {
  const unexpected = Object.keys(value).find((key) => !allowed.has(key))
  if (unexpected !== undefined) {
    throw new CodePenSidecarProtocolError(
      'invalid-request',
      `${label} contains an unsupported field`
    )
  }
}

function boundedString(
  value: unknown,
  label: string,
  maximumBytes: number,
  allowEmpty = false
): string {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) {
    throw new CodePenSidecarProtocolError('invalid-request', `${label} must be a string`)
  }
  if (byteLength(value) > maximumBytes) {
    throw new CodePenSidecarProtocolError('request-limit', `${label} exceeds its byte limit`)
  }
  return value
}

function optionalString(value: unknown, label: string, maximumBytes: number): string | undefined {
  if (value === undefined) return undefined
  return boundedString(value, label, maximumBytes, true)
}

function safePath(value: unknown): string {
  const path = boundedString(value, 'files[].path', CODEPEN_SIDECAR_LIMITS.maxPathBytes)
  if (path.startsWith('/') || path.includes('\\') || path.includes('\0')) {
    throw new CodePenSidecarProtocolError('unsafe-path', 'Source paths must be project-relative')
  }
  const segments = path.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new CodePenSidecarProtocolError('unsafe-path', 'Source paths must be normalized')
  }
  return path
}

function strictBase64(value: unknown): Uint8Array {
  const encoded = boundedString(
    value,
    'files[].content',
    Math.ceil((CODEPEN_SIDECAR_LIMITS.maxBinaryFileBytes * 4) / 3) + 4,
    true
  )
  if (
    encoded.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)
  ) {
    throw new CodePenSidecarProtocolError(
      'invalid-base64',
      'Binary source content is not canonical base64'
    )
  }
  const bytes = new Uint8Array(Buffer.from(encoded, 'base64'))
  if (
    bytes.byteLength > CODEPEN_SIDECAR_LIMITS.maxBinaryFileBytes ||
    Buffer.from(bytes).toString('base64') !== encoded
  ) {
    throw new CodePenSidecarProtocolError(
      'request-limit',
      'Binary source content exceeds its byte limit'
    )
  }
  return bytes
}

function parseFile(value: unknown): CodePenSidecarFile {
  const object = objectValue(value, 'files[]')
  assertExactKeys(object, new Set(['path', 'kind', 'content']), 'files[]')
  const path = safePath(object.path)
  if (object.kind === 'text') {
    return {
      path,
      content: boundedString(
        object.content,
        'files[].content',
        CODEPEN_SIDECAR_LIMITS.maxTextFileBytes,
        true
      )
    }
  }
  if (object.kind === 'base64') return { path, content: strictBase64(object.content) }
  throw new CodePenSidecarProtocolError('invalid-request', 'files[].kind must be text or base64')
}

function parseOptions(value: unknown): CodePenSidecarRequest['options'] {
  if (value === undefined) return Object.freeze({})
  const object = objectValue(value, 'options')
  assertExactKeys(object, new Set(['title', 'description', 'tags', 'private', 'layout']), 'options')
  const title = optionalString(object.title, 'options.title', 256)
  const description = optionalString(object.description, 'options.description', 4_096)
  let tags: string[] | undefined
  if (object.tags !== undefined) {
    if (!Array.isArray(object.tags) || object.tags.length > 5) {
      throw new CodePenSidecarProtocolError(
        'invalid-request',
        'options.tags must contain at most five strings'
      )
    }
    tags = object.tags.map((tag) => boundedString(tag, 'options.tags[]', 64, true))
  }
  if (object.private !== undefined && typeof object.private !== 'boolean') {
    throw new CodePenSidecarProtocolError('invalid-request', 'options.private must be boolean')
  }
  if (
    object.layout !== undefined &&
    object.layout !== 'left' &&
    object.layout !== 'top' &&
    object.layout !== 'right'
  ) {
    throw new CodePenSidecarProtocolError('invalid-request', 'options.layout is invalid')
  }
  return Object.freeze({
    ...(title === undefined ? {} : { title }),
    ...(description === undefined ? {} : { description }),
    ...(tags === undefined ? {} : { tags: Object.freeze(tags) }),
    ...(object.private === undefined ? {} : { private: object.private }),
    ...(object.layout === undefined ? {} : { layout: object.layout })
  })
}

function assertPackageFile(files: readonly CodePenSidecarFile[], expectedName: string): void {
  const file = files.find((candidate) => candidate.path === 'package.json')
  if (!file || typeof file.content !== 'string') {
    throw new CodePenSidecarProtocolError('package-mismatch', 'A text package.json is required')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(file.content)
  } catch {
    throw new CodePenSidecarProtocolError('package-mismatch', 'package.json is invalid')
  }
  const object = objectValue(parsed, 'package.json')
  if (object.name !== expectedName) {
    throw new CodePenSidecarProtocolError(
      'package-mismatch',
      'packageName does not match package.json'
    )
  }
}

export function parseCodePenSidecarRequest(input: string): CodePenSidecarRequest {
  if (byteLength(input) > CODEPEN_SIDECAR_LIMITS.maxStdinBytes) {
    throw new CodePenSidecarProtocolError('request-limit', 'Request exceeds the stdin byte limit')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(input)
  } catch {
    throw new CodePenSidecarProtocolError('invalid-json', 'Request is not valid JSON')
  }
  const object = objectValue(parsed, 'request')
  assertExactKeys(
    object,
    new Set(['version', 'requestId', 'target', 'packageName', 'files', 'options']),
    'request'
  )
  if (object.version !== CODEPEN_SIDECAR_PROTOCOL_VERSION) {
    throw new CodePenSidecarProtocolError('unsupported-version', 'Unsupported protocol version')
  }
  const requestId = boundedString(
    object.requestId,
    'requestId',
    CODEPEN_SIDECAR_LIMITS.maxRequestIdBytes
  )
  if (!REQUEST_ID_RE.test(requestId)) {
    throw new CodePenSidecarProtocolError('invalid-request', 'requestId has an invalid format')
  }
  if (object.target !== 'react' && object.target !== 'vue') {
    throw new CodePenSidecarProtocolError('invalid-request', 'target must be react or vue')
  }
  const packageName = boundedString(
    object.packageName,
    'packageName',
    CODEPEN_SIDECAR_LIMITS.maxPackageNameBytes
  )
  if (!PACKAGE_NAME_RE.test(packageName)) {
    throw new CodePenSidecarProtocolError('invalid-request', 'packageName has an invalid format')
  }
  if (!Array.isArray(object.files) || object.files.length > CODEPEN_SIDECAR_LIMITS.maxFiles) {
    throw new CodePenSidecarProtocolError('request-limit', 'files exceeds its entry limit')
  }
  const files = object.files.map(parseFile)
  let decodedBytes = 0
  for (const file of files) {
    decodedBytes +=
      typeof file.content === 'string' ? byteLength(file.content) : file.content.byteLength
    if (decodedBytes > CODEPEN_SIDECAR_LIMITS.maxStdinBytes) {
      throw new CodePenSidecarProtocolError(
        'request-limit',
        'Decoded source files exceed their aggregate byte limit'
      )
    }
  }
  const paths = new Set(files.map((file) => file.path))
  if (paths.size !== files.length) {
    throw new CodePenSidecarProtocolError('duplicate-path', 'Source paths must be unique')
  }
  assertPackageFile(files, packageName)
  return Object.freeze({
    version: CODEPEN_SIDECAR_PROTOCOL_VERSION,
    requestId,
    target: object.target,
    packageName,
    files: Object.freeze(files.map((file) => Object.freeze(file))),
    options: parseOptions(object.options)
  })
}

export function requestIdFromUntrustedJSON(input: string): string {
  try {
    const parsed = JSON.parse(input) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return 'invalid'
    const candidate = Reflect.get(parsed, 'requestId')
    return typeof candidate === 'string' && REQUEST_ID_RE.test(candidate) ? candidate : 'invalid'
  } catch {
    return 'invalid'
  }
}
