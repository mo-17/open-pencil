/* oxlint-disable max-lines -- V2 retains the complete V1 artifact boundary plus pre-callback authority checks. */

import {
  canonicalBackendApplicationV2Bytes,
  containsBackendSecretLikeMaterial,
  deriveBackendApplicationCapabilitiesV2,
  parseBackendApplicationSpecV2,
  type BackendCapabilityV2,
  type BackendDiagnostic
} from '@open-pencil/lowcode/backend'
import type { JSONValue } from '@open-pencil/scene-graph/primitives'

import {
  RuntimeReadonlyBackendFiles,
  invalidBackendArtifactPath,
  requiredBackendArtifactSecrets,
  reserveBackendArtifactPath,
  validateBackendArtifactMetadata
} from '../artifacts'
import { backendSha256, canonicalBackendValue } from '../canonical'
import {
  backendDiagnostic,
  hasBackendErrors,
  sortBackendDiagnostics,
  unsupportedBackendCompilationModeDiagnostic
} from '../diagnostics'
import {
  BACKEND_ARTIFACT_LIMITS,
  BACKEND_ARTIFACT_MANIFEST_PATH as BACKEND_ARTIFACT_MANIFEST_PATH_V1_INTERNAL
} from '../emit'
import {
  BACKEND_ARTIFACT_MANIFEST_VERSION_V2,
  BACKEND_PROVIDER_PLAN_VERSION_V2,
  isBackendCompilationModeV2,
  type BackendArtifactManifestEntryV2,
  type BackendArtifactManifestV2,
  type BackendArtifactSourceV2,
  type BackendProviderAdapterContextV2,
  type BackendProviderAdapterV2,
  type BackendProviderBundleV2,
  type BackendProviderEmissionResultV2,
  type BackendProviderPlanV2,
  type BackendProviderSelectionV2
} from './contracts'
import {
  activeBackendProviderAdapterSlotsV2,
  backendProviderAuthorityV2,
  backendProviderPlanDigestV2,
  createBackendProviderAdapterContextV2,
  createBackendProviderPlanV2,
  sameBackendProviderAuthorityV2
} from './plan'
import type { BackendProviderRegistryV2 } from './registry'

export const BACKEND_ARTIFACT_MANIFEST_PATH_V2 = 'openpencil-backend.v2.manifest.json' as const
export const BACKEND_ARTIFACT_LIMITS_V2 = BACKEND_ARTIFACT_LIMITS

export interface EmitBackendProviderPlanInputV2 {
  readonly plan: BackendProviderPlanV2
  readonly selection: BackendProviderSelectionV2
  readonly occupiedPaths?: readonly string[]
}

interface AcceptedArtifactV2 {
  readonly path: string
  readonly kind: BackendArtifactSourceV2['kind']
  readonly mediaType: string
  readonly content: string
  readonly bytes: Uint8Array
}

interface ArtifactCollectionV2 {
  readonly artifacts: AcceptedArtifactV2[]
  readonly diagnostics: BackendDiagnostic[]
  readonly foldedPaths: Set<string>
  totalBytes: number
}

function manifestJSONV2(manifest: BackendArtifactManifestV2): string {
  return `${JSON.stringify(canonicalBackendValue(manifest, '$.artifactManifestV2'), null, 2)}\n`
}

function manifestEntryV2(artifact: AcceptedArtifactV2): BackendArtifactManifestEntryV2 {
  return Object.freeze({
    path: artifact.path,
    kind: artifact.kind,
    mediaType: artifact.mediaType,
    byteLength: artifact.bytes.byteLength,
    digest: backendSha256(artifact.bytes)
  })
}

function reserveArtifactPathV2(
  collection: ArtifactCollectionV2,
  path: unknown,
  diagnosticPath: string
): boolean {
  if (typeof path !== 'string') {
    collection.diagnostics.push(invalidBackendArtifactPath(diagnosticPath))
    return false
  }
  return reserveBackendArtifactPath(collection, path, diagnosticPath, BACKEND_ARTIFACT_LIMITS_V2)
}

