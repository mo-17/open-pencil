/* oxlint-disable eslint(complexity), eslint(max-lines), open-pencil(no-mixed-case-acronym-identifiers), typescript-eslint(no-unnecessary-condition), typescript-eslint(no-unnecessary-boolean-literal-compare), typescript-eslint(prefer-optional-chain) -- This host boundary keeps artifact, authority, transport, receipt, and state invariants together. */
import {
  containsBackendSecretLikeMaterial,
  normalizeBackendReleaseProviderAuthority,
  type BackendReleaseProviderAuthorityV1
} from '@open-pencil/lowcode/backend'
import { digestCanonicalManifest } from '@open-pencil/scene-graph'

const SHA256 = /^[A-Za-z0-9_-]{43}$/u
const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u
const FUNCTION_SLUG = /^[a-z](?:[a-z0-9-]{0,62}[a-z0-9])?$/u
const ENVIRONMENT_NAME = /^[A-Z][A-Z0-9_]{0,127}$/u
const FUNCTION_ROOT = 'backend/supabase/functions/'
const MAX_PATH_BYTES = 512
const MAX_PATH_SEGMENT_BYTES = 255
const WINDOWS_RESERVED_PATH = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu

export const SUPABASE_EDGE_FUNCTION_RELEASE_LIMITS = Object.freeze({
  maxFiles: 64,
  maxFileBytes: 4 * 1024 * 1024,
  maxTotalBytes: 8 * 1024 * 1024,
  maxHealthEvidenceBytes: 64 * 1024,
  maxSlugBytes: 64,
  maxIdBytes: 256
})

export type SupabaseEdgeFunctionReleaseState = 'not-dispatched' | 'dispatched' | 'outcome-unknown'

export type SupabaseEdgeFunctionReleaseOutcome =
  | 'succeeded'
  | 'blocked'
  | 'failed'
  | 'outcome-unknown'

export type SupabaseEdgeFunctionReleaseErrorCode =
  | 'invalid-artifact'
  | 'invalid-authority'
  | 'missing-secrets'
  | 'confirmation-required'
  | 'authority-recheck-failed'
  | 'provider-rejected'
  | 'health-check-failed'
  | 'timeout'
  | 'aborted'
  | 'network-failed'
  | 'invalid-response'
  | 'dispatch-failed'

export class SupabaseEdgeFunctionReleaseError extends Error {
  constructor(
    readonly code: SupabaseEdgeFunctionReleaseErrorCode,
    message: string = code
  ) {
    super(`Supabase Edge Function release failed: ${message}.`)
    this.name = 'SupabaseEdgeFunctionReleaseError'
  }
}

export interface SupabaseEdgeFunctionArtifactFile {
  readonly path: string
  readonly kind: 'server-runtime'
  readonly mediaType: string
  readonly byteLength: number
  readonly digest: string
  readonly content: string | Uint8Array
}

/** A reviewed, secret-free-by-construction server runtime artifact. */
export interface SupabaseEdgeFunctionReleaseArtifact {
  readonly format: 'openpencil.supabase-edge-function-artifact.v1'
  readonly version: 1
  readonly providerId: 'supabase'
  readonly functionSlug: string
  readonly verifyJwt: true
  readonly reviewed: true
  readonly artifactDigest: string
  /** SHA-256 of the generated runtime source with its identity declaration removed. */
  readonly healthIdentity: string
  readonly requiredSecretNames: readonly string[]
  readonly files: readonly SupabaseEdgeFunctionArtifactFile[]
}

export interface SupabaseEdgeFunctionReleaseAuthority {
  readonly releaseAuthority: 'host.supabase-edge-functions.v1'
  readonly projectRef: string
  readonly accountId: string
  readonly grantGeneration: string
  readonly environment: 'staging' | 'production'
  readonly provider: BackendReleaseProviderAuthorityV1
  readonly artifactDigest: string
  readonly functionSlug: string
}

export interface SupabaseEdgeFunctionReleaseConfirmation {
  readonly confirmed: true
  readonly scope: 'single-function'
  readonly providerId: 'supabase'
  readonly projectRef: string
  readonly accountId: string
  readonly grantGeneration: string
  readonly functionSlug: string
  readonly artifactDigest: string
}

export interface SupabaseEdgeFunctionSecretInspectionInput {
  readonly projectRef: string
  readonly accountId: string
  readonly grantGeneration: string
  readonly providerId: 'supabase'
  readonly functionSlug: string
  readonly artifactDigest: string
  readonly requiredSecretNames: readonly string[]
}

/** Host-produced presence proof. It contains required names only, never secret values. */
export interface SupabaseEdgeFunctionSecretInspectionEvidence {
  readonly projectRef: string
  readonly accountId: string
  readonly grantGeneration: string
  readonly providerId: 'supabase'
  readonly functionSlug: string
  readonly artifactDigest: string
  readonly requiredSecretNames: readonly string[]
  readonly evidenceDigest: string
  readonly checkedAt: string
}

