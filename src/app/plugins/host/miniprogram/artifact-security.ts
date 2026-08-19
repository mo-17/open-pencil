import { isReviewedMiniProgramRasterAsset, type CompileWarning } from '@open-pencil/compiler'
import { findCodePenSecretKinds } from '@open-pencil/lowcode'

export type MiniProgramArtifactSecurityCode =
  | 'secret-detected'
  | 'remote-url-detected'
  | 'absolute-local-path-detected'
  | 'dynamic-code-detected'
  | 'unreviewed-binary-artifact'
  | 'unsafe-file-path'

export type MiniProgramArtifactSecuritySource =
  | 'file-path'
  | 'text-content'
  | 'binary-metadata'
  | 'compiler-warning'
  | 'worker-error'

export interface MiniProgramArtifactSecurityDiagnostic {
  code: MiniProgramArtifactSecurityCode
  entryIndex: number
  source: MiniProgramArtifactSecuritySource
}

interface MiniProgramCompilerArtifact {
  files: ReadonlyMap<string, string | Uint8Array>
  warnings: readonly CompileWarning[]
}

const BINARY_METADATA_DECODER = new TextDecoder('latin1')
const CONTROL_CHARACTER = /[\p{Cc}\p{Cf}]/u
const WINDOWS_ABSOLUTE_PATH = /(?:^|[\s"'`(=:[,])(?:[A-Za-z]:[\\/]|\\\\[^\\/\s]+[\\/][^\\/\s]+)/imu
const HOME_RELATIVE_PATH = /(?:^|[\s"'`(=:[,])~[\\/][^\s"'`]+/imu
const FILE_URL = /\bfile:(?:\/\/)?[^\s"'`<>]+/iu
const POSIX_LOCAL_PATH =
  /(?:^|[\s"'`(=:[,])\/(?:Users|home|root|private|tmp|Volumes|Applications|opt|etc|var\/folders|usr\/local)(?:\/|$)[^\s"'`<>]*/imu
const LOCAL_PATH_ENVIRONMENT =
  /(?:\$(?:\{)?(?:HOME|USERPROFILE|HOMEDRIVE|HOMEPATH|PWD)(?:\})?[\\/]|%(?:USERPROFILE|HOMEDRIVE|HOMEPATH|CD)%[\\/])/iu
const REMOTE_URL = /\b(?:https?|wss?|ftp):\/\/[^\s"'`<>]+/iu
const PROTOCOL_RELATIVE_REMOTE_URL =
  /(?:^|[\s"'`(=:[,])\/\/(?:(?:localhost)|(?:\d{1,3}\.){3}\d{1,3}|(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})(?::\d+)?(?:[/?#]|$)/imu
const GENERIC_PROVIDER_TOKEN =
  /\b(?:AIza[0-9A-Za-z_-]{35}|npm_[A-Za-z0-9]{36}|glpat-[A-Za-z0-9_-]{20,}|hf_[A-Za-z0-9]{20,}|ya29\.[A-Za-z0-9_-]{20,}|pk_(?:live|test)_[A-Za-z0-9]{12,}|sb_(?:secret|publishable)_[A-Za-z0-9_-]{8,})\b/u
const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/iu
const JWT_TOKEN = /\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u

const DYNAMIC_CODE_PATTERNS: readonly RegExp[] = Object.freeze([
  /\bimport\s*\(/u,
  /\bimportScripts\s*\(/u,
  /\beval\s*\(/u,
  /\bnew\s+Function\s*\(/u,
  /\bnew\s+(?:Shared)?Worker\s*\(/u,
  /\bserviceWorker\s*\.\s*register\s*\(/u,
  /\b(?:instantiateStreaming|compileStreaming)\s*\(/u,
  /<\s*script\b[^>]*\bsrc\s*=/iu,
  /\bscript\s*\.\s*src\s*=/iu,
  /\b(?:javascript|blob):/iu,
  /\bdata:(?:text\/(?:html|javascript)|application\/(?:javascript|wasm))/iu
])

const MESSAGE_BY_CODE: Readonly<Record<MiniProgramArtifactSecurityCode, string>> = Object.freeze({
  'secret-detected': 'a credential or secret',
  'remote-url-detected': 'a remote network URL',
  'absolute-local-path-detected': 'an absolute local filesystem path',
  'dynamic-code-detected': 'a dynamic code-loading construct',
  'unreviewed-binary-artifact': 'an unreviewed or malformed binary artifact',
  'unsafe-file-path': 'an unsafe archive file path'
})

const SOURCE_LABEL: Readonly<Record<MiniProgramArtifactSecuritySource, string>> = Object.freeze({
  'file-path': 'file path',
  'text-content': 'text file',
  'binary-metadata': 'binary file metadata',
  'compiler-warning': 'compiler warning',
  'worker-error': 'Worker diagnostic'
})

function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function diagnosticMessage(diagnostic: MiniProgramArtifactSecurityDiagnostic): string {
  return `Mini-program source export blocked: ${MESSAGE_BY_CODE[diagnostic.code]} was detected in ${SOURCE_LABEL[diagnostic.source]} #${diagnostic.entryIndex + 1}.`
}

export class MiniProgramArtifactSecurityError extends Error {
  readonly code = 'MINIPROGRAM_ARTIFACT_SECURITY' as const
  readonly diagnostic: Readonly<MiniProgramArtifactSecurityDiagnostic>

  constructor(diagnostic: MiniProgramArtifactSecurityDiagnostic) {
    super(diagnosticMessage(diagnostic))
    this.name = 'MiniProgramArtifactSecurityError'
    this.diagnostic = Object.freeze({ ...diagnostic })
  }
}

function reject(
  code: MiniProgramArtifactSecurityCode,
  source: MiniProgramArtifactSecuritySource,
  entryIndex: number
): never {
  throw new MiniProgramArtifactSecurityError({ code, entryIndex, source })
}

function secretDetected(value: string): boolean {
  return (
    findCodePenSecretKinds(value).length > 0 ||
    GENERIC_PROVIDER_TOKEN.test(value) ||
    BEARER_TOKEN.test(value) ||
    JWT_TOKEN.test(value)
  )
}

function localPathDetected(value: string): boolean {
  return (
    FILE_URL.test(value) ||
    WINDOWS_ABSOLUTE_PATH.test(value) ||
    HOME_RELATIVE_PATH.test(value) ||
    POSIX_LOCAL_PATH.test(value) ||
    LOCAL_PATH_ENVIRONMENT.test(value)
  )
}

function scanText(
  value: string,
  source: MiniProgramArtifactSecuritySource,
  entryIndex: number
): void {
  if (secretDetected(value)) reject('secret-detected', source, entryIndex)
  if (REMOTE_URL.test(value) || PROTOCOL_RELATIVE_REMOTE_URL.test(value)) {
    reject('remote-url-detected', source, entryIndex)
  }
  if (localPathDetected(value)) {
    reject('absolute-local-path-detected', source, entryIndex)
  }
  if (DYNAMIC_CODE_PATTERNS.some((pattern) => pattern.test(value))) {
    reject('dynamic-code-detected', source, entryIndex)
  }
}

function scanBinaryMetadata(value: string, entryIndex: number): void {
  // Raster EXIF/XMP commonly contains harmless namespace URLs such as
  // http://ns.adobe.com. Binary metadata therefore uses only the high-confidence
  // credential and local-path checks; remote URL and executable-source checks
  // apply to generated text files and diagnostics.
  if (secretDetected(value)) reject('secret-detected', 'binary-metadata', entryIndex)
  if (localPathDetected(value)) {
    reject('absolute-local-path-detected', 'binary-metadata', entryIndex)
  }
}

function scanBinary(path: string, bytes: Uint8Array, entryIndex: number): void {
  if (!isReviewedMiniProgramRasterAsset(path, bytes)) {
    reject('unreviewed-binary-artifact', 'binary-metadata', entryIndex)
  }
  scanBinaryMetadata(BINARY_METADATA_DECODER.decode(bytes), entryIndex)
}

function scanFilePath(path: string, entryIndex: number): void {
  scanText(path, 'file-path', entryIndex)
  const segments = path.split('/')
  if (
    path.length === 0 ||
    path.startsWith('/') ||
    path.includes('\\') ||
    CONTROL_CHARACTER.test(path) ||
    segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')
  ) {
    reject('unsafe-file-path', 'file-path', entryIndex)
  }
}

function scanFiles(files: ReadonlyMap<string, string | Uint8Array>): void {
  const entries = [...files].sort(([left], [right]) => compareCodeUnits(left, right))
  entries.forEach(([path, content], entryIndex) => {
    scanFilePath(path, entryIndex)
    if (typeof content === 'string') scanText(content, 'text-content', entryIndex)
    else scanBinary(path, content, entryIndex)
  })
}

function scanWarnings(warnings: readonly CompileWarning[]): void {
  warnings.forEach((warning, entryIndex) => {
    scanText(warning.code, 'compiler-warning', entryIndex)
    scanText(warning.message, 'compiler-warning', entryIndex)
    if (warning.nodeId !== undefined) scanText(warning.nodeId, 'compiler-warning', entryIndex)
  })
}

export function assertMiniProgramCompilerOutputSafe(output: MiniProgramCompilerArtifact): void {
  scanFiles(output.files)
  scanWarnings(output.warnings)
}

export function assertMiniProgramProjectArtifactSafe(
  files: ReadonlyMap<string, string | Uint8Array>
): void {
  scanFiles(files)
}

export function assertMiniProgramWorkerDiagnosticSafe(error: string): void {
  scanText(error, 'worker-error', 0)
}

export function safeMiniProgramWorkerErrorMessage(error: string): string {
  try {
    assertMiniProgramWorkerDiagnosticSafe(error)
    return error
  } catch (cause) {
    if (cause instanceof MiniProgramArtifactSecurityError) {
      return 'Mini-program compiler Worker blocked an unsafe diagnostic'
    }
    return 'Mini-program compiler Worker failed safely'
  }
}
