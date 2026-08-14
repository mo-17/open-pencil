import { encodeBase64 } from '@open-pencil/core/bytes'

import type { PreviewFiles } from '../vfs'

export const CODEPEN_SIDECAR_PROTOCOL_VERSION = 1 as const

export const CODEPEN_SIDECAR_LIMITS = Object.freeze({
  maxStdinBytes: 64 * 1024 * 1024,
  maxFiles: 10_000,
  maxPathBytes: 512,
  maxTextFileBytes: 8 * 1024 * 1024,
  maxBinaryFileBytes: 16 * 1024 * 1024,
  maxOutputBytes: 4 * 1024 * 1024,
  maxRequestIdBytes: 128,
  maxPackageNameBytes: 214,
  maxDiagnostics: 256
})

export type CodePenSidecarTarget = 'react' | 'vue'

export interface CodePenSidecarDiagnostic {
  code: string
  severity: 'error' | 'warning'
  message: string
  path?: string
}

export interface CodePenSidecarOptions {
  title?: string
  description?: string
  tags?: readonly string[]
  private?: boolean
  layout?: 'left' | 'top' | 'right'
}

export interface CodePenSidecarRequestInput {
  requestId: string
  target: CodePenSidecarTarget
  packageName: string
  files: PreviewFiles
  options?: CodePenSidecarOptions
}

export interface CodePenSidecarSuccessResult {
  target: CodePenSidecarTarget
  packageName: string
  data: CodePenSidecarPrefillData
  diagnostics: readonly CodePenSidecarDiagnostic[]
  compatible: true
}

export interface CodePenSidecarPrefillData {
  title?: string
  description?: string
  tags?: readonly string[]
  private?: boolean
  layout?: 'left' | 'top' | 'right'
  html: string
  html_pre_processor: 'none'
  css: string
  css_pre_processor: 'none'
  js: string
  js_pre_processor: 'none'
}

export type CodePenSidecarResponse =
  | Readonly<{
      version: typeof CODEPEN_SIDECAR_PROTOCOL_VERSION
      requestId: string
      ok: true
      result: CodePenSidecarSuccessResult
    }>
  | Readonly<{
      version: typeof CODEPEN_SIDECAR_PROTOCOL_VERSION
      requestId: string
      ok: false
      error: Readonly<{
        code: string
        message: string
        diagnostics?: readonly CodePenSidecarDiagnostic[]
      }>
    }>

const REQUEST_KEYS = new Set(['version', 'requestId', 'target', 'packageName', 'files', 'options'])
const FILE_KEYS = new Set(['path', 'kind', 'content'])
const OPTIONS_KEYS = new Set(['title', 'description', 'tags', 'private', 'layout'])
const RESPONSE_KEYS = new Set(['version', 'requestId', 'ok', 'result', 'error'])
const RESULT_KEYS = new Set(['target', 'packageName', 'data', 'diagnostics', 'compatible'])
const DATA_KEYS = new Set([
  'title',
  'description',
  'tags',
  'private',
  'layout',
  'html',
  'html_pre_processor',
  'css',
  'css_pre_processor',
  'js',
  'js_pre_processor'
])
const ERROR_KEYS = new Set(['code', 'message', 'diagnostics'])
const DIAGNOSTIC_KEYS = new Set(['code', 'severity', 'message', 'path'])
const REQUEST_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const PACKAGE_NAME_RE = /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`)
  }
  return Object.fromEntries(Object.entries(value))
}

function assertExactKeys(value: object, allowed: ReadonlySet<string>, label: string): void {
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new TypeError(`${label} contains an unsupported field`)
  }
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`)
  return value
}

function boundedString(value: unknown, label: string, maximumBytes: number): string {
  const string = stringValue(value, label)
  if (byteLength(string) > maximumBytes) throw new RangeError(`${label} exceeds its byte limit`)
  return string
}

function parseDiagnostic(value: unknown): CodePenSidecarDiagnostic {
  const object = objectValue(value, 'diagnostic')
  assertExactKeys(object, DIAGNOSTIC_KEYS, 'diagnostic')
  if (object.severity !== 'error' && object.severity !== 'warning') {
    throw new TypeError('diagnostic.severity is invalid')
  }
  if (object.path !== undefined && typeof object.path !== 'string') {
    throw new TypeError('diagnostic.path must be a string')
  }
  return Object.freeze({
    code: boundedString(object.code, 'diagnostic.code', 128),
    severity: object.severity,
    message: boundedString(object.message, 'diagnostic.message', 4_096),
    ...(object.path === undefined
      ? {}
      : {
          path: boundedString(object.path, 'diagnostic.path', CODEPEN_SIDECAR_LIMITS.maxPathBytes)
        })
  })
}

function parseDiagnostics(value: unknown): readonly CodePenSidecarDiagnostic[] {
  if (!Array.isArray(value) || value.length > CODEPEN_SIDECAR_LIMITS.maxDiagnostics) {
    throw new TypeError('diagnostics is invalid')
  }
  return Object.freeze(value.map(parseDiagnostic))
}