export interface SupabaseEdgeFunctionDeployInput {
  readonly projectRef: string
  readonly accountId: string
  readonly grantGeneration: string
  readonly providerId: 'supabase'
  readonly functionSlug: string
  readonly verifyJwt: true
  readonly files: readonly SupabaseEdgeFunctionArtifactFile[]
  readonly artifactDigest: string
}

export interface SupabaseEdgeFunctionDeployResult {
  readonly projectRef: string
  readonly functionSlug: string
  readonly functionId: string
  readonly versionId: string
  readonly operationId: string
}

export interface SupabaseEdgeFunctionHealthInput {
  readonly projectRef: string
  readonly accountId: string
  readonly grantGeneration: string
  readonly providerId: 'supabase'
  readonly functionSlug: string
  readonly functionId: string
  readonly versionId: string
  readonly expectedHealthIdentity: string
  /** The transport obtains an authenticated user/session itself; no token crosses this contract. */
  readonly authenticated: true
}

export interface SupabaseEdgeFunctionHealthEvidence {
  readonly status: 200
  readonly authenticated: true
  readonly healthy: true
  readonly healthIdentity: string
  readonly evidenceDigest: string
  readonly operationId: string
  readonly checkedAt: string
}

export interface SupabaseEdgeFunctionReleaseTransports {
  /** Re-resolve project/account/grant/provider authority immediately before mutation. */
  readonly recheckAuthority: (authority: SupabaseEdgeFunctionReleaseAuthority) => Promise<void>
  /** Inspect the live project for exactly the artifact-required names; never return values. */
  readonly inspectRequiredSecrets: (
    input: SupabaseEdgeFunctionSecretInspectionInput
  ) => Promise<SupabaseEdgeFunctionSecretInspectionEvidence>
  /** Host-owned, transient deployment transport. It must not persist secrets or artifact bodies. */
  readonly deploy: (
    input: SupabaseEdgeFunctionDeployInput
  ) => Promise<SupabaseEdgeFunctionDeployResult>
  /** Host-owned authenticated invoke used only for the post-deploy health check. */
  readonly invokeAuthenticated: (
    input: SupabaseEdgeFunctionHealthInput
  ) => Promise<SupabaseEdgeFunctionHealthEvidence>
}

export interface SupabaseEdgeFunctionReleaseReceipt {
  readonly format: 'openpencil.supabase-edge-function-deployment-receipt'
  readonly version: 1
  readonly releaseId: string
  readonly environment: 'staging' | 'production'
  readonly projectRef: string
  readonly accountId: string
  readonly grantGeneration: string
  readonly provider: BackendReleaseProviderAuthorityV1
  readonly artifactDigest: string
  readonly healthIdentity: string
  readonly functionSlug: string
  readonly verifyJwt: true
  readonly requiredSecretNames: readonly string[]
  readonly secretInspection: SupabaseEdgeFunctionSecretInspectionEvidence | null
  readonly dispatch: SupabaseEdgeFunctionReleaseState
  readonly outcome: SupabaseEdgeFunctionReleaseOutcome
  readonly remote: Readonly<{
    functionId: string | null
    versionId: string | null
    operationIds: readonly string[]
  }>
  readonly health: SupabaseEdgeFunctionHealthEvidence | null
  readonly failureCode: SupabaseEdgeFunctionReleaseErrorCode | null
  readonly recordedAt: string
}

export interface CreateSupabaseEdgeFunctionReleaseInput {
  readonly releaseId: string
  readonly authority: SupabaseEdgeFunctionReleaseAuthority
  readonly artifact: SupabaseEdgeFunctionReleaseArtifact
  readonly transports: SupabaseEdgeFunctionReleaseTransports
  readonly now: () => string
  readonly confirmation?: SupabaseEdgeFunctionReleaseConfirmation
  /**
   * Host-owned durable claim boundary. It runs after all read-only preflight checks and
   * immediately before the first deploy request. A rejection prevents remote mutation.
   */
  readonly beforeDispatch?: (evidence: {
    readonly releaseId: string
    readonly projectRef: string
    readonly accountId: string
    readonly grantGeneration: string
    readonly functionSlug: string
    readonly artifactDigest: string
    readonly secretInspectionEvidenceDigest: string
  }) => Promise<void>
  /** Persist the provider-returned remote identity before the health invocation. */
  readonly onRemoteEvidence?: (evidence: {
    readonly releaseId: string
    readonly projectRef: string
    readonly functionSlug: string
    readonly artifactDigest: string
    readonly functionId: string
    readonly versionId: string
    readonly operationId: string
  }) => Promise<void>
}