type OccupiedPathSnapshotResultV2 =
  | Readonly<{ ok: true; value: readonly string[] }>
  | Readonly<{ ok: false; diagnostic: BackendDiagnostic }>

function invalidOccupiedPathsV2(message: string): OccupiedPathSnapshotResultV2 {
  return {
    ok: false,
    diagnostic: backendDiagnostic(
      'backend-artifact-occupied-paths-invalid',
      'error',
      '$.occupiedPaths',
      message
    )
  }
}

/** Snapshot untrusted occupied paths without invoking accessors or retaining mutable input. */
// oxlint-disable-next-line complexity -- Every array/meta-property branch is an intentional rejection gate.
function snapshotOccupiedPathsV2(value: unknown): OccupiedPathSnapshotResultV2 {
  if (value === undefined) return { ok: true, value: Object.freeze([]) }
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
      return invalidOccupiedPathsV2('Occupied artifact paths must be a plain array.')
    }
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length')
    if (!lengthDescriptor || !('value' in lengthDescriptor)) {
      return invalidOccupiedPathsV2('Occupied artifact path array length must be data-only.')
    }
    const length = lengthDescriptor.value
    if (
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > BACKEND_ARTIFACT_LIMITS_V2.maxOccupiedPaths
    ) {
      return {
        ok: false,
        diagnostic: backendDiagnostic(
          'backend-artifact-occupied-paths-limit',
          'error',
          '$.occupiedPaths',
          'Occupied artifact path set exceeds the configured limit.'
        )
      }
    }
    for (const key of Reflect.ownKeys(value)) {
      if (key === 'length') continue
      const index = typeof key === 'string' && /^(?:0|[1-9]\d*)$/u.test(key) ? Number(key) : -1
      if (!Number.isSafeInteger(index) || index < 0 || index >= length) {
        return invalidOccupiedPathsV2(
          'Occupied artifact paths must not contain symbols or custom properties.'
        )
      }
    }
    const snapshot: string[] = []
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
      if (
        !descriptor?.enumerable ||
        !('value' in descriptor) ||
        typeof descriptor.value !== 'string'
      ) {
        return invalidOccupiedPathsV2(
          'Occupied artifact paths must contain enumerable string data properties only.'
        )
      }
      snapshot.push(descriptor.value)
    }
    return { ok: true, value: Object.freeze(snapshot) }
  } catch {
    return invalidOccupiedPathsV2('Occupied artifact paths must be inert plain data.')
  }
}

function snapshotOccupiedPathsInputV2(
  input: EmitBackendProviderPlanInputV2
): OccupiedPathSnapshotResultV2 {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(input, 'occupiedPaths')
    if (!descriptor) return snapshotOccupiedPathsV2(undefined)
    if (!descriptor.enumerable || !('value' in descriptor)) {
      return invalidOccupiedPathsV2(
        'Occupied artifact paths must be an enumerable data property when provided.'
      )
    }
    return snapshotOccupiedPathsV2(descriptor.value)
  } catch {
    return invalidOccupiedPathsV2('Occupied artifact paths must be inert plain data.')
  }
}

