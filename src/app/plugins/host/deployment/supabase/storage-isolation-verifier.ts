/* oxlint-disable eslint(complexity), eslint(max-lines), typescript-eslint(no-unnecessary-condition), typescript-eslint(no-unnecessary-boolean-literal-compare), typescript-eslint(prefer-optional-chain) -- Runtime trust-boundary checks, live probes, cleanup, and receipt invariants stay together for auditability. */
import {
  digestBackendApplication,
  normalizeBackendReleaseProviderAuthority,
  type BackendApplicationSpecV1,
  type BackendReleaseProviderAuthorityV1,
  type BackendStorageBucketIR,
  type BackendStorageOperation,
  type BackendStoragePathRuleIR
} from '@open-pencil/lowcode/backend'

const DIGEST = /^[A-Za-z0-9_-]{43}$/u
const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u
const PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u
const MIME_CANDIDATES = Object.freeze([
  'application/x-openpencil-denied',
  'image/x-openpencil-denied',
  'text/x-openpencil-denied',
  'audio/x-openpencil-denied',
  'video/x-openpencil-denied',
  'chemical/x-openpencil-denied'
])

export const SUPABASE_STORAGE_ISOLATION_LIMITS = Object.freeze({
  maxProbePayloadBytes: 16 * 1024 * 1024,
  maxOperationCount: 16,
  maxPathBytes: 1_024
})

export type SupabaseStorageProbeActor = 'anonymous' | 'user-a' | 'user-b'
export type SupabaseStorageIsolationOutcome = 'succeeded' | 'failed' | 'outcome-unknown'
export type SupabaseStorageIsolationState = 'not-dispatched' | 'dispatched' | 'outcome-unknown'

export type SupabaseStorageIsolationErrorCode =
  | 'invalid-authority'
  | 'invalid-model'
  | 'invalid-probe'
  | 'confirmation-required'
  | 'size-probe-limit'
  | 'transport-failed'
  | 'invalid-response'
  | 'authority-recheck-failed'
  | 'cleanup-required'

export class SupabaseStorageIsolationError extends Error {
  constructor(readonly code: SupabaseStorageIsolationErrorCode) {
    super(`Supabase Storage isolation verification failed: ${code}.`)
    this.name = 'SupabaseStorageIsolationError'
  }
}

export interface SupabaseStorageIsolationAuthority {
  readonly releaseAuthority: 'host.supabase-storage-isolation.v1'
  readonly environment: 'staging' | 'production'
  readonly projectRef: string
  readonly accountId: string
  readonly grantGeneration: string
  readonly provider: BackendReleaseProviderAuthorityV1
  readonly applicationDigest: string
  readonly storagePolicyArtifactDigest: string
}

export interface SupabaseStorageIsolationConfirmation {
  readonly confirmed: true
  readonly scope: 'single-storage-probe'
  readonly projectRef: string
  readonly accountId: string
  readonly grantGeneration: string
  readonly applicationDigest: string
  readonly storagePolicyArtifactDigest: string
  readonly bucketId: string
  readonly ruleId: string
}

export interface SupabaseStorageActorEvidence {
  readonly userAId: string
  readonly userBId: string
  /** Owner user id or a tenant value that User A owns while User B does not. */
  readonly allowedPartition: string
  /** A proven non-owned/non-member partition used for prefix escape testing. */
  readonly deniedPartition: string
  readonly evidenceDigest: string
  readonly operationId: string
}

export interface SupabaseStorageBucketEvidence {
  readonly bucketName: string
  readonly private: true
  readonly maxObjectBytes: number
  readonly allowedMimeTypes: readonly string[]
  readonly evidenceDigest: string
  readonly operationId: string
}

export interface SupabaseStorageObjectProbeInput {
  readonly actor: SupabaseStorageProbeActor
  readonly operation: BackendStorageOperation
  readonly bucketName: string
  readonly objectPath: string
  readonly mimeType: string
  readonly content: Uint8Array | null
}

export interface SupabaseStorageObjectProbeResult {
  readonly outcome: 'allowed' | 'denied'
  readonly status: number
  readonly evidenceDigest: string
  readonly operationId: string
}