export interface SupabaseEdgeFunctionReleaseSession {
  readonly dispatch: () => Promise<SupabaseEdgeFunctionReleaseReceipt>
  readonly state: () => SupabaseEdgeFunctionReleaseState
}

interface SupabaseEdgeFunctionEvidenceRecord {
  [key: string]: unknown
}

function fail(code: SupabaseEdgeFunctionReleaseErrorCode, message: string = code): never {
  throw new SupabaseEdgeFunctionReleaseError(code, message)
}

function boundedId(value: unknown, name: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > SUPABASE_EDGE_FUNCTION_RELEASE_LIMITS.maxIdBytes
  ) {
    fail('invalid-authority', `${name} is not a bounded identifier`)
  }
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0
    if (codePoint <= 31 || codePoint === 127)
      fail('invalid-authority', `${name} contains control characters`)
  }
  return value
}

function stableId(value: unknown, name: string): string {
  const parsed = boundedId(value, name)
  if (!STABLE_ID.test(parsed)) fail('invalid-authority', `${name} is not a stable identifier`)
  return parsed
}

function digest(value: unknown, name: string): string {
  const parsed = boundedId(value, name)
  if (!SHA256.test(parsed)) fail('invalid-authority', `${name} is not a SHA-256 digest`)
  return parsed
}

function slug(value: unknown): string {
  if (
    typeof value !== 'string' ||
    new TextEncoder().encode(value).byteLength >
      SUPABASE_EDGE_FUNCTION_RELEASE_LIMITS.maxSlugBytes ||
    !FUNCTION_SLUG.test(value)
  ) {
    fail('invalid-artifact', 'functionSlug is invalid')
  }
  return value
}

function canonicalTimestamp(value: unknown, name: string): string {
  if (typeof value !== 'string') fail('invalid-response', `${name} is not a canonical timestamp`)
  const milliseconds = Date.parse(value)
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    fail('invalid-response', `${name} is not a canonical timestamp`)
  }
  return value
}

function copyBytes(content: string | Uint8Array): Uint8Array {
  if (typeof content === 'string') return new TextEncoder().encode(content)
  if (!(content instanceof Uint8Array)) fail('invalid-artifact', 'file content is not bytes')
  return content.slice()
}

function pathIsSafe(value: string): void {
  const encoder = new TextEncoder()
  if (
    value.length === 0 ||
    value !== value.normalize('NFC') ||
    value.startsWith('/') ||
    value.includes('\\') ||
    value.includes(':') ||
    encoder.encode(value).byteLength > MAX_PATH_BYTES
  ) {
    fail('invalid-artifact', 'artifact path is not a safe relative POSIX path')
  }
  for (const part of value.split('/')) {
    if (
      part.length === 0 ||
      part === '.' ||
      part === '..' ||
      part.endsWith('.') ||
      part.endsWith(' ') ||
      WINDOWS_RESERVED_PATH.test(part) ||
      encoder.encode(part).byteLength > MAX_PATH_SEGMENT_BYTES
    ) {
      fail('invalid-artifact', 'artifact path contains an unsafe segment')
    }
  }
}

function encodeBase64URL(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const source = new Uint8Array(bytes.byteLength)
  source.set(bytes)
  return encodeBase64URL(new Uint8Array(await crypto.subtle.digest('SHA-256', source)))
}

/**
 * Reads the identity embedded by the compiler and verifies it against the runtime source itself.
 * The declaration line is excluded from the digest, avoiding a circular self-hash.
 */
export async function verifySupabaseEdgeFunctionRuntimeHealthIdentity(
  source: string
): Promise<string> {
  const lines = source.split('\n')
  const matches = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) =>
      /^const OPENPENCIL_EDGE_BUILD_IDENTITY = "[A-Za-z0-9_-]{43}"$/u.test(line)
    )
  if (matches.length !== 1) {
    fail('invalid-artifact', 'runtime build identity declaration is missing or duplicated')
  }
  const match = matches[0]
  const healthIdentity = match.line.slice('const OPENPENCIL_EDGE_BUILD_IDENTITY = "'.length, -1)
  const sourceWithoutIdentity = [
    ...lines.slice(0, match.index),
    ...lines.slice(match.index + 1)
  ].join('\n')
  if ((await sha256(new TextEncoder().encode(sourceWithoutIdentity))) !== healthIdentity) {
    fail('invalid-artifact', 'runtime build identity does not match source')
  }
  return healthIdentity
}

function secretName(value: unknown): string {
  if (typeof value !== 'string' || !ENVIRONMENT_NAME.test(value))
    fail('invalid-artifact', 'secret name is invalid')
  return value
}

