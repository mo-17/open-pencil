import {
  containsBackendSecretLikeMaterial,
  type BackendDiagnostic
} from '@open-pencil/lowcode/backend'
import type { JSONValue } from '@open-pencil/scene-graph/primitives'

import {
  RuntimeReadonlyBackendFiles,
  requiredBackendArtifactSecrets,
  reserveBackendArtifactPath,
  validateBackendArtifactMetadata
} from './artifacts'
import { backendSha256, canonicalBackendValue } from './canonical'
import type {
  BackendArtifactManifestEntry,
  BackendArtifactManifestV1,
  BackendArtifactSource,
  BackendProviderAdapter,
  BackendProviderAdapterContext,
  BackendProviderBundle,
  BackendProviderEmissionResult,
  BackendProviderPlan,
  BackendProviderSelection
} from './contracts'
import { BACKEND_ARTIFACT_MANIFEST_VERSION, isBackendCompilationMode } from './contracts'
import {
  backendDiagnostic,
  hasBackendErrors,
  sortBackendDiagnostics,
  unsupportedBackendCompilationModeDiagnostic
} from './diagnostics'
import { isReviewedNestJSPresetLockArtifact } from './nestjs/preset-lock'
import { isReviewedPrismaCRMPresetLockArtifact } from './nestjs/prisma-crm/project'
import {
  activeBackendProviderAdapterSlots,
  backendProviderPlanDigest,
  createBackendProviderAdapterContext,
  createBackendProviderPlan
} from './plan'
import type { BackendProviderRegistry } from './registry'

export const BACKEND_ARTIFACT_MANIFEST_PATH = 'openpencil-backend.manifest.json' as const

export const BACKEND_ARTIFACT_LIMITS = Object.freeze({
  maxArtifacts: 512,
  maxArtifactBytes: 4 * 1024 * 1024,
  maxTotalBytes: 16 * 1024 * 1024,
  maxPathBytes: 512,
  maxPathSegmentBytes: 255,
  maxOccupiedPaths: 4096
})

export interface EmitBackendProviderPlanInput {
  readonly plan: BackendProviderPlan
  readonly selection: BackendProviderSelection
  readonly occupiedPaths?: readonly string[]
}

interface AcceptedArtifact {
  readonly path: string
  readonly kind: BackendArtifactSource['kind']
  readonly mediaType: string
  readonly content: string | Uint8Array
  readonly bytes: Uint8Array
}
interface ArtifactCollection {
  readonly artifacts: AcceptedArtifact[]
  readonly diagnostics: BackendDiagnostic[]
  readonly foldedPaths: Set<string>
  totalBytes: number
}
function manifestJSON(manifest: BackendArtifactManifestV1): string {
  return `${JSON.stringify(canonicalBackendValue(manifest, '$.artifactManifest'), null, 2)}\n`
}

function manifestEntry(artifact: AcceptedArtifact): BackendArtifactManifestEntry {
  return Object.freeze({
    path: artifact.path,
    kind: artifact.kind,
    mediaType: artifact.mediaType,
    byteLength: artifact.bytes.byteLength,
    digest: backendSha256(artifact.bytes)
  })
}

function reserveArtifactPath(
  collection: ArtifactCollection,
  path: string,
  diagnosticPath: string
): boolean {
  return reserveBackendArtifactPath(collection, path, diagnosticPath, BACKEND_ARTIFACT_LIMITS)
}