export interface SupabaseStorageIsolationTransport {
  /** Read-only authority recheck; the transport owns transient A/B sessions and never returns them. */
  readonly recheckAuthority: (authority: SupabaseStorageIsolationAuthority) => Promise<void>
  readonly inspectBucket: (input: {
    readonly projectRef: string
    readonly bucketName: string
  }) => Promise<SupabaseStorageBucketEvidence>
  readonly resolveActors: (input: {
    readonly projectRef: string
    readonly bucketName: string
    readonly rule: BackendStoragePathRuleIR
  }) => Promise<SupabaseStorageActorEvidence>
  readonly probeObject: (
    input: SupabaseStorageObjectProbeInput
  ) => Promise<SupabaseStorageObjectProbeResult>
}

export type SupabaseStorageIsolationCheckId =
  | 'owner-create'
  | 'owner-read'
  | 'owner-update'
  | 'owner-upsert'
  | 'anonymous-read-denied'
  | 'second-user-read-denied'
  | 'second-user-update-denied'
  | 'second-user-delete-denied'
  | 'second-user-create-owner-path-denied'
  | 'path-prefix-escape-denied'
  | 'mime-limit-denied'
  | 'size-limit-denied'
  | 'owner-delete'

export interface SupabaseStorageIsolationCheck {
  readonly check: SupabaseStorageIsolationCheckId
  readonly passed: boolean
  readonly evidenceDigest: string
  readonly operationId: string
}

export interface SupabaseStorageIsolationReceipt {
  readonly format: 'openpencil.supabase-storage-isolation-receipt'
  readonly version: 1
  readonly verificationId: string
  readonly environment: 'staging' | 'production'
  readonly projectRef: string
  readonly accountId: string
  readonly grantGeneration: string
  readonly provider: BackendReleaseProviderAuthorityV1
  readonly applicationDigest: string
  readonly storagePolicyArtifactDigest: string
  readonly bucketId: string
  readonly bucketName: string
  readonly ruleId: string
  readonly principal: 'owner' | 'tenant-member'
  readonly actorEvidenceDigest: string
  readonly bucketEvidenceDigest: string
  readonly checks: readonly SupabaseStorageIsolationCheck[]
  readonly remoteOperationIds: readonly string[]
  readonly residualObjectPaths: readonly string[]
  readonly dispatch: SupabaseStorageIsolationState
  readonly outcome: SupabaseStorageIsolationOutcome
  readonly failureCode:
    | 'policy-check-failed'
    | 'transport-failed'
    | 'authority-recheck-failed'
    | 'cleanup-required'
    | null
  readonly checkedAt: string
}

export interface CreateSupabaseStorageIsolationVerificationInput {
  readonly verificationId: string
  readonly application: BackendApplicationSpecV1
  readonly authority: SupabaseStorageIsolationAuthority
  readonly bucketId: string
  readonly ruleId: string
  /**
   * Explicit per-request bandwidth authority. For bucket limits below the Host probe cap this
   * must permit an N+1 upload; larger limits are instead re-proven through read-only catalog
   * evidence and this value only needs to cover the ordinary bounded probe payload.
   */
  readonly maxProbePayloadBytes: number
  readonly transport: SupabaseStorageIsolationTransport
  readonly now: () => string
  readonly confirmation?: SupabaseStorageIsolationConfirmation
  /**
   * Host-owned durable claim boundary. It runs after read-only bucket/actor preflight and path
   * derivation, immediately before the first object probe that may mutate Storage.
   */
  readonly beforeDispatch?: (evidence: {
    readonly verificationId: string
    readonly projectRef: string
    readonly bucketId: string
    readonly bucketName: string
    readonly ruleId: string
    readonly actorEvidenceDigest: string
    readonly bucketEvidenceDigest: string
    readonly potentialResidualObjectPaths: readonly string[]
  }) => Promise<void>
  /** Persist bounded post-probe progress without actor sessions or credential material. */
  readonly onProgress?: (evidence: {
    readonly verificationId: string
    readonly projectRef: string
    readonly bucketId: string
    readonly bucketName: string
    readonly ruleId: string
    readonly remoteOperationIds: readonly string[]
    readonly residualObjectPaths: readonly string[]
  }) => Promise<void>
}

export interface SupabaseStorageIsolationVerificationSession {
  readonly verify: () => Promise<SupabaseStorageIsolationReceipt>
  readonly state: () => SupabaseStorageIsolationState
}