function sortedUnique(values: readonly string[], name: string): readonly string[] {
  const result = values
    .map((value) => secretName(value))
    .sort((left, right) => left.localeCompare(right, 'en'))
  if (new Set(result).size !== result.length)
    fail('invalid-artifact', `${name} contains duplicates`)
  return Object.freeze(result)
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function sameProvider(
  left: BackendReleaseProviderAuthorityV1,
  right: BackendReleaseProviderAuthorityV1
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

async function verifyArtifact(input: CreateSupabaseEdgeFunctionReleaseInput): Promise<{
  readonly artifact: SupabaseEdgeFunctionReleaseArtifact
  readonly files: readonly SupabaseEdgeFunctionArtifactFile[]
  readonly secretNames: readonly string[]
}> {
  const artifact = input.artifact
  if (
    artifact.format !== 'openpencil.supabase-edge-function-artifact.v1' ||
    artifact.version !== 1 ||
    artifact.providerId !== 'supabase' ||
    artifact.reviewed !== true ||
    artifact.verifyJwt !== true
  ) {
    fail('invalid-artifact', 'artifact review envelope is invalid')
  }
  const functionSlug = slug(artifact.functionSlug)
  const secretNames = sortedUnique(artifact.requiredSecretNames, 'requiredSecretNames')
  if (
    !Array.isArray(artifact.files) ||
    artifact.files.length === 0 ||
    artifact.files.length > SUPABASE_EDGE_FUNCTION_RELEASE_LIMITS.maxFiles
  ) {
    fail('invalid-artifact', 'server runtime file count is outside the limit')
  }
  const prefix = `${FUNCTION_ROOT}${functionSlug}/`
  const seen = new Set<string>()
  let totalBytes = 0
  let entrypointSource: string | undefined
  const files: SupabaseEdgeFunctionArtifactFile[] = []
  for (const source of artifact.files) {
    if (
      source.kind !== 'server-runtime' ||
      typeof source.mediaType !== 'string' ||
      source.mediaType.length === 0
    )
      fail('invalid-artifact', 'only server-runtime files are accepted')
    pathIsSafe(source.path)
    if (!source.path.startsWith(prefix) || source.path.slice(prefix.length).length === 0)
      fail('invalid-artifact', 'artifact file escapes the selected function')
    if (seen.has(source.path)) fail('invalid-artifact', 'artifact contains duplicate paths')
    seen.add(source.path)
    const bytes = copyBytes(source.content)
    if (
      bytes.byteLength !== source.byteLength ||
      bytes.byteLength > SUPABASE_EDGE_FUNCTION_RELEASE_LIMITS.maxFileBytes
    )
      fail('invalid-artifact', 'artifact file byteLength is invalid')
    totalBytes += bytes.byteLength
    if (totalBytes > SUPABASE_EDGE_FUNCTION_RELEASE_LIMITS.maxTotalBytes)
      fail('invalid-artifact', 'artifact total bytes exceed the limit')
    if ((await sha256(bytes)) !== source.digest)
      fail('invalid-artifact', 'artifact file digest does not match content')
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      if (containsBackendSecretLikeMaterial(text))
        fail('invalid-artifact', 'artifact contains secret-like material')
      if (source.path === `${prefix}index.ts`) entrypointSource = text
    } catch (cause) {
      if (cause instanceof SupabaseEdgeFunctionReleaseError) throw cause
      fail('invalid-artifact', 'artifact file is not valid UTF-8')
    }
    files.push(Object.freeze({ ...source, content: bytes.slice() }))
  }
  if (!entrypointSource) fail('invalid-artifact', 'artifact entrypoint is unavailable')
  const healthIdentity = await verifySupabaseEdgeFunctionRuntimeHealthIdentity(entrypointSource)
  if (artifact.healthIdentity !== healthIdentity) {
    fail('invalid-artifact', 'artifact health identity is not bound to its entrypoint')
  }
  const orderedFiles = files.sort((left, right) => left.path.localeCompare(right.path, 'en'))
  const digestInput = JSON.stringify({
    format: artifact.format,
    version: artifact.version,
    providerId: artifact.providerId,
    functionSlug,
    verifyJwt: true,
    healthIdentity,
    requiredSecretNames: secretNames,
    files: orderedFiles.map(({ path, kind, mediaType, byteLength, digest }) => ({
      path,
      kind,
      mediaType,
      byteLength,
      digest
    }))
  })
  if (
    (await sha256(new TextEncoder().encode(digestInput))) !==
    digest(artifact.artifactDigest, 'artifactDigest')
  )
    fail('invalid-artifact', 'artifact digest does not match its reviewed files')
  return Object.freeze({ artifact, files: Object.freeze(orderedFiles), secretNames })
}

function verifyAuthority(
  input: CreateSupabaseEdgeFunctionReleaseInput,
  artifact: SupabaseEdgeFunctionReleaseArtifact
): void {
  const authority = input.authority
  let provider: BackendReleaseProviderAuthorityV1
  try {
    provider = normalizeBackendReleaseProviderAuthority(authority.provider)
  } catch {
    fail('invalid-authority', 'provider authority is invalid')
  }
  if (
    authority.releaseAuthority !== 'host.supabase-edge-functions.v1' ||
    (authority.environment !== 'staging' && authority.environment !== 'production') ||
    provider.providerId !== 'supabase' ||
    !provider.capabilities.includes('server.functions') ||
    !provider.outputKinds.includes('server-runtime') ||
    authority.functionSlug !== artifact.functionSlug ||
    authority.artifactDigest !== artifact.artifactDigest ||
    authority.projectRef.length === 0 ||
    authority.accountId.length === 0 ||
    authority.grantGeneration.length === 0
  ) {
    fail('invalid-authority', 'release authority is not bound to the artifact')
  }
  boundedId(input.releaseId, 'releaseId')
  stableId(authority.projectRef, 'projectRef')
  stableId(authority.accountId, 'accountId')
  stableId(authority.grantGeneration, 'grantGeneration')
  if (!sameProvider(authority.provider, provider))
    fail('invalid-authority', 'provider authority is invalid')
}

function verifyConfirmation(input: CreateSupabaseEdgeFunctionReleaseInput): void {
  if (input.authority.environment !== 'production') return
  const confirmation = input.confirmation
  if (
    !confirmation ||
    confirmation.confirmed !== true ||
    confirmation.scope !== 'single-function' ||
    confirmation.providerId !== 'supabase' ||
    confirmation.projectRef !== input.authority.projectRef ||
    confirmation.accountId !== input.authority.accountId ||
    confirmation.grantGeneration !== input.authority.grantGeneration ||
    confirmation.functionSlug !== input.authority.functionSlug ||
    confirmation.artifactDigest !== input.authority.artifactDigest
  ) {
    fail('confirmation-required', 'production release requires exact single-function confirmation')
  }
}

function strictEvidenceRecord(
  value: unknown,
  expectedKeys: readonly string[]
): SupabaseEdgeFunctionEvidenceRecord {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) {
    fail('invalid-response', 'transport evidence is not a plain record')
  }
  const keys = Reflect.ownKeys(value)
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
  ) {
    fail('invalid-response', 'transport evidence fields are invalid')
  }
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
      fail('invalid-response', 'transport evidence contains non-data fields')
    }
  }
  return value as SupabaseEdgeFunctionEvidenceRecord
}