function parsePrefillData(value: unknown): CodePenSidecarPrefillData {
  const object = objectValue(value, 'response.result.data')
  assertExactKeys(object, DATA_KEYS, 'response.result.data')
  if (
    object.html_pre_processor !== 'none' ||
    object.css_pre_processor !== 'none' ||
    object.js_pre_processor !== 'none'
  ) {
    throw new TypeError('response.result.data preprocessor is invalid')
  }
  if (object.private !== undefined && typeof object.private !== 'boolean') {
    throw new TypeError('response.result.data.private is invalid')
  }
  if (
    object.layout !== undefined &&
    object.layout !== 'left' &&
    object.layout !== 'top' &&
    object.layout !== 'right'
  ) {
    throw new TypeError('response.result.data.layout is invalid')
  }
  const tags = object.tags
  if (
    tags !== undefined &&
    (!Array.isArray(tags) || tags.length > 5 || !tags.every((tag) => typeof tag === 'string'))
  ) {
    throw new TypeError('response.result.data.tags is invalid')
  }
  return Object.freeze({
    ...(object.title === undefined
      ? {}
      : { title: boundedString(object.title, 'response.result.data.title', 256) }),
    ...(object.description === undefined
      ? {}
      : {
          description: boundedString(object.description, 'response.result.data.description', 4_096)
        }),
    ...(tags === undefined
      ? {}
      : {
          tags: Object.freeze(
            tags.map((tag) => boundedString(tag, 'response.result.data.tags', 64))
          )
        }),
    ...(object.private === undefined ? {} : { private: object.private }),
    ...(object.layout === undefined ? {} : { layout: object.layout }),
    html: boundedString(object.html, 'response.result.data.html', 1_000_000),
    html_pre_processor: 'none',
    css: boundedString(object.css, 'response.result.data.css', 1_000_000),
    css_pre_processor: 'none',
    js: boundedString(object.js, 'response.result.data.js', 1_000_000),
    js_pre_processor: 'none'
  })
}

export function serializeCodePenSidecarRequest(input: CodePenSidecarRequestInput): string {
  const files = [...input.files]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, content]) =>
      typeof content === 'string'
        ? { path, kind: 'text' as const, content }
        : { path, kind: 'base64' as const, content: encodeBase64(content) }
    )
  const request = {
    version: CODEPEN_SIDECAR_PROTOCOL_VERSION,
    requestId: input.requestId,
    target: input.target,
    packageName: input.packageName,
    files,
    options: input.options ?? {}
  }
  assertExactKeys(request, REQUEST_KEYS, 'request')
  for (const file of files) assertExactKeys(file, FILE_KEYS, 'file')
  assertExactKeys(request.options, OPTIONS_KEYS, 'options')
  const serialized = JSON.stringify(request)
  if (new TextEncoder().encode(serialized).byteLength > CODEPEN_SIDECAR_LIMITS.maxStdinBytes) {
    throw new RangeError('CodePen sidecar request exceeds its byte limit')
  }
  return serialized
}

export function parseCodePenSidecarResponse(
  input: string,
  expected?:
    | string
    | Readonly<{
        requestId: string
        target: CodePenSidecarTarget
        packageName: string
      }>
): CodePenSidecarResponse {
  if (new TextEncoder().encode(input).byteLength > CODEPEN_SIDECAR_LIMITS.maxOutputBytes) {
    throw new RangeError('CodePen sidecar response exceeds its byte limit')
  }
  const object = objectValue(JSON.parse(input) as unknown, 'response')
  assertExactKeys(object, RESPONSE_KEYS, 'response')
  if (object.version !== CODEPEN_SIDECAR_PROTOCOL_VERSION) {
    throw new TypeError('CodePen sidecar response version is unsupported')
  }
  const requestId = boundedString(
    object.requestId,
    'response.requestId',
    CODEPEN_SIDECAR_LIMITS.maxRequestIdBytes
  )
  if (!REQUEST_ID_RE.test(requestId))
    throw new TypeError('response.requestId has an invalid format')
  const expectedRequestId = typeof expected === 'string' ? expected : expected?.requestId
  if (expectedRequestId !== undefined && requestId !== expectedRequestId) {
    throw new TypeError('CodePen sidecar response requestId does not match')
  }
  if (object.ok === true) {
    if (object.error !== undefined) throw new TypeError('Successful response contains error')
    const result = objectValue(object.result, 'response.result')
    assertExactKeys(result, RESULT_KEYS, 'response.result')
    if (result.target !== 'react' && result.target !== 'vue') {
      throw new TypeError('response.result.target is invalid')
    }
    if (result.compatible !== true) throw new TypeError('response.result.compatible must be true')
    const resultPackageName = boundedString(
      result.packageName,
      'response.result.packageName',
      CODEPEN_SIDECAR_LIMITS.maxPackageNameBytes
    )
    if (!PACKAGE_NAME_RE.test(resultPackageName)) {
      throw new TypeError('response.result.packageName has an invalid format')
    }
    if (
      typeof expected === 'object' &&
      (result.target !== expected.target || resultPackageName !== expected.packageName)
    ) {
      throw new TypeError('CodePen sidecar response project identity does not match')
    }
    return Object.freeze({
      version: CODEPEN_SIDECAR_PROTOCOL_VERSION,
      requestId,
      ok: true,
      result: Object.freeze({
        target: result.target,
        packageName: resultPackageName,
        data: parsePrefillData(result.data),
        diagnostics: parseDiagnostics(result.diagnostics),
        compatible: true
      })
    })
  }
  if (object.ok !== false || object.result !== undefined) {
    throw new TypeError('CodePen sidecar response discriminator is invalid')
  }
  const error = objectValue(object.error, 'response.error')
  assertExactKeys(error, ERROR_KEYS, 'response.error')
  return Object.freeze({
    version: CODEPEN_SIDECAR_PROTOCOL_VERSION,
    requestId,
    ok: false,
    error: Object.freeze({
      code: boundedString(error.code, 'response.error.code', 128),
      message: boundedString(error.message, 'response.error.message', 4_096),
      ...(error.diagnostics === undefined
        ? {}
        : { diagnostics: parseDiagnostics(error.diagnostics) })
    })
  })
}
