/* oxlint-disable max-lines -- V2 retains the complete V1 artifact boundary plus pre-callback authority checks. */

import {
  canonicalBackendApplicationV2Bytes,
  containsBackendSecretLikeMaterial,
  deriveBackendApplicationCapabilitiesV2,
  parseBackendApplicationSpecV2,
  type BackendCapabilityV2,
  type BackendDiagnostic,
  type BackendSecretRef
} from '@open-pencil/lowcode/backend'
import type { JSONValue } from '@open-pencil/scene-graph/primitives'

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

type BackendArtifactContentV2 = string | Uint8Array

function copyArtifactContentV2(content: BackendArtifactContentV2): BackendArtifactContentV2 {
  return typeof content === 'string' ? content : content.slice()
}

class RuntimeReadonlyBackendFilesV2 implements ReadonlyMap<string, BackendArtifactContentV2> {
  readonly #files: Map<string, BackendArtifactContentV2>

  constructor(entries: readonly (readonly [string, BackendArtifactContentV2])[]) {
    this.#files = new Map(
      entries.map(([path, content]) => [path, copyArtifactContentV2(content)] as const)
    )
    Object.freeze(this)
  }

  get size(): number {
    return this.#files.size
  }

  get [Symbol.toStringTag](): string {
    return 'ReadonlyMap'
  }

  has(path: string): boolean {
    return this.#files.has(path)
  }

  get(path: string): BackendArtifactContentV2 | undefined {
    const content = this.#files.get(path)
    return content === undefined ? undefined : copyArtifactContentV2(content)
  }

  entries(): MapIterator<[string, BackendArtifactContentV2]> {
    return new Map(
      [...this.#files].map(([path, content]) => [path, copyArtifactContentV2(content)] as const)
    ).entries()
  }

  keys(): MapIterator<string> {
    return this.#files.keys()
  }

  values(): MapIterator<BackendArtifactContentV2> {
    return new Map(
      [...this.#files].map(([path, content]) => [path, copyArtifactContentV2(content)] as const)
    ).values()
  }

  forEach(
    callback: (
      value: BackendArtifactContentV2,
      key: string,
      map: ReadonlyMap<string, BackendArtifactContentV2>
    ) => void,
    thisArg?: unknown
  ): void {
    for (const [path, content] of this.#files) {
      callback.call(thisArg, copyArtifactContentV2(content), path, this)
    }
  }

  [Symbol.iterator](): MapIterator<[string, BackendArtifactContentV2]> {
    return this.entries()
  }
}

Object.freeze(RuntimeReadonlyBackendFilesV2.prototype)

const WINDOWS_RESERVED_PATH_V2 = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu
const MEDIA_TYPE_V2 =
  /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,127}(?:;[ -~]{1,128})?$/u

function hasControlCharactersV2(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0
    if (codePoint <= 31 || codePoint === 127) return true
  }
  return false
}

function artifactPathDiagnosticV2(
  path: unknown,
  diagnosticPath: string
): BackendDiagnostic | undefined {
  if (
    typeof path !== 'string' ||
    path.length === 0 ||
    path !== path.normalize('NFC') ||
    path.startsWith('/') ||
    path.includes('\\') ||
    path.includes(':') ||
    hasControlCharactersV2(path)
  ) {
    return backendDiagnostic(
      'backend-artifact-path-invalid',
      'error',
      diagnosticPath,
      'Backend artifact paths must be relative, NFC-normalized portable POSIX paths.'
    )
  }
  const encoder = new TextEncoder()
  if (encoder.encode(path).byteLength > BACKEND_ARTIFACT_LIMITS_V2.maxPathBytes) {
    return backendDiagnostic(
      'backend-artifact-path-limit',
      'error',
      diagnosticPath,
      'Backend artifact path exceeds the byte limit.'
    )
  }
  const segments = path.split('/')
  for (const segment of segments) {
    if (
      segment.length === 0 ||
      segment === '.' ||
      segment === '..' ||
      segment.endsWith('.') ||
      segment.endsWith(' ') ||
      WINDOWS_RESERVED_PATH_V2.test(segment) ||
      encoder.encode(segment).byteLength > BACKEND_ARTIFACT_LIMITS_V2.maxPathSegmentBytes
    ) {
      return backendDiagnostic(
        'backend-artifact-path-invalid',
        'error',
        diagnosticPath,
        'Backend artifact path contains an unsafe or non-portable segment.'
      )
    }
  }
  return undefined
}