function evidenceValue(record: SupabaseEdgeFunctionEvidenceRecord, key: string): unknown {
  return (Object.getOwnPropertyDescriptor(record, key) as PropertyDescriptor & { value: unknown })
    .value
}

async function verifySecretInspection(
  input: CreateSupabaseEdgeFunctionReleaseInput,
  required: readonly string[],
  evidence: SupabaseEdgeFunctionSecretInspectionEvidence
): Promise<SupabaseEdgeFunctionSecretInspectionEvidence> {
  const record = strictEvidenceRecord(evidence, [
    'projectRef',
    'accountId',
    'grantGeneration',
    'providerId',
    'functionSlug',
    'artifactDigest',
    'requiredSecretNames',
    'evidenceDigest',
    'checkedAt'
  ])
  const rawNames = evidenceValue(record, 'requiredSecretNames')
  if (!Array.isArray(rawNames)) fail('invalid-response', 'secret inspection names are invalid')
  const names = rawNames.map((name) => {
    if (typeof name !== 'string' || !ENVIRONMENT_NAME.test(name)) {
      fail('invalid-response', 'secret inspection names are invalid')
    }
    return name
  })
  if (
    !sameStrings(names, required) ||
    new Set(names).size !== names.length ||
    evidenceValue(record, 'projectRef') !== input.authority.projectRef ||
    evidenceValue(record, 'accountId') !== input.authority.accountId ||
    evidenceValue(record, 'grantGeneration') !== input.authority.grantGeneration ||
    evidenceValue(record, 'providerId') !== 'supabase' ||
    evidenceValue(record, 'functionSlug') !== input.artifact.functionSlug ||
    evidenceValue(record, 'artifactDigest') !== input.artifact.artifactDigest
  ) {
    fail('missing-secrets', 'secret inspection is not bound to every required name and authority')
  }
  const checkedAt = canonicalTimestamp(
    evidenceValue(record, 'checkedAt'),
    'secretInspection.checkedAt'
  )
  const expectedDigest = await digestCanonicalManifest({
    format: 'openpencil.supabase-edge-secret-inspection-evidence.v1',
    version: 1,
    projectRef: input.authority.projectRef,
    accountId: input.authority.accountId,
    grantGeneration: input.authority.grantGeneration,
    providerId: 'supabase',
    functionSlug: input.artifact.functionSlug,
    artifactDigest: input.artifact.artifactDigest,
    requiredSecretNames: names,
    checkedAt
  })
  if (evidenceValue(record, 'evidenceDigest') !== expectedDigest) {
    fail('invalid-response', 'secret inspection digest is invalid')
  }
  return Object.freeze({
    projectRef: input.authority.projectRef,
    accountId: input.authority.accountId,
    grantGeneration: input.authority.grantGeneration,
    providerId: 'supabase' as const,
    functionSlug: input.artifact.functionSlug,
    artifactDigest: input.artifact.artifactDigest,
    requiredSecretNames: Object.freeze([...names]),
    evidenceDigest: expectedDigest,
    checkedAt
  })
}