function acceptArtifactV2(
  collection: ArtifactCollectionV2,
  artifact: BackendArtifactSourceV2,
  adapter: BackendProviderAdapterV2,
  bundle: BackendProviderBundleV2,
  path: string
): void {
  if (
    !validateBackendArtifactMetadata(
      collection,
      artifact,
      adapter,
      bundle,
      path,
      reserveArtifactPathV2.bind(undefined, collection)
    )
  )
    return
  const content: unknown = artifact.content
  if (content instanceof Uint8Array) {
    collection.diagnostics.push(
      backendDiagnostic(
        'backend-artifact-binary-content-forbidden',
        'error',
        `${path}.content`,
        'Backend Provider contract v2 accepts text artifacts only.'
      )
    )
    return
  }
  if (typeof content !== 'string') {
    collection.diagnostics.push(
      backendDiagnostic(
        'backend-artifact-content-invalid',
        'error',
        `${path}.content`,
        'Backend Provider artifact content must be a string or Uint8Array.'
      )
    )
    return
  }
  if (containsBackendSecretLikeMaterial(content)) {
    collection.diagnostics.push(
      backendDiagnostic(
        'backend-artifact-secret-material-forbidden',
        'error',
        `${path}.content`,
        'Backend Provider text artifacts cannot contain material that resembles a credential or secret value.'
      )
    )
    return
  }
  const bytes = new TextEncoder().encode(content)
  if (bytes.byteLength > BACKEND_ARTIFACT_LIMITS_V2.maxArtifactBytes) {
    collection.diagnostics.push(
      backendDiagnostic(
        'backend-artifact-byte-limit',
        'error',
        `${path}.content`,
        'Backend Provider artifact exceeds the per-file byte limit.'
      )
    )
    return
  }
  const nextTotalBytes = collection.totalBytes + bytes.byteLength
  if (nextTotalBytes > BACKEND_ARTIFACT_LIMITS_V2.maxTotalBytes) {
    collection.diagnostics.push(
      backendDiagnostic(
        'backend-artifact-total-byte-limit',
        'error',
        '$.artifacts',
        'Backend Provider artifacts exceed the total byte limit.'
      )
    )
    return
  }
  collection.totalBytes = nextTotalBytes
  collection.artifacts.push(
    Object.freeze({
      path: artifact.path,
      kind: artifact.kind,
      mediaType: artifact.mediaType,
      content,
      bytes
    })
  )
}

function collectAdapterArtifactsV2(
  collection: ArtifactCollectionV2,
  bundle: BackendProviderBundleV2,
  adapter: BackendProviderAdapterV2,
  adapterPlan: JSONValue,
  context: BackendProviderAdapterContextV2,
  slot: string
): void {
  let emitted: readonly BackendArtifactSourceV2[]
  try {
    emitted = adapter.emit(context, adapterPlan)
  } catch {
    collection.diagnostics.push(
      backendDiagnostic(
        'backend-provider-v2-emit-failed',
        'error',
        `$.adapterPlans.${slot}`,
        'Backend Provider V2 adapter failed to emit a trusted artifact set.'
      )
    )
    return
  }
  if (!Array.isArray(emitted)) {
    collection.diagnostics.push(
      backendDiagnostic(
        'backend-provider-v2-artifacts-invalid',
        'error',
        `$.artifacts.${slot}`,
        'Backend Provider V2 adapter must emit an array of artifacts.'
      )
    )
    return
  }
  if (collection.artifacts.length + emitted.length > BACKEND_ARTIFACT_LIMITS_V2.maxArtifacts) {
    collection.diagnostics.push(
      backendDiagnostic(
        'backend-artifact-count-limit',
        'error',
        `$.artifacts.${slot}`,
        'Backend Provider artifact count exceeds the configured limit.'
      )
    )
    return
  }
  try {
    for (let index = 0; index < emitted.length; index += 1) {
      acceptArtifactV2(collection, emitted[index], adapter, bundle, `$.artifacts.${slot}[${index}]`)
    }
  } catch {
    collection.diagnostics.push(
      backendDiagnostic(
        'backend-provider-v2-artifacts-invalid',
        'error',
        `$.artifacts.${slot}`,
        'Backend Provider V2 artifacts must be bounded inert data.'
      )
    )
  }
}

function sameActualCapabilitiesV2(
  left: readonly BackendCapabilityV2[],
  right: readonly BackendCapabilityV2[]
): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