interface CheckedInput {
  readonly application: BackendApplicationSpecV1
  readonly authority: SupabaseStorageIsolationAuthority
  readonly bucket: BackendStorageBucketIR
  readonly rule: BackendStoragePathRuleIR
}

function fail(code: SupabaseStorageIsolationErrorCode): never {
  throw new SupabaseStorageIsolationError(code)
}

function stableId(value: unknown): string {
  if (typeof value !== 'string' || !STABLE_ID.test(value)) return fail('invalid-authority')
  return value
}

function digest(value: unknown): string {
  if (typeof value !== 'string' || !DIGEST.test(value)) return fail('invalid-response')
  return value
}

function canonicalTimestamp(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    return fail('invalid-response')
  }
  const canonical = new Date(value).toISOString()
  if (canonical !== value) return fail('invalid-response')
  return value
}

function ruleSupportsCompleteProbe(rule: BackendStoragePathRuleIR): boolean {
  const operations = new Set(rule.operations)
  const upsert =
    operations.has('upsert') ||
    (operations.has('read') && operations.has('create') && operations.has('update'))
  return (
    operations.has('delete') &&
    upsert &&
    (operations.has('read') || operations.has('upsert')) &&
    (operations.has('create') || operations.has('upsert')) &&
    (operations.has('update') || operations.has('upsert'))
  )
}

function verifyConfirmation(
  input: CreateSupabaseStorageIsolationVerificationInput,
  checked: CheckedInput
): void {
  if (checked.authority.environment !== 'production') return
  const confirmation = input.confirmation
  if (
    !confirmation ||
    confirmation.confirmed !== true ||
    confirmation.scope !== 'single-storage-probe' ||
    confirmation.projectRef !== checked.authority.projectRef ||
    confirmation.accountId !== checked.authority.accountId ||
    confirmation.grantGeneration !== checked.authority.grantGeneration ||
    confirmation.applicationDigest !== checked.authority.applicationDigest ||
    confirmation.storagePolicyArtifactDigest !== checked.authority.storagePolicyArtifactDigest ||
    confirmation.bucketId !== checked.bucket.id ||
    confirmation.ruleId !== checked.rule.id
  ) {
    fail('confirmation-required')
  }
}

async function checkedInput(
  input: CreateSupabaseStorageIsolationVerificationInput
): Promise<CheckedInput> {
  const provider = normalizeBackendReleaseProviderAuthority(input.authority.provider)
  const authority = Object.freeze({ ...input.authority, provider })
  stableId(input.verificationId)
  stableId(authority.projectRef)
  stableId(authority.accountId)
  stableId(authority.grantGeneration)
  if (
    authority.releaseAuthority !== 'host.supabase-storage-isolation.v1' ||
    (authority.environment !== 'staging' && authority.environment !== 'production') ||
    provider.providerId !== 'supabase' ||
    !provider.capabilities.includes('storage.objects') ||
    !provider.outputKinds.includes('security-policy') ||
    !DIGEST.test(authority.applicationDigest) ||
    !DIGEST.test(authority.storagePolicyArtifactDigest) ||
    (await digestBackendApplication(input.application)) !== authority.applicationDigest
  ) {
    return fail('invalid-authority')
  }
  const bucket = input.application.storage?.buckets.find((entry) => entry.id === input.bucketId)
  const rule = bucket?.pathRules.find((entry) => entry.id === input.ruleId)
  if (!bucket || !rule || bucket.access !== 'private' || !ruleSupportsCompleteProbe(rule)) {
    return fail('invalid-model')
  }
  const dynamicSizeProbeBytes = bucket.maxObjectBytes + 1
  const requiredProbeBytes =
    dynamicSizeProbeBytes <= SUPABASE_STORAGE_ISOLATION_LIMITS.maxProbePayloadBytes
      ? dynamicSizeProbeBytes
      : Math.min(32, bucket.maxObjectBytes)
  if (
    !Number.isSafeInteger(input.maxProbePayloadBytes) ||
    input.maxProbePayloadBytes < requiredProbeBytes ||
    input.maxProbePayloadBytes > SUPABASE_STORAGE_ISOLATION_LIMITS.maxProbePayloadBytes
  ) {
    return fail('size-probe-limit')
  }
  const checked = Object.freeze({ application: input.application, authority, bucket, rule })
  verifyConfirmation(input, checked)
  return checked
}