async function verifyHealthEvidence(
  input: CreateSupabaseEdgeFunctionReleaseInput,
  deployed: SupabaseEdgeFunctionDeployResult,
  evidence: SupabaseEdgeFunctionHealthEvidence
): Promise<SupabaseEdgeFunctionHealthEvidence> {
  const record = strictEvidenceRecord(evidence, [
    'status',
    'authenticated',
    'healthy',
    'healthIdentity',
    'evidenceDigest',
    'operationId',
    'checkedAt'
  ])
  if (
    evidenceValue(record, 'status') !== 200 ||
    evidenceValue(record, 'authenticated') !== true ||
    evidenceValue(record, 'healthy') !== true ||
    evidenceValue(record, 'healthIdentity') !== input.artifact.healthIdentity
  ) {
    fail('health-check-failed', 'authenticated Edge Function health identity did not match')
  }
  const checkedAt = canonicalTimestamp(evidenceValue(record, 'checkedAt'), 'health.checkedAt')
  const expectedDigest = await digestCanonicalManifest({
    format: 'openpencil.supabase-edge-health-evidence.v1',
    version: 1,
    projectRef: input.authority.projectRef,
    accountId: input.authority.accountId,
    grantGeneration: input.authority.grantGeneration,
    functionSlug: input.artifact.functionSlug,
    functionId: deployed.functionId,
    versionId: deployed.versionId,
    expectedHealthIdentity: input.artifact.healthIdentity,
    authenticated: true,
    healthy: true,
    checkedAt
  })
  const operationId = `edge-health-${expectedDigest.slice(0, 32)}`
  if (
    evidenceValue(record, 'evidenceDigest') !== expectedDigest ||
    evidenceValue(record, 'operationId') !== operationId
  ) {
    fail('health-check-failed', 'authenticated Edge Function health evidence is invalid')
  }
  return Object.freeze({
    status: 200 as const,
    authenticated: true as const,
    healthy: true as const,
    healthIdentity: input.artifact.healthIdentity,
    evidenceDigest: expectedDigest,
    operationId,
    checkedAt
  })
}

function errorCode(cause: unknown): SupabaseEdgeFunctionReleaseErrorCode {
  if (cause instanceof SupabaseEdgeFunctionReleaseError) return cause.code
  return 'dispatch-failed'
}

function isUnknownCode(code: SupabaseEdgeFunctionReleaseErrorCode): boolean {
  return (
    code === 'timeout' ||
    code === 'aborted' ||
    code === 'network-failed' ||
    code === 'invalid-response' ||
    code === 'dispatch-failed'
  )
}

function freezeReceipt(
  receipt: SupabaseEdgeFunctionReleaseReceipt
): SupabaseEdgeFunctionReleaseReceipt {
  for (const value of Object.values(receipt)) {
    if (value && typeof value === 'object') {
      for (const nested of Object.values(value)) {
        if (nested && typeof nested === 'object') Object.freeze(nested)
      }
      Object.freeze(value)
    }
  }
  return Object.freeze(receipt)
}