function acceptArtifact(
  collection: ArtifactCollection,
  emittedArtifact: BackendArtifactSource,
  adapter: BackendProviderAdapter,
  bundle: BackendProviderBundle,
  path: string
): void {
  const metadata = {
    path: emittedArtifact.path,
    kind: emittedArtifact.kind,
    mediaType: emittedArtifact.mediaType
  }
  if (
    !validateBackendArtifactMetadata(
      collection,
      metadata,
      adapter,
      bundle,
      path,
      reserveArtifactPath.bind(undefined, collection)
    )
  )
    return
  // Admission and storage share the same snapshot, including for reviewed static source bytes.
  const artifact = { ...metadata, content: emittedArtifact.content }
  let content: string | Uint8Array
  let bytes: Uint8Array
  if (typeof artifact.content === 'string') {
    if (
      containsBackendSecretLikeMaterial(artifact.content) &&
      !isReviewedNestJSPresetLockArtifact(artifact, bundle.descriptor) &&
      !isReviewedPrismaCRMPresetLockArtifact(artifact, bundle.descriptor)
    ) {
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
    content = artifact.content
    bytes = new TextEncoder().encode(artifact.content)
  } else if (artifact.content instanceof Uint8Array) {
    collection.diagnostics.push(
      backendDiagnostic(
        'backend-artifact-binary-content-forbidden',
        'error',
        `${path}.content`,
        'Backend Provider contract v1 accepts text artifacts only.'
      )
    )
    return
  } else {
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
  if (bytes.byteLength > BACKEND_ARTIFACT_LIMITS.maxArtifactBytes) {
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
  if (nextTotalBytes > BACKEND_ARTIFACT_LIMITS.maxTotalBytes) {
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

function collectAdapterArtifacts(
  collection: ArtifactCollection,
  bundle: BackendProviderBundle,
  adapter: BackendProviderAdapter,
  adapterPlan: JSONValue,
  context: BackendProviderAdapterContext,
  slot: string
): void {
  let emitted: readonly BackendArtifactSource[]
  try {
    emitted = adapter.emit(context, adapterPlan)
  } catch {
    collection.diagnostics.push(
      backendDiagnostic(
        'backend-provider-emit-failed',
        'error',
        `$.adapterPlans.${slot}`,
        'Backend Provider adapter failed to emit a trusted artifact set.'
      )
    )
    return
  }
  if (!Array.isArray(emitted)) {
    collection.diagnostics.push(
      backendDiagnostic(
        'backend-provider-artifacts-invalid',
        'error',
        `$.artifacts.${slot}`,
        'Backend Provider adapter must emit an array of artifacts.'
      )
    )
    return
  }
  if (collection.artifacts.length + emitted.length > BACKEND_ARTIFACT_LIMITS.maxArtifacts) {
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
  for (let index = 0; index < emitted.length; index += 1) {
    acceptArtifact(collection, emitted[index], adapter, bundle, `$.artifacts.${slot}[${index}]`)
  }
}

export function emitBackendProviderPlan(
  registry: BackendProviderRegistry,
  input: EmitBackendProviderPlanInput
): BackendProviderEmissionResult {
  let plan: BackendProviderPlan | undefined, mode: unknown
  try {
    plan = input.plan
    mode = plan.mode
  } catch {
    mode = undefined
  }
  if (!plan || !isBackendCompilationMode(mode)) {
    return { ok: false, diagnostics: [unsupportedBackendCompilationModeDiagnostic()] }
  }

  const diagnostics: BackendDiagnostic[] = []
  if (
    backendProviderPlanDigest({
      version: plan.version,
      authority: plan.authority,
      application: plan.application,
      applicationDigest: plan.applicationDigest,
      target: plan.target,
      mode,
      capabilities: plan.capabilities,
      adapterPlans: plan.adapterPlans
    }) !== plan.planDigest
  ) {
    return {
      ok: false,
      diagnostics: [
        backendDiagnostic(
          'backend-provider-plan-digest-mismatch',
          'error',
          '$.plan.planDigest',
          'Backend Provider plan digest does not match its canonical payload.'
        )
      ]
    }
  }

  const replanned = createBackendProviderPlan(registry, {
    selection: input.selection,
    application: plan.application,
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
          'backend-provider-plan-stale',
          'error',
          '$.plan',
          'Backend Provider plan no longer matches the trusted registry, package, or normalized input.'
        )
      ])
    }
  }

  const resolved = registry.resolve(input.selection)
  if (!resolved.ok) return resolved
  const occupiedPaths = input.occupiedPaths ?? []
  if (occupiedPaths.length > BACKEND_ARTIFACT_LIMITS.maxOccupiedPaths) {
    return {
      ok: false,
      diagnostics: [
        backendDiagnostic(
          'backend-artifact-occupied-paths-limit',
          'error',
          '$.occupiedPaths',
          'Occupied artifact path set exceeds the configured limit.'
        )
      ]
    }
  }

  const collection: ArtifactCollection = {
    artifacts: [],
    diagnostics,
    foldedPaths: new Set(),
    totalBytes: 0
  }
  for (let index = 0; index < occupiedPaths.length; index += 1) {
    reserveArtifactPath(collection, occupiedPaths[index], `$.occupiedPaths[${index}]`)
  }
  reserveArtifactPath(collection, BACKEND_ARTIFACT_MANIFEST_PATH, '$.manifestPath')
  if (hasBackendErrors(diagnostics)) {
    return { ok: false, diagnostics: sortBackendDiagnostics(diagnostics) }
  }

  const context = createBackendProviderAdapterContext(
    replanned.plan.application,
    resolved.value.selection,
    replanned.plan.target,
    replanned.plan.mode,
    replanned.plan.capabilities
  )
  const activeSlots = activeBackendProviderAdapterSlots(
    resolved.value.bundle,
    replanned.plan.capabilities
  )
  for (const slot of activeSlots) {
    const adapter = resolved.value.bundle[slot]
    const adapterPlan = replanned.plan.adapterPlans[slot]
    if (!adapter || adapterPlan === undefined) {
      diagnostics.push(
        backendDiagnostic(
          'backend-provider-plan-adapter-missing',
          'error',
          `$.adapterPlans.${slot}`,
          'Backend Provider plan is missing a trusted adapter payload.'
        )
      )
      continue
    }
    collectAdapterArtifacts(collection, resolved.value.bundle, adapter, adapterPlan, context, slot)
  }
  if (hasBackendErrors(diagnostics)) {
    return { ok: false, diagnostics: sortBackendDiagnostics(diagnostics) }
  }

  const artifacts = collection.artifacts.sort((left, right) =>
    left.path.localeCompare(right.path, 'en')
  )
  const manifest = Object.freeze({
    format: 'openpencil.backend-artifacts.v1',
    version: BACKEND_ARTIFACT_MANIFEST_VERSION,
    authority: replanned.plan.authority,
    applicationDigest: replanned.plan.applicationDigest,
    planDigest: replanned.plan.planDigest,
    target: replanned.plan.target,
    mode: replanned.plan.mode,
    capabilities: replanned.plan.capabilities,
    requiredSecrets: requiredBackendArtifactSecrets(replanned.plan.application.secrets),
    artifacts: Object.freeze(artifacts.map(manifestEntry))
  }) satisfies BackendArtifactManifestV1
  const manifestContent = manifestJSON(manifest)
  const files = new RuntimeReadonlyBackendFiles(
    [
      ...artifacts.map((artifact) => [artifact.path, artifact.content] as const),
      [BACKEND_ARTIFACT_MANIFEST_PATH, manifestContent] as const
    ].sort(([left], [right]) => left.localeCompare(right, 'en'))
  )
  return {
    ok: true,
    emission: Object.freeze({
      files,
      manifestPath: BACKEND_ARTIFACT_MANIFEST_PATH,
      manifest,
      manifestDigest: backendSha256(manifestContent),
      diagnostics: sortBackendDiagnostics(diagnostics)
    })
  }
}