function mimeMatches(pattern: string, actual: string): boolean {
  return pattern === actual || (pattern.endsWith('/*') && actual.startsWith(pattern.slice(0, -1)))
}

function allowedMimeType(bucket: BackendStorageBucketIR): string {
  const first = bucket.allowedMimeTypes[0]
  return first.endsWith('/*') ? `${first.slice(0, -1)}x-openpencil-probe` : first
}

function deniedMimeType(bucket: BackendStorageBucketIR): string {
  const candidate = MIME_CANDIDATES.find((entry) =>
    bucket.allowedMimeTypes.every((allowed) => !mimeMatches(allowed, entry))
  )
  return candidate ?? fail('invalid-model')
}

function safePartition(value: unknown): string {
  if (typeof value !== 'string' || !PATH_SEGMENT.test(value)) return fail('invalid-response')
  return value
}

function safePath(segments: readonly string[]): string {
  if (segments.some((entry) => !PATH_SEGMENT.test(entry))) return fail('invalid-probe')
  const value = segments.join('/')
  if (new TextEncoder().encode(value).byteLength > SUPABASE_STORAGE_ISOLATION_LIMITS.maxPathBytes) {
    return fail('invalid-probe')
  }
  return value
}

function checkResult(
  result: SupabaseStorageObjectProbeResult,
  expected: 'allowed' | 'denied',
  check: SupabaseStorageIsolationCheckId,
  actor: SupabaseStorageProbeActor
): { readonly passed: boolean; readonly evidenceDigest: string; readonly operationId: string } {
  const allowedStatus = result.status >= 200 && result.status < 300
  const deniedStatus =
    result.status >= 400 && result.status < 500 && result.status !== 408 && result.status !== 429
  const authenticatedRlsDenial =
    actor !== 'anonymous' &&
    (check === 'second-user-read-denied' ||
      check === 'second-user-update-denied' ||
      check === 'second-user-delete-denied' ||
      check === 'second-user-create-owner-path-denied' ||
      check === 'path-prefix-escape-denied')
  if (
    (result.outcome !== 'allowed' && result.outcome !== 'denied') ||
    !Number.isSafeInteger(result.status) ||
    (result.outcome === 'allowed' ? !allowedStatus : !deniedStatus) ||
    (result.outcome === 'denied' && authenticatedRlsDenial && result.status !== 403)
  ) {
    return fail('invalid-response')
  }
  return {
    passed: result.outcome === expected,
    evidenceDigest: digest(result.evidenceDigest),
    operationId: stableId(result.operationId)
  }
}

function bucketEvidenceMatches(
  evidence: SupabaseStorageBucketEvidence,
  bucket: BackendStorageBucketIR
): boolean {
  return (
    evidence.bucketName === bucket.name &&
    evidence.private &&
    evidence.maxObjectBytes === bucket.maxObjectBytes &&
    JSON.stringify([...evidence.allowedMimeTypes].sort()) ===
      JSON.stringify([...bucket.allowedMimeTypes].sort())
  )
}

function frozenReceipt(receipt: SupabaseStorageIsolationReceipt): SupabaseStorageIsolationReceipt {
  Object.freeze(receipt.provider.supportedModelVersions)
  Object.freeze(receipt.provider.capabilities)
  Object.freeze(receipt.provider.permissions)
  Object.freeze(receipt.provider.outputKinds)
  Object.freeze(receipt.provider)
  for (const check of receipt.checks) Object.freeze(check)
  Object.freeze(receipt.checks)
  Object.freeze(receipt.remoteOperationIds)
  Object.freeze(receipt.residualObjectPaths)
  return Object.freeze(receipt)
}