export async function digestSupabaseEdgeFunctionArtifact(
  artifact: Omit<SupabaseEdgeFunctionReleaseArtifact, 'artifactDigest'>
): Promise<string> {
  const functionSlug = slug(artifact.functionSlug)
  const requiredSecretNames = sortedUnique(artifact.requiredSecretNames, 'requiredSecretNames')
  if (
    artifact.format !== 'openpencil.supabase-edge-function-artifact.v1' ||
    artifact.version !== 1 ||
    artifact.providerId !== 'supabase' ||
    artifact.reviewed !== true ||
    artifact.verifyJwt !== true ||
    typeof artifact.healthIdentity !== 'string' ||
    !SHA256.test(artifact.healthIdentity) ||
    !Array.isArray(artifact.files) ||
    artifact.files.length === 0 ||
    artifact.files.length > SUPABASE_EDGE_FUNCTION_RELEASE_LIMITS.maxFiles
  ) {
    fail('invalid-artifact', 'artifact review envelope is invalid')
  }
  const prefix = `${FUNCTION_ROOT}${functionSlug}/`
  const seen = new Set<string>()
  let totalBytes = 0
  let entrypointSource: string | undefined
  const orderedFiles: SupabaseEdgeFunctionArtifactFile[] = []
  for (const source of artifact.files) {
    if (
      source.kind !== 'server-runtime' ||
      typeof source.mediaType !== 'string' ||
      source.mediaType.length === 0
    )
      fail('invalid-artifact', 'only server-runtime files are accepted')
    pathIsSafe(source.path)
    if (
      !source.path.startsWith(prefix) ||
      source.path.slice(prefix.length).length === 0 ||
      seen.has(source.path)
    )
      fail('invalid-artifact', 'artifact file path is invalid or duplicated')
    seen.add(source.path)
    const bytes = copyBytes(source.content)
    if (
      bytes.byteLength !== source.byteLength ||
      bytes.byteLength > SUPABASE_EDGE_FUNCTION_RELEASE_LIMITS.maxFileBytes
    )
      fail('invalid-artifact', 'artifact file byteLength is invalid')
    totalBytes += bytes.byteLength
    if (totalBytes > SUPABASE_EDGE_FUNCTION_RELEASE_LIMITS.maxTotalBytes)
      fail('invalid-artifact', 'artifact total bytes exceed the limit')
    if ((await sha256(bytes)) !== source.digest)
      fail('invalid-artifact', 'artifact file digest does not match content')
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    if (containsBackendSecretLikeMaterial(text))
      fail('invalid-artifact', 'artifact contains secret-like material')
    if (source.path === `${prefix}index.ts`) entrypointSource = text
    orderedFiles.push({ ...source, content: bytes })
  }
  if (!entrypointSource) fail('invalid-artifact', 'artifact entrypoint is unavailable')
  const healthIdentity = await verifySupabaseEdgeFunctionRuntimeHealthIdentity(entrypointSource)
  if (artifact.healthIdentity !== healthIdentity) {
    fail('invalid-artifact', 'artifact health identity is not bound to its entrypoint')
  }
  const digestInput = JSON.stringify({
    format: artifact.format,
    version: artifact.version,
    providerId: artifact.providerId,
    functionSlug,
    verifyJwt: true,
    healthIdentity,
    requiredSecretNames,
    files: orderedFiles
      .sort((left, right) => left.path.localeCompare(right.path, 'en'))
      .map(({ path, kind, mediaType, byteLength, digest }) => ({
        path,
        kind,
        mediaType,
        byteLength,
        digest
      }))
  })
  return sha256(new TextEncoder().encode(digestInput))
}