function secretKeyV2(secret: BackendSecretRef): string {
  return secret.kind === 'credential'
    ? `${secret.kind}:${secret.credentialRef}:${secret.name}`
    : `${secret.kind}:${secret.name}`
}

function requiredSecretsV2(plan: BackendProviderPlanV2): readonly BackendSecretRef[] {
  return Object.freeze(
    plan.application.secrets
      .filter((secret) => secret.required)
      .map((secret) => Object.freeze({ ...secret }))
      .sort((left, right) => secretKeyV2(left).localeCompare(secretKeyV2(right), 'en'))
  )
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
  const invalid = artifactPathDiagnosticV2(path, diagnosticPath)
  if (invalid) {
    collection.diagnostics.push(invalid)
    return false
  }
  const acceptedPath = path as string
  const folded = acceptedPath.toLowerCase()
  if (collection.foldedPaths.has(folded)) {
    collection.diagnostics.push(
      backendDiagnostic(
        'backend-artifact-path-conflict',
        'error',
        diagnosticPath,
        'Backend artifact path conflicts with an existing target or Provider artifact.'
      )
    )
    return false
  }
  collection.foldedPaths.add(folded)
  return true
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
  if (typeof artifact.path !== 'string') {
    collection.diagnostics.push(
      backendDiagnostic(
        'backend-artifact-path-invalid',
        'error',
        `${path}.path`,
        'Backend artifact paths must be relative, NFC-normalized portable POSIX paths.'
      )
    )
    return
  }
  if (containsBackendSecretLikeMaterial(artifact.path)) {
    collection.diagnostics.push(
      backendDiagnostic(
        'backend-artifact-metadata-secret-material-forbidden',
        'error',
        `${path}.path`,
        'Backend Provider artifact metadata cannot contain credential or secret material.'
      )
    )
    return
  }
  if (!reserveArtifactPathV2(collection, artifact.path, `${path}.path`)) return
  if (
    !adapter.outputs.includes(artifact.kind) ||
    !bundle.descriptor.outputs.includes(artifact.kind)
  ) {
    collection.diagnostics.push(
      backendDiagnostic(
        'backend-artifact-output-undeclared',
        'error',
        `${path}.kind`,
        'Backend Provider emitted an artifact kind outside its exact declaration.'
      )
    )
    return
  }
  if (
    typeof artifact.mediaType === 'string' &&
    containsBackendSecretLikeMaterial(artifact.mediaType)
  ) {
    collection.diagnostics.push(
      backendDiagnostic(
        'backend-artifact-metadata-secret-material-forbidden',
        'error',
        `${path}.mediaType`,
        'Backend Provider artifact metadata cannot contain credential or secret material.'
      )
    )
    return
  }
  if (typeof artifact.mediaType !== 'string' || !MEDIA_TYPE_V2.test(artifact.mediaType)) {
    collection.diagnostics.push(
      backendDiagnostic(
        'backend-artifact-media-type-invalid',
        'error',
        `${path}.mediaType`,
        'Backend Provider artifact media type is invalid.'
      )
    )
    return
  }
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
      requiredSecrets: requiredSecretsV2(replanned.plan),
      artifacts: Object.freeze(artifacts.map(manifestEntryV2))
    }) satisfies BackendArtifactManifestV2
    const manifestContent = manifestJSONV2(manifest)
    const files = new RuntimeReadonlyBackendFilesV2(
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