function baseReceipt(
  input: CreateSupabaseStorageIsolationVerificationInput,
  checked: CheckedInput,
  actors: SupabaseStorageActorEvidence,
  bucketEvidence: SupabaseStorageBucketEvidence,
  checkedAt: string
) {
  return {
    format: 'openpencil.supabase-storage-isolation-receipt' as const,
    version: 1 as const,
    verificationId: input.verificationId,
    environment: checked.authority.environment,
    projectRef: checked.authority.projectRef,
    accountId: checked.authority.accountId,
    grantGeneration: checked.authority.grantGeneration,
    provider: {
      ...checked.authority.provider,
      supportedModelVersions: [...checked.authority.provider.supportedModelVersions],
      capabilities: [...checked.authority.provider.capabilities],
      permissions: [...checked.authority.provider.permissions],
      outputKinds: [...checked.authority.provider.outputKinds]
    },
    applicationDigest: checked.authority.applicationDigest,
    storagePolicyArtifactDigest: checked.authority.storagePolicyArtifactDigest,
    bucketId: checked.bucket.id,
    bucketName: checked.bucket.name,
    ruleId: checked.rule.id,
    principal: checked.rule.principal.kind,
    actorEvidenceDigest: digest(actors.evidenceDigest),
    bucketEvidenceDigest: digest(bucketEvidence.evidenceDigest),
    checkedAt
  }
}

function terminalStatus(
  succeeded: boolean,
  cleanupRequired: boolean
): Pick<SupabaseStorageIsolationReceipt, 'outcome' | 'failureCode'> {
  if (succeeded) return { outcome: 'succeeded', failureCode: null }
  if (cleanupRequired) return { outcome: 'outcome-unknown', failureCode: 'cleanup-required' }
  return { outcome: 'failed', failureCode: 'policy-check-failed' }
}