export function createSupabaseEdgeFunctionRelease(
  input: CreateSupabaseEdgeFunctionReleaseInput
): SupabaseEdgeFunctionReleaseSession {
  let currentState: SupabaseEdgeFunctionReleaseState = 'not-dispatched'
  let operation: Promise<SupabaseEdgeFunctionReleaseReceipt> | undefined

  const dispatch = (): Promise<SupabaseEdgeFunctionReleaseReceipt> => {
    if (operation) return operation
    operation = (async () => {
      const checked = await verifyArtifact(input)
      verifyAuthority(input, checked.artifact)
      verifyConfirmation(input)
      const recordedAt = () => canonicalTimestamp(input.now(), 'recordedAt')
      const base = {
        format: 'openpencil.supabase-edge-function-deployment-receipt' as const,
        version: 1 as const,
        releaseId: input.releaseId,
        environment: input.authority.environment,
        projectRef: input.authority.projectRef,
        accountId: input.authority.accountId,
        grantGeneration: input.authority.grantGeneration,
        provider: {
          ...input.authority.provider,
          supportedModelVersions: [...input.authority.provider.supportedModelVersions],
          capabilities: [...input.authority.provider.capabilities],
          permissions: [...input.authority.provider.permissions],
          outputKinds: [...input.authority.provider.outputKinds]
        },
        artifactDigest: checked.artifact.artifactDigest,
        healthIdentity: checked.artifact.healthIdentity,
        functionSlug: checked.artifact.functionSlug,
        verifyJwt: true as const,
        requiredSecretNames: [...checked.secretNames],
        secretInspection: null,
        remote: { functionId: null, versionId: null, operationIds: [] as readonly string[] },
        health: null,
        failureCode: null
      }
      try {
        await input.transports.recheckAuthority(input.authority)
      } catch {
        return freezeReceipt({
          ...base,
          dispatch: 'not-dispatched',
          outcome: 'failed',
          failureCode: 'authority-recheck-failed',
          recordedAt: recordedAt()
        })
      }
      let secretInspection: SupabaseEdgeFunctionSecretInspectionEvidence
      try {
        const evidence = await input.transports.inspectRequiredSecrets(
          Object.freeze({
            projectRef: input.authority.projectRef,
            accountId: input.authority.accountId,
            grantGeneration: input.authority.grantGeneration,
            providerId: 'supabase' as const,
            functionSlug: checked.artifact.functionSlug,
            artifactDigest: checked.artifact.artifactDigest,
            requiredSecretNames: Object.freeze([...checked.secretNames])
          })
        )
        secretInspection = await verifySecretInspection(input, checked.secretNames, evidence)
      } catch (cause) {
        const code = errorCode(cause)
        return freezeReceipt({
          ...base,
          dispatch: 'not-dispatched',
          outcome: code === 'missing-secrets' ? 'blocked' : 'failed',
          failureCode: code,
          recordedAt: recordedAt()
        })
      }
      const releaseBase = { ...base, secretInspection }
      await input.beforeDispatch?.(
        Object.freeze({
          releaseId: input.releaseId,
          projectRef: input.authority.projectRef,
          accountId: input.authority.accountId,
          grantGeneration: input.authority.grantGeneration,
          functionSlug: checked.artifact.functionSlug,
          artifactDigest: checked.artifact.artifactDigest,
          secretInspectionEvidenceDigest: secretInspection.evidenceDigest
        })
      )
      // The durable claim intentionally precedes this final check. Revalidate both the Host's
      // local binding and the live project authority as close as possible to the first POST.
      // A failed read-only recheck is conclusive: deploy has not been invoked.
      try {
        await input.transports.recheckAuthority(input.authority)
      } catch {
        return freezeReceipt({
          ...releaseBase,
          dispatch: 'not-dispatched',
          outcome: 'failed',
          failureCode: 'authority-recheck-failed',
          recordedAt: recordedAt()
        })
      }
      currentState = 'dispatched'
      let deployed: SupabaseEdgeFunctionDeployResult
      try {
        deployed = await input.transports.deploy({
          projectRef: input.authority.projectRef,
          accountId: input.authority.accountId,
          grantGeneration: input.authority.grantGeneration,
          providerId: 'supabase',
          functionSlug: checked.artifact.functionSlug,
          verifyJwt: true,
          files: checked.files,
          artifactDigest: checked.artifact.artifactDigest
        })
        if (
          deployed.projectRef !== input.authority.projectRef ||
          deployed.functionSlug !== checked.artifact.functionSlug
        )
          fail('invalid-response', 'deployment response expanded remote scope')
        stableId(deployed.functionId, 'functionId')
        stableId(deployed.versionId, 'versionId')
        stableId(deployed.operationId, 'operationId')
      } catch (cause) {
        const code = errorCode(cause)
        if (isUnknownCode(code)) currentState = 'outcome-unknown'
        return freezeReceipt({
          ...releaseBase,
          dispatch: currentState,
          outcome: isUnknownCode(code) ? 'outcome-unknown' : 'failed',
          failureCode: code,
          recordedAt: recordedAt()
        })
      }
      try {
        await input.onRemoteEvidence?.(
          Object.freeze({
            releaseId: input.releaseId,
            projectRef: input.authority.projectRef,
            functionSlug: checked.artifact.functionSlug,
            artifactDigest: checked.artifact.artifactDigest,
            functionId: deployed.functionId,
            versionId: deployed.versionId,
            operationId: deployed.operationId
          })
        )
      } catch {
        currentState = 'outcome-unknown'
        return freezeReceipt({
          ...releaseBase,
          dispatch: currentState,
          outcome: 'outcome-unknown',
          remote: {
            functionId: deployed.functionId,
            versionId: deployed.versionId,
            operationIds: [deployed.operationId]
          },
          failureCode: 'dispatch-failed',
          recordedAt: recordedAt()
        })
      }
      try {
        const health = await input.transports.invokeAuthenticated({
          projectRef: input.authority.projectRef,
          accountId: input.authority.accountId,
          grantGeneration: input.authority.grantGeneration,
          providerId: 'supabase',
          functionSlug: checked.artifact.functionSlug,
          functionId: deployed.functionId,
          versionId: deployed.versionId,
          expectedHealthIdentity: checked.artifact.healthIdentity,
          authenticated: true
        })
        const verifiedHealth = await verifyHealthEvidence(input, deployed, health)
        return freezeReceipt({
          ...releaseBase,
          dispatch: currentState,
          outcome: 'succeeded',
          remote: {
            functionId: deployed.functionId,
            versionId: deployed.versionId,
            operationIds: [deployed.operationId, verifiedHealth.operationId]
          },
          health: verifiedHealth,
          recordedAt: recordedAt()
        })
      } catch (cause) {
        const code = errorCode(cause)
        if (isUnknownCode(code)) currentState = 'outcome-unknown'
        return freezeReceipt({
          ...releaseBase,
          dispatch: currentState,
          outcome: isUnknownCode(code) ? 'outcome-unknown' : 'failed',
          remote: {
            functionId: deployed.functionId,
            versionId: deployed.versionId,
            operationIds: [deployed.operationId]
          },
          failureCode: code,
          recordedAt: recordedAt()
        })
      }
    })()
    return operation
  }
  return Object.freeze({ dispatch, state: () => currentState })
}