// oxlint-disable-next-line complexity -- Verification order is security-significant and fail-closed.
export function emitBackendProviderPlanV2(
  registry: BackendProviderRegistryV2,
  input: EmitBackendProviderPlanInputV2
): BackendProviderEmissionResultV2 {
  let plan: BackendProviderPlanV2 | undefined
  let mode: unknown
  try {
    plan = input.plan
    mode = plan.mode
  } catch {
    mode = undefined
  }
  if (!plan || !isBackendCompilationModeV2(mode)) {
    return {
      ok: false,
      diagnostics: Object.freeze([unsupportedBackendCompilationModeDiagnostic()])
    }
  }
  if ((plan as { readonly version: unknown }).version !== BACKEND_PROVIDER_PLAN_VERSION_V2) {
    return {
      ok: false,
      diagnostics: Object.freeze([
        backendDiagnostic(
          'backend-provider-v2-plan-version-unsupported',
          'error',
          '$.plan.version',
          'Backend Provider V2 plan version is unsupported.'
        )
      ])
    }
  }

  try {
    if (
      backendProviderPlanDigestV2({
        version: plan.version,
        authority: plan.authority,
        application: plan.application,
        applicationDigest: plan.applicationDigest,
        target: plan.target,
        mode,
        actualCapabilities: plan.actualCapabilities,
        capabilities: plan.capabilities,
        adapterPlans: plan.adapterPlans
      }) !== plan.planDigest
    ) {
      throw new TypeError('digest mismatch')
    }
  } catch {
    return {
      ok: false,
      diagnostics: Object.freeze([
        backendDiagnostic(
          'backend-provider-v2-plan-digest-mismatch',
          'error',
          '$.plan.planDigest',
          'Backend Provider V2 plan digest does not match its canonical payload.'
        )
      ])
    }
  }

  const applicationResult = parseBackendApplicationSpecV2(plan.application)
  if (!applicationResult.ok) {
    return { ok: false, diagnostics: sortBackendDiagnostics(applicationResult.diagnostics) }
  }
  const actualCapabilities = Object.freeze([
    ...deriveBackendApplicationCapabilitiesV2(applicationResult.value)
  ])
  if (
    backendSha256(canonicalBackendApplicationV2Bytes(applicationResult.value)) !==
    plan.applicationDigest
  ) {
    return {
      ok: false,
      diagnostics: Object.freeze([
        backendDiagnostic(
          'backend-provider-v2-application-digest-mismatch',
          'error',
          '$.plan.applicationDigest',
          'Backend Provider V2 application digest does not match normalized model bytes.'
        )
      ])
    }
  }
  if (!sameActualCapabilitiesV2(actualCapabilities, plan.actualCapabilities)) {
    return {
      ok: false,
      diagnostics: Object.freeze([
        backendDiagnostic(
          'backend-provider-v2-actual-capabilities-mismatch',
          'error',
          '$.plan.actualCapabilities',
          'Backend Provider V2 actual capabilities do not match normalized IR use.'
        )
      ])
    }
  }

  let selection: BackendProviderSelectionV2
  try {
    selection = input.selection
  } catch {
    selection = undefined as never
  }
  const resolved = registry.resolve(selection)
  if (!resolved.ok) return resolved
  try {
    if (
      !sameBackendProviderAuthorityV2(
        plan.authority,
        backendProviderAuthorityV2(resolved.value.selection)
      )
    ) {
      return {
        ok: false,
        diagnostics: Object.freeze([
          backendDiagnostic(
            'backend-provider-v2-plan-stale',
            'error',
            '$.plan.authority',
            'Backend Provider V2 plan no longer matches the selected package authority.'
          )
        ])
      }
    }
  } catch {
    return {
      ok: false,
      diagnostics: Object.freeze([
        backendDiagnostic(
          'backend-provider-v2-plan-stale',
          'error',
          '$.plan.authority',
          'Backend Provider V2 plan authority is invalid.'
        )
      ])
    }
  }

  const occupiedPathsResult = snapshotOccupiedPathsInputV2(input)
  if (!occupiedPathsResult.ok) {
    return { ok: false, diagnostics: Object.freeze([occupiedPathsResult.diagnostic]) }
  }
  const occupiedPaths = occupiedPathsResult.value

  const diagnostics: BackendDiagnostic[] = []
  const replanned = createBackendProviderPlanV2(registry, {
    selection: resolved.value.selection,
    application: applicationResult.value,
    target: plan.target,
    mode
  })
  if (!replanned.ok) return replanned
  diagnostics.push(...replanned.diagnostics)
  if (replanned.plan.planDigest !== plan.planDigest) {
    return {
      ok: false,
      diagnostics: sortBackendDiagnostics([
        ...diagnostics,
        backendDiagnostic(
          'backend-provider-v2-plan-stale',
          'error',
          '$.plan',
          'Backend Provider V2 plan no longer matches the trusted registry or normalized input.'
        )
      ])
    }
  }

  const collection: ArtifactCollectionV2 = {
    artifacts: [],
    diagnostics,
    foldedPaths: new Set(),
    totalBytes: 0
  }
  for (let index = 0; index < occupiedPaths.length; index += 1) {
    reserveArtifactPathV2(collection, occupiedPaths[index], `$.occupiedPaths[${index}]`)
  }
  reserveArtifactPathV2(collection, BACKEND_ARTIFACT_MANIFEST_PATH_V1_INTERNAL, '$.manifestPathV1')
  reserveArtifactPathV2(collection, BACKEND_ARTIFACT_MANIFEST_PATH_V2, '$.manifestPath')
  if (hasBackendErrors(diagnostics)) {
    return { ok: false, diagnostics: sortBackendDiagnostics(diagnostics) }
  }

  const context = createBackendProviderAdapterContextV2(
    replanned.plan.application,
    resolved.value.selection,
    replanned.plan.target,
    replanned.plan.mode,
    replanned.plan.actualCapabilities,
    replanned.plan.capabilities
  )
  const activeSlots = activeBackendProviderAdapterSlotsV2(
    resolved.value.bundle,
    replanned.plan.capabilities,
    replanned.plan.actualCapabilities
  )
  for (const slot of activeSlots) {
    const adapter = resolved.value.bundle[slot]
    const adapterPlan = replanned.plan.adapterPlans[slot]
    if (!adapter || adapterPlan === undefined) {
      diagnostics.push(
        backendDiagnostic(
          'backend-provider-v2-plan-adapter-missing',
          'error',
          `$.adapterPlans.${slot}`,
          'Backend Provider V2 plan is missing a trusted adapter payload.'
        )
      )
      continue
    }
    collectAdapterArtifactsV2(
      collection,
      resolved.value.bundle,
      adapter,
      adapterPlan,
      context,
      slot
    )
  }
  if (hasBackendErrors(diagnostics)) {
    return { ok: false, diagnostics: sortBackendDiagnostics(diagnostics) }
  }

  try {
    const artifacts = collection.artifacts.sort((left, right) =>
      left.path.localeCompare(right.path, 'en')
    )
    const manifest = Object.freeze({
      format: 'openpencil.backend-artifacts.v2',
      version: BACKEND_ARTIFACT_MANIFEST_VERSION_V2,
      authority: replanned.plan.authority,
      applicationDigest: replanned.plan.applicationDigest,
      planDigest: replanned.plan.planDigest,
      target: replanned.plan.target,
      mode: replanned.plan.mode,
      actualCapabilities: replanned.plan.actualCapabilities,
      capabilities: replanned.plan.capabilities,
      requiredSecrets: requiredBackendArtifactSecrets(replanned.plan.application.secrets),
      artifacts: Object.freeze(artifacts.map(manifestEntryV2))
    }) satisfies BackendArtifactManifestV2
    const manifestContent = manifestJSONV2(manifest)
    const files = new RuntimeReadonlyBackendFiles(
      [
        ...artifacts.map((artifact) => [artifact.path, artifact.content] as const),
        [BACKEND_ARTIFACT_MANIFEST_PATH_V2, manifestContent] as const
      ].sort(([left], [right]) => left.localeCompare(right, 'en'))
    )
    return {
      ok: true,
      emission: Object.freeze({
        files,
        manifestPath: BACKEND_ARTIFACT_MANIFEST_PATH_V2,
        manifest,
        manifestDigest: backendSha256(manifestContent),
        diagnostics: sortBackendDiagnostics(diagnostics)
      })
    }
  } catch {
    return {
      ok: false,
      diagnostics: sortBackendDiagnostics([
        ...diagnostics,
        backendDiagnostic(
          'backend-provider-v2-manifest-invalid',
          'error',
          '$.manifest',
          'Backend Provider V2 manifest exceeded the canonical data boundary.'
        )
      ])
    }
  }
}