export function createSupabaseStorageIsolationVerification(
  input: CreateSupabaseStorageIsolationVerificationInput
): SupabaseStorageIsolationVerificationSession {
  let currentState: SupabaseStorageIsolationState = 'not-dispatched'
  let operation: Promise<SupabaseStorageIsolationReceipt> | undefined

  const verify = (): Promise<SupabaseStorageIsolationReceipt> => {
    if (operation) return operation
    operation = (async () => {
      const checked = await checkedInput(input)
      await input.transport.recheckAuthority(checked.authority)
      const bucketEvidence = await input.transport.inspectBucket({
        projectRef: checked.authority.projectRef,
        bucketName: checked.bucket.name
      })
      if (!bucketEvidenceMatches(bucketEvidence, checked.bucket)) {
        return fail('invalid-response')
      }
      stableId(bucketEvidence.operationId)
      digest(bucketEvidence.evidenceDigest)
      let actors = await input.transport.resolveActors({
        projectRef: checked.authority.projectRef,
        bucketName: checked.bucket.name,
        rule: checked.rule
      })
      const userAId = safePartition(actors.userAId)
      const userBId = safePartition(actors.userBId)
      const allowedPartition = safePartition(actors.allowedPartition)
      const deniedPartition = safePartition(actors.deniedPartition)
      stableId(actors.operationId)
      digest(actors.evidenceDigest)
      if (
        userAId === userBId ||
        allowedPartition === deniedPartition ||
        (checked.rule.principal.kind === 'owner' && allowedPartition !== userAId)
      ) {
        return fail('invalid-response')
      }

      const suffix = input.verificationId.replaceAll('.', '-').replaceAll('_', '-').slice(0, 72)
      const root = [...checked.rule.prefix, allowedPartition]
      const objectPath = safePath([...root, `probe-${suffix}.bin`])
      const secondUserCreatePath = safePath([...root, `probe-b-${suffix}.bin`])
      const escapedPath = safePath([
        ...checked.rule.prefix,
        deniedPartition,
        `probe-escape-${suffix}.bin`
      ])
      const mimePath = safePath([...root, `probe-mime-${suffix}.bin`])
      const sizePath = safePath([...root, `probe-size-${suffix}.bin`])
      const mimeType = allowedMimeType(checked.bucket)
      const invalidMimeType = deniedMimeType(checked.bucket)
      const payload = new Uint8Array(Math.min(32, checked.bucket.maxObjectBytes))
      payload.fill(65)
      const oversizedPayload =
        checked.bucket.maxObjectBytes + 1 <= SUPABASE_STORAGE_ISOLATION_LIMITS.maxProbePayloadBytes
          ? new Uint8Array(checked.bucket.maxObjectBytes + 1)
          : null
      const checks: SupabaseStorageIsolationCheck[] = []
      const remoteOperationIds = [bucketEvidence.operationId, actors.operationId]
      const residualObjectPaths = new Set<string>()
      const potentialResidualObjectPaths = Object.freeze(
        [
          objectPath,
          secondUserCreatePath,
          escapedPath,
          mimePath,
          ...(oversizedPayload ? [sizePath] : [])
        ]
          .filter((path, index, paths) => paths.indexOf(path) === index)
          .sort((left, right) => left.localeCompare(right, 'en'))
      )

      const currentResidualObjectPaths = (): readonly string[] =>
        Object.freeze(
          [...residualObjectPaths].sort((left, right) => left.localeCompare(right, 'en'))
        )

      const run = async (
        check: SupabaseStorageIsolationCheckId,
        expected: 'allowed' | 'denied',
        probe: SupabaseStorageObjectProbeInput
      ): Promise<void> => {
        if (checks.length >= SUPABASE_STORAGE_ISOLATION_LIMITS.maxOperationCount) {
          return fail('invalid-probe')
        }
        currentState = 'dispatched'
        const mayCreate = probe.operation === 'create' || probe.operation === 'upsert'
        const wasKnown = residualObjectPaths.has(probe.objectPath)
        // A write may have reached Storage even when the transport later becomes ambiguous.
        // Record the path before dispatch and remove it only after a conclusive denial or delete.
        if (mayCreate) residualObjectPaths.add(probe.objectPath)
        const result = await input.transport.probeObject(probe)
        const normalized = checkResult(result, expected, check, probe.actor)
        checks.push(Object.freeze({ check, ...normalized }))
        remoteOperationIds.push(normalized.operationId)
        if (mayCreate && result.outcome === 'denied' && !wasKnown) {
          residualObjectPaths.delete(probe.objectPath)
        }
        if (probe.operation === 'delete' && result.outcome === 'allowed') {
          residualObjectPaths.delete(probe.objectPath)
        }
        await input.onProgress?.(
          Object.freeze({
            verificationId: input.verificationId,
            projectRef: checked.authority.projectRef,
            bucketId: checked.bucket.id,
            bucketName: checked.bucket.name,
            ruleId: checked.rule.id,
            remoteOperationIds: Object.freeze([...remoteOperationIds]),
            residualObjectPaths: currentResidualObjectPaths()
          })
        )
      }

      await input.beforeDispatch?.(
        Object.freeze({
          verificationId: input.verificationId,
          projectRef: checked.authority.projectRef,
          bucketId: checked.bucket.id,
          bucketName: checked.bucket.name,
          ruleId: checked.rule.id,
          actorEvidenceDigest: actors.evidenceDigest,
          bucketEvidenceDigest: bucketEvidence.evidenceDigest,
          potentialResidualObjectPaths
        })
      )

      try {
        // The Host durable claim is now present. Recheck the local binding and live project one
        // final time immediately before the first object probe, which may be a Storage POST.
        await input.transport.recheckAuthority(checked.authority)
      } catch {
        return frozenReceipt({
          ...baseReceipt(input, checked, actors, bucketEvidence, canonicalTimestamp(input.now())),
          checks,
          remoteOperationIds,
          residualObjectPaths: currentResidualObjectPaths(),
          dispatch: 'not-dispatched',
          outcome: 'failed',
          failureCode: 'authority-recheck-failed'
        })
      }

      try {
        await run('owner-create', 'allowed', {
          actor: 'user-a',
          operation: 'create',
          bucketName: checked.bucket.name,
          objectPath,
          mimeType,
          content: payload
        })
        await run('owner-read', 'allowed', {
          actor: 'user-a',
          operation: 'read',
          bucketName: checked.bucket.name,
          objectPath,
          mimeType,
          content: null
        })
        await run('owner-update', 'allowed', {
          actor: 'user-a',
          operation: 'update',
          bucketName: checked.bucket.name,
          objectPath,
          mimeType,
          content: payload
        })
        await run('owner-upsert', 'allowed', {
          actor: 'user-a',
          operation: 'upsert',
          bucketName: checked.bucket.name,
          objectPath,
          mimeType,
          content: payload
        })
        await run('anonymous-read-denied', 'denied', {
          actor: 'anonymous',
          operation: 'read',
          bucketName: checked.bucket.name,
          objectPath,
          mimeType,
          content: null
        })
        await run('second-user-read-denied', 'denied', {
          actor: 'user-b',
          operation: 'read',
          bucketName: checked.bucket.name,
          objectPath,
          mimeType,
          content: null
        })
        await run('second-user-update-denied', 'denied', {
          actor: 'user-b',
          operation: 'update',
          bucketName: checked.bucket.name,
          objectPath,
          mimeType,
          content: payload
        })
        await run('second-user-delete-denied', 'denied', {
          actor: 'user-b',
          operation: 'delete',
          bucketName: checked.bucket.name,
          objectPath,
          mimeType,
          content: null
        })
        await run('second-user-create-owner-path-denied', 'denied', {
          actor: 'user-b',
          operation: 'create',
          bucketName: checked.bucket.name,
          objectPath: secondUserCreatePath,
          mimeType,
          content: payload
        })
        await run('path-prefix-escape-denied', 'denied', {
          actor: 'user-a',
          operation: 'create',
          bucketName: checked.bucket.name,
          objectPath: escapedPath,
          mimeType,
          content: payload
        })
        await run('mime-limit-denied', 'denied', {
          actor: 'user-a',
          operation: 'create',
          bucketName: checked.bucket.name,
          objectPath: mimePath,
          mimeType: invalidMimeType,
          content: payload
        })
        if (oversizedPayload) {
          await run('size-limit-denied', 'denied', {
            actor: 'user-a',
            operation: 'create',
            bucketName: checked.bucket.name,
            objectPath: sizePath,
            mimeType,
            content: oversizedPayload
          })
        } else {
          const sizeEvidence = await input.transport.inspectBucket({
            projectRef: checked.authority.projectRef,
            bucketName: checked.bucket.name
          })
          if (!bucketEvidenceMatches(sizeEvidence, checked.bucket)) {
            return fail('invalid-response')
          }
          checks.push(
            Object.freeze({
              check: 'size-limit-denied',
              passed: true,
              evidenceDigest: digest(sizeEvidence.evidenceDigest),
              operationId: stableId(sizeEvidence.operationId)
            })
          )
          remoteOperationIds.push(stableId(sizeEvidence.operationId))
        }
        await run('owner-delete', 'allowed', {
          actor: 'user-a',
          operation: 'delete',
          bucketName: checked.bucket.name,
          objectPath,
          mimeType,
          content: null
        })
        const refreshedActors = await input.transport.resolveActors({
          projectRef: checked.authority.projectRef,
          bucketName: checked.bucket.name,
          rule: checked.rule
        })
        const refreshedUserAId = safePartition(refreshedActors.userAId)
        const refreshedUserBId = safePartition(refreshedActors.userBId)
        const refreshedAllowedPartition = safePartition(refreshedActors.allowedPartition)
        const refreshedDeniedPartition = safePartition(refreshedActors.deniedPartition)
        const refreshedOperationId = stableId(refreshedActors.operationId)
        digest(refreshedActors.evidenceDigest)
        if (
          refreshedUserAId !== userAId ||
          refreshedUserBId !== userBId ||
          refreshedAllowedPartition !== allowedPartition ||
          refreshedDeniedPartition !== deniedPartition
        ) {
          return fail('invalid-response')
        }
        actors = refreshedActors
        remoteOperationIds.push(refreshedOperationId)
      } catch {
        currentState = 'outcome-unknown'
        const cleanupRequired = residualObjectPaths.size > 0
        return frozenReceipt({
          ...baseReceipt(input, checked, actors, bucketEvidence, canonicalTimestamp(input.now())),
          checks,
          remoteOperationIds,
          residualObjectPaths: currentResidualObjectPaths(),
          dispatch: currentState,
          outcome: 'outcome-unknown',
          failureCode: cleanupRequired ? 'cleanup-required' : 'transport-failed'
        })
      }

      const succeeded =
        checks.length === 13 &&
        checks.every((entry) => entry.passed) &&
        residualObjectPaths.size === 0
      const cleanupRequired = residualObjectPaths.size > 0
      if (cleanupRequired) currentState = 'outcome-unknown'
      const terminal = terminalStatus(succeeded, cleanupRequired)
      return frozenReceipt({
        ...baseReceipt(input, checked, actors, bucketEvidence, canonicalTimestamp(input.now())),
        checks,
        remoteOperationIds,
        residualObjectPaths: currentResidualObjectPaths(),
        dispatch: currentState,
        ...terminal
      })
    })()
    return operation
  }

  return Object.freeze({ verify, state: () => currentState })
}
