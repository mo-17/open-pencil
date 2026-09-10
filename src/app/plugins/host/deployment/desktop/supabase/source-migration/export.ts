/* oxlint-disable eslint(complexity), eslint(max-lines), typescript-eslint(no-unnecessary-condition), typescript-eslint(no-unnecessary-boolean-literal-compare) -- Runtime artifacts remain untrusted despite their static literal types; export validation and every save-boundary authority check stay fail closed. */
import {
  createSupabaseInspectedSourceMigrationLedger,
  verifySupabaseInspectedSourceMigrationLedgerIntegrity,
  type CreateSupabaseSourceMigrationBundleInputV1,
  type SupabaseSourceMigrationBundleV1,
  type SupabaseSourceMigrationFileV1
} from '@open-pencil/compiler/backend'
import {
  BACKEND_LIMITS,
  createSourceMigrationLedger,
  verifySourceMigrationLedgerIntegrity,
  type BackendReleaseProviderAuthorityV1,
  type SourceMigrationLedgerV1
} from '@open-pencil/lowcode/backend'
import type { SupabaseConfig } from '@open-pencil/scene-graph'
import { digestCanonicalManifest, encodeBase64URL } from '@open-pencil/scene-graph'

import {
  normalizeSupabaseSchemaName,
  projectRefFromSupabaseURL
} from '@/app/lowcode/supabase/management-client'
import type {
  AppBackendProviderDocumentGraph,
  PreparedAppBackendProviderBuild
} from '@/app/plugins/host/backend-provider'
import { validateProjectArchivePath } from '@/app/plugins/host/project-archive'
import type { PluginFileExportDestination } from '@/app/plugins/host/source-exporter-runtime'

import type { DesktopSupabaseBackendReviewResult } from '../backend/review'
import {
  isDesktopSupabaseBackendTarget,
  type DesktopSupabaseBackendTarget
} from '../backend/target'

type MaybePromise<T> = T | Promise<T>

const MIGRATION_NAME = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u
const LEDGER_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,126}[A-Za-z0-9])?$/u
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u
const SOURCE_MIGRATION_PATH = /^supabase\/migrations\/\d{14}_[a-z0-9-]+\.sql$/u
const INSPECTED_SOURCE_LEDGER_PATH = 'supabase/openpencil-inspected-source-ledger.json'
const PROMOTION_LEDGER_PATH = 'supabase/openpencil-migration-ledger.json'

export const SUPABASE_SOURCE_MIGRATION_EXPORT_MANIFEST_PATH =
  'supabase/openpencil-source-migration-export.json' as const
export const MAX_SUPABASE_SOURCE_LEDGER_IMPORT_BYTES = BACKEND_LIMITS.maxCanonicalBytes

export type DesktopSupabaseSourceMigrationExportErrorCode =
  | 'aborted'
  | 'already-running'
  | 'backend-provider-missing'
  | 'backend-provider-unavailable'
  | 'bundle-invalid'
  | 'desktop-required'
  | 'export-failed'
  | 'invalid-config'
  | 'invalid-ledger'
  | 'invalid-name'
  | 'outcome-unknown'
  | 'review-not-ready'
  | 'review-stale'

const ERROR_MESSAGES = Object.freeze({
  aborted: 'Supabase source migration export was cancelled before saving started.',
  'already-running': 'A Supabase source migration export is already running.',
  'backend-provider-missing': 'This document has no Backend Provider declaration to export.',
  'backend-provider-unavailable':
    'The declared Supabase Backend Provider is unavailable or its authority changed.',
  'bundle-invalid': 'The trusted compiler rejected or returned an invalid source migration bundle.',
  'desktop-required': 'Supabase source migration export is available only in the desktop app.',
  'export-failed': 'Supabase source migration export failed before a complete save was confirmed.',
  'invalid-config': 'A canonical Supabase project URL and public schema are required.',
  'invalid-ledger':
    'The imported Supabase source migration ledger is invalid or exceeds its limit.',
  'invalid-name': 'Migration name must be a lowercase source-control slug.',
  'outcome-unknown':
    'Saving started, but completion or final local authority could not be confirmed. Inspect the selected destination before retrying.',
  'review-not-ready': 'The Supabase review still has blockers and cannot be exported.',
  'review-stale': 'The reviewed document, configuration, build, or Provider authority changed.'
} satisfies Readonly<Record<DesktopSupabaseSourceMigrationExportErrorCode, string>>)

export class DesktopSupabaseSourceMigrationExportError extends Error {
  constructor(
    readonly code: DesktopSupabaseSourceMigrationExportErrorCode,
    options?: ErrorOptions
  ) {
    super(ERROR_MESSAGES[code], options)
    this.name = 'DesktopSupabaseSourceMigrationExportError'
  }
}

export interface DesktopSupabaseSourceMigrationExportInput {
  readonly config: SupabaseConfig | undefined
  /** Live reread used at every local authority boundary. */
  readonly readConfig?: () => SupabaseConfig | undefined
  readonly graph: AppBackendProviderDocumentGraph
  readonly reviewed: DesktopSupabaseBackendReviewResult
  readonly name: string
  /** Empty text creates a new trusted inspected-source ledger for this project. */
  readonly inspectedSourceLedgerJSON?: string | null
  /** Empty text creates a new trusted promotion ledger for this project. */
  readonly promotionLedgerJSON?: string | null
  readonly signal?: AbortSignal
}

export type DesktopSupabaseSourceMigrationExportOutcome = 'succeeded' | 'cancelled'

export interface DesktopSupabaseSourceMigrationExportResult {
  readonly outcome: DesktopSupabaseSourceMigrationExportOutcome
  readonly saved: boolean
  readonly fileName: string
  readonly fileCount: number
  readonly archiveByteLength: number
  readonly migrationId: string | null
  readonly migrationPath: string | null
  readonly bundleManifestDigest: string | null
  readonly inspectedSourceLedgerHeadDigest: string | null
  readonly promotionLedgerIncluded: boolean
  readonly applyPerformed: false
  readonly deployPerformed: false
}

export interface DesktopSupabaseSourceMigrationExportDependencies {
  readonly isDesktop: () => boolean
  readonly now: () => string
  readonly nextId: () => string
  readonly prepareBuild: (
    graph: AppBackendProviderDocumentGraph,
    target: DesktopSupabaseBackendTarget
  ) => MaybePromise<PreparedAppBackendProviderBuild | null>
  readonly resolveBackendProviderAuthority: (
    build: PreparedAppBackendProviderBuild
  ) => MaybePromise<BackendReleaseProviderAuthorityV1 | null>
  readonly createBundle: (
    input: CreateSupabaseSourceMigrationBundleInputV1
  ) => Promise<SupabaseSourceMigrationBundleV1>
  readonly archive: (
    files: ReadonlyMap<string, string | Uint8Array>,
    signal?: AbortSignal
  ) => Promise<Uint8Array>
  readonly chooseDestination: (
    fileName: string,
    signal?: AbortSignal
  ) => Promise<PluginFileExportDestination | null>
}

export interface DesktopSupabaseSourceMigrationExportService {
  exportMigration(
    input: DesktopSupabaseSourceMigrationExportInput
  ): Promise<DesktopSupabaseSourceMigrationExportResult>
}

interface NormalizedConfig {
  readonly projectRef: string
  readonly schema: 'public'
}

interface ExpectedLocalAuthority {
  readonly target: DesktopSupabaseBackendTarget
  readonly build: PreparedAppBackendProviderBuild
  readonly backendProvider: BackendReleaseProviderAuthorityV1
  readonly documentDigest: string
  readonly config: NormalizedConfig
  readonly reviewed: DesktopSupabaseBackendReviewResult
}

interface ResolvedLedgers {
  readonly sourceLedger: unknown
  readonly promotionLedger: SourceMigrationLedgerV1
}

interface ExportFileReference {
  readonly kind: SupabaseSourceMigrationFileV1['kind']
  readonly path: string
  readonly mediaType: SupabaseSourceMigrationFileV1['mediaType']
  readonly byteLength: number
  readonly digest: string
}

export interface SupabaseSourceMigrationHostExportManifestV1 {
  readonly format: 'openpencil.supabase-source-migration-host-export.v1'
  readonly version: 1
  readonly providerId: 'supabase'
  readonly environment: 'staging'
  readonly bundleManifestDigest: string
  readonly bundleManifest: SupabaseSourceMigrationBundleV1['manifest']
  readonly files: readonly ExportFileReference[]
}

function error(
  code: DesktopSupabaseSourceMigrationExportErrorCode,
  cause?: unknown
): DesktopSupabaseSourceMigrationExportError {
  return new DesktopSupabaseSourceMigrationExportError(
    code,
    cause === undefined ? undefined : { cause }
  )
}

function fail(code: DesktopSupabaseSourceMigrationExportErrorCode, cause?: unknown): never {
  throw error(code, cause)
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) fail('aborted')
}

function normalizedConfig(value: SupabaseConfig | undefined): NormalizedConfig | null {
  try {
    const projectRef = projectRefFromSupabaseURL(value?.url ?? '')
    const schema = normalizeSupabaseSchemaName(value?.schema)
    return schema === 'public' ? Object.freeze({ projectRef, schema }) : null
  } catch {
    return null
  }
}

function sameAuthority(
  left: BackendReleaseProviderAuthorityV1,
  right: BackendReleaseProviderAuthorityV1
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function sameBuild(
  left: PreparedAppBackendProviderBuild,
  right: PreparedAppBackendProviderBuild
): boolean {
  return (
    JSON.stringify(left.request) === JSON.stringify(right.request) &&
    left.plan.applicationDigest === right.plan.applicationDigest &&
    left.plan.planDigest === right.plan.planDigest &&
    left.emission.manifestDigest === right.emission.manifestDigest
  )
}

function snapshot<T>(value: T, code: DesktopSupabaseSourceMigrationExportErrorCode): T {
  try {
    return structuredClone(value)
  } catch (cause) {
    return fail(code, cause)
  }
}

function snapshotBuild(value: PreparedAppBackendProviderBuild): PreparedAppBackendProviderBuild {
  try {
    const files = new Map(
      [...value.emission.files].map(([path, content]) => [
        path,
        typeof content === 'string' ? content : content.slice()
      ])
    )
    const cloned = structuredClone({
      request: value.request,
      descriptor: value.descriptor,
      selection: value.selection,
      plan: value.plan,
      emission: {
        manifestPath: value.emission.manifestPath,
        manifest: value.emission.manifest,
        manifestDigest: value.emission.manifestDigest,
        diagnostics: value.emission.diagnostics
      }
    })
    return Object.freeze({
      ...cloned,
      emission: Object.freeze({ ...cloned.emission, files })
    })
  } catch (cause) {
    return fail('backend-provider-unavailable', cause)
  }
}

async function backendDocumentDigest(
  graph: AppBackendProviderDocumentGraph,
  build: PreparedAppBackendProviderBuild,
  config: NormalizedConfig
): Promise<string> {
  return digestCanonicalManifest({
    format: 'openpencil.desktop-supabase-backend-review-document.v1',
    rootId: graph.rootId,
    projectRef: config.projectRef,
    schema: config.schema,
    backendProviderRequest: build.request
  })
}

// oxlint-disable-next-line eslint(complexity) -- One auditable predicate binds the complete prior review to the trusted live build.
async function assertExpectedReview(
  reviewed: DesktopSupabaseBackendReviewResult,
  expected: Readonly<{
    build: PreparedAppBackendProviderBuild
    backendProvider: BackendReleaseProviderAuthorityV1
    documentDigest: string
    config: NormalizedConfig
  }>
): Promise<void> {
  const artifact = reviewed.artifact
  const manifest = artifact.manifest
  const inspected = artifact.inspectedReview
  if (
    reviewed.reviewReady !== true ||
    reviewed.blockerCount !== 0 ||
    inspected.manifest.reviewReady !== true ||
    inspected.manifest.blockers.length !== 0
  ) {
    fail('review-not-ready')
  }
  if (
    artifact.format !== 'openpencil.supabase-backend-review-artifact.v1' ||
    artifact.version !== 1 ||
    manifest.format !== 'openpencil.supabase-backend-host-review.v1' ||
    manifest.version !== 1 ||
    manifest.environment !== 'staging' ||
    manifest.target !== expected.build.plan.target ||
    manifest.target !== expected.build.emission.manifest.target ||
    reviewed.applyAvailable !== false ||
    reviewed.applyPerformed !== false ||
    reviewed.documentDigest !== expected.documentDigest ||
    reviewed.projectRef !== expected.config.projectRef ||
    reviewed.accountId !== manifest.remoteAuthority.accountId ||
    reviewed.grantGeneration !== manifest.remoteAuthority.grantGeneration ||
    manifest.documentDigest !== expected.documentDigest ||
    manifest.remoteAuthority.projectRef !== expected.config.projectRef ||
    manifest.compiler.applicationDigest !== expected.build.plan.applicationDigest ||
    manifest.compiler.planDigest !== expected.build.plan.planDigest ||
    manifest.compiler.emissionManifestDigest !== expected.build.emission.manifestDigest ||
    manifest.inspectedReview.manifestDigest !== inspected.manifestDigest ||
    manifest.inspectedReview.migrationPlanDigest !== inspected.manifest.migrationPlanDigest ||
    manifest.inspectedReview.reviewReady !== true ||
    manifest.inspectedReview.applyAllowed !== false ||
    manifest.inspectedReview.releaseReady !== false ||
    inspected.manifest.applicationDigest !== expected.build.plan.applicationDigest ||
    inspected.manifest.applyAllowed !== false ||
    inspected.manifest.releaseReady !== false ||
    !sameAuthority(manifest.backendProvider, expected.backendProvider) ||
    (await digestCanonicalManifest(manifest)) !== artifact.manifestDigest
  ) {
    fail('review-stale')
  }
}

function parseLedgerJSON(value: string | null | undefined): unknown {
  if (value == null) return null
  if (new TextEncoder().encode(value).byteLength > MAX_SUPABASE_SOURCE_LEDGER_IMPORT_BYTES) {
    fail('invalid-ledger')
  }
  if (value.trim().length === 0) return null
  try {
    return JSON.parse(value) as unknown
  } catch (cause) {
    return fail('invalid-ledger', cause)
  }
}

async function resolveLedgers(
  input: DesktopSupabaseSourceMigrationExportInput,
  projectRef: string,
  registeredAt: string
): Promise<ResolvedLedgers> {
  const expectedSourceLedgerId = `supabase:${projectRef}:inspected`
  const expectedPromotionLedgerId = `supabase:${projectRef}:promotion`
  // Promotion events are strictly ordered after ledger creation. Seed a new
  // ledger one millisecond before this export's canonical registration event.
  const initialLedgerCreatedAt = new Date(Date.parse(registeredAt) - 1).toISOString()
  const importedSource = parseLedgerJSON(input.inspectedSourceLedgerJSON)
  const sourceLedger =
    importedSource ??
    createSupabaseInspectedSourceMigrationLedger({
      ledgerId: expectedSourceLedgerId,
      createdAt: initialLedgerCreatedAt
    })
  const verifiedSource = verifySupabaseInspectedSourceMigrationLedgerIntegrity(sourceLedger)
  if (!verifiedSource.ok || verifiedSource.value.ledgerId !== expectedSourceLedgerId) {
    fail('invalid-ledger')
  }

  const importedPromotion = parseLedgerJSON(input.promotionLedgerJSON)
  const promotionLedger =
    importedPromotion ??
    createSourceMigrationLedger({
      ledgerId: expectedPromotionLedgerId,
      createdAt: initialLedgerCreatedAt
    })
  const verifiedPromotion = await verifySourceMigrationLedgerIntegrity(promotionLedger)
  if (!verifiedPromotion.ok || verifiedPromotion.value.ledgerId !== expectedPromotionLedgerId) {
    fail('invalid-ledger')
  }
  return Object.freeze({
    sourceLedger: verifiedSource.value,
    promotionLedger: verifiedPromotion.value
  })
}

async function captureAuthority(
  dependencies: DesktopSupabaseSourceMigrationExportDependencies,
  input: DesktopSupabaseSourceMigrationExportInput,
  reviewed: DesktopSupabaseBackendReviewResult,
  config: NormalizedConfig,
  target: DesktopSupabaseBackendTarget
): Promise<ExpectedLocalAuthority> {
  let prepared: PreparedAppBackendProviderBuild | null
  try {
    prepared = await dependencies.prepareBuild(input.graph, target)
  } catch (cause) {
    return fail('backend-provider-unavailable', cause)
  }
  if (!prepared) fail('backend-provider-missing')
  if (prepared.descriptor.providerId !== 'supabase') fail('backend-provider-unavailable')
  const build = snapshotBuild(prepared)
  if (build.plan.target !== target || build.emission.manifest.target !== target) {
    fail('review-stale')
  }

  let resolved: BackendReleaseProviderAuthorityV1 | null
  try {
    resolved = await dependencies.resolveBackendProviderAuthority(prepared)
  } catch (cause) {
    return fail('backend-provider-unavailable', cause)
  }
  if (resolved?.providerId !== 'supabase') fail('backend-provider-unavailable')
  const backendProvider = snapshot(resolved, 'backend-provider-unavailable')
  const documentDigest = await backendDocumentDigest(input.graph, build, config)
  await assertExpectedReview(reviewed, { build, backendProvider, documentDigest, config })
  return Object.freeze({ target, build, backendProvider, documentDigest, config, reviewed })
}

async function revalidateAuthority(
  dependencies: DesktopSupabaseSourceMigrationExportDependencies,
  input: DesktopSupabaseSourceMigrationExportInput,
  expected: ExpectedLocalAuthority
): Promise<void> {
  throwIfAborted(input.signal)
  const config = normalizedConfig(input.readConfig?.() ?? input.config)
  let build: PreparedAppBackendProviderBuild | null
  try {
    build = await dependencies.prepareBuild(input.graph, expected.target)
  } catch (cause) {
    return fail('review-stale', cause)
  }
  if (
    !config ||
    config.projectRef !== expected.config.projectRef ||
    config.schema !== expected.config.schema ||
    !build ||
    build.plan.target !== expected.target ||
    build.emission.manifest.target !== expected.target ||
    !sameBuild(build, expected.build) ||
    (await backendDocumentDigest(input.graph, build, config)) !== expected.documentDigest
  ) {
    fail('review-stale')
  }
  let backendProvider: BackendReleaseProviderAuthorityV1 | null
  try {
    backendProvider = await dependencies.resolveBackendProviderAuthority(build)
  } catch (cause) {
    return fail('backend-provider-unavailable', cause)
  }
  if (!backendProvider || !sameAuthority(backendProvider, expected.backendProvider)) {
    fail('backend-provider-unavailable')
  }
  await assertExpectedReview(expected.reviewed, {
    build,
    backendProvider,
    documentDigest: expected.documentDigest,
    config
  })
  throwIfAborted(input.signal)
}

async function digestText(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return encodeBase64URL(new Uint8Array(digest))
}

function sameFileReference(
  file: SupabaseSourceMigrationFileV1,
  reference: Readonly<{ path: string; byteLength: number; digest: string }>
): boolean {
  return (
    file.path === reference.path &&
    file.byteLength === reference.byteLength &&
    file.digest === reference.digest
  )
}

async function validateBundle(
  bundle: SupabaseSourceMigrationBundleV1,
  expected: ExpectedLocalAuthority,
  migrationId: string,
  name: string
): Promise<void> {
  const manifest = bundle.manifest
  const migration = bundle.files.find((file) => file.kind === 'migration-sql')
  const sourceLedger = bundle.files.find((file) => file.kind === 'inspected-source-ledger')
  const promotionLedger = bundle.files.find((file) => file.kind === 'promotion-ledger')
  if (
    manifest.format !== 'openpencil.supabase-source-migration.v1' ||
    manifest.version !== 1 ||
    manifest.providerId !== 'supabase' ||
    manifest.environment !== 'staging' ||
    manifest.migrationId !== migrationId ||
    manifest.reviewManifestDigest !== expected.reviewed.artifact.inspectedReview.manifestDigest ||
    manifest.applicationDigest !== expected.build.plan.applicationDigest ||
    manifest.migrationPlanDigest !==
      expected.reviewed.artifact.inspectedReview.manifest.migrationPlanDigest ||
    manifest.emissionManifestDigest !== expected.build.emission.manifestDigest ||
    manifest.emissionPlanDigest !== expected.build.plan.planDigest ||
    (await digestCanonicalManifest(manifest)) !== bundle.manifestDigest ||
    !migration ||
    !sourceLedger ||
    migration.path !== manifest.sourceMigration.path ||
    !SOURCE_MIGRATION_PATH.test(migration.path) ||
    !migration.path.endsWith(`_${name}.sql`) ||
    sourceLedger.path !== INSPECTED_SOURCE_LEDGER_PATH ||
    !sameFileReference(migration, manifest.sourceMigration) ||
    !sameFileReference(sourceLedger, manifest.inspectedSourceLedger) ||
    !promotionLedger ||
    manifest.promotionLedger === null ||
    bundle.files.length !== 3
  ) {
    fail('bundle-invalid')
  }
  if (
    promotionLedger.path !== PROMOTION_LEDGER_PATH ||
    !sameFileReference(promotionLedger, manifest.promotionLedger) ||
    manifest.executionPlanDigest === null
  ) {
    fail('bundle-invalid')
  }

  const paths = new Set<string>()
  for (const file of bundle.files) {
    validateProjectArchivePath(file.path)
    if (paths.has(file.path) || file.path === SUPABASE_SOURCE_MIGRATION_EXPORT_MANIFEST_PATH) {
      fail('bundle-invalid')
    }
    paths.add(file.path)
    const bytes = new TextEncoder().encode(file.content)
    if (bytes.byteLength !== file.byteLength || (await digestText(file.content)) !== file.digest) {
      fail('bundle-invalid')
    }
  }
}

function hostExportFiles(
  bundle: SupabaseSourceMigrationBundleV1
): ReadonlyMap<string, string | Uint8Array> {
  const files = new Map<string, string | Uint8Array>()
  for (const file of bundle.files) files.set(file.path, file.content)
  const manifest: SupabaseSourceMigrationHostExportManifestV1 = Object.freeze({
    format: 'openpencil.supabase-source-migration-host-export.v1',
    version: 1,
    providerId: 'supabase',
    environment: 'staging',
    bundleManifestDigest: bundle.manifestDigest,
    bundleManifest: bundle.manifest,
    files: Object.freeze(
      bundle.files.map((file) =>
        Object.freeze({
          kind: file.kind,
          path: file.path,
          mediaType: file.mediaType,
          byteLength: file.byteLength,
          digest: file.digest
        })
      )
    )
  })
  files.set(
    SUPABASE_SOURCE_MIGRATION_EXPORT_MANIFEST_PATH,
    `${JSON.stringify(manifest, null, 2)}\n`
  )
  return files
}

function cancelledResult(fileName: string): DesktopSupabaseSourceMigrationExportResult {
  return Object.freeze({
    outcome: 'cancelled',
    saved: false,
    fileName,
    fileCount: 0,
    archiveByteLength: 0,
    migrationId: null,
    migrationPath: null,
    bundleManifestDigest: null,
    inspectedSourceLedgerHeadDigest: null,
    promotionLedgerIncluded: false,
    applyPerformed: false,
    deployPerformed: false
  })
}

/**
 * Credential-free source export. No dependency can read a token, Apply SQL, deploy a function, or
 * write the repository. The only side effect is the explicitly selected ZIP destination.
 */
export function createDesktopSupabaseSourceMigrationExportService(
  dependencies: DesktopSupabaseSourceMigrationExportDependencies
): DesktopSupabaseSourceMigrationExportService {
  let active = false

  return Object.freeze({
    async exportMigration(
      input: DesktopSupabaseSourceMigrationExportInput
    ): Promise<DesktopSupabaseSourceMigrationExportResult> {
      if (active) fail('already-running')
      active = true
      let saveStarted = false
      let bundleStage = false
      try {
        if (!dependencies.isDesktop()) fail('desktop-required')
        throwIfAborted(input.signal)
        if (!MIGRATION_NAME.test(input.name)) fail('invalid-name')
        const initialConfig = normalizedConfig(input.readConfig?.() ?? input.config)
        if (!initialConfig) fail('invalid-config')
        const reviewed = snapshot(input.reviewed, 'review-stale')
        const target = reviewed?.artifact?.manifest?.target
        if (!isDesktopSupabaseBackendTarget(target)) fail('review-stale')
        const expected = await captureAuthority(
          dependencies,
          input,
          reviewed,
          initialConfig,
          target
        )

        const registeredAt = dependencies.now()
        const migrationId = dependencies.nextId()
        if (!TIMESTAMP.test(registeredAt) || !LEDGER_ID.test(migrationId)) fail('export-failed')
        const ledgers = await resolveLedgers(input, initialConfig.projectRef, registeredAt)
        throwIfAborted(input.signal)

        const fileName = `openpencil-supabase-migration-${input.name}.zip`
        const destination = await dependencies.chooseDestination(fileName, input.signal)
        throwIfAborted(input.signal)
        if (!destination) return cancelledResult(fileName)

        await revalidateAuthority(dependencies, input, expected)
        bundleStage = true
        const executionPlan = reviewed.artifact.inspectedReview.manifest.stagedExecutionPlan
        const bundleInput: CreateSupabaseSourceMigrationBundleInputV1 = {
          reviewed: reviewed.artifact.inspectedReview,
          ledger: ledgers.promotionLedger,
          sourceLedger: ledgers.sourceLedger,
          application: expected.build.request.application,
          emission: expected.build.emission,
          migrationId,
          name: input.name,
          registeredAt,
          ...(executionPlan ? { executionPlan } : {})
        }
        const bundle = await dependencies.createBundle(bundleInput)
        await validateBundle(bundle, expected, migrationId, input.name)
        bundleStage = false
        const files = hostExportFiles(bundle)
        const archive = await dependencies.archive(files, input.signal)
        throwIfAborted(input.signal)

        // A user can leave the save panel or archive operation open while editing the document.
        // Rebuild immediately before the first destination write, then once more after it settles.
        await revalidateAuthority(dependencies, input, expected)
        saveStarted = true
        const saved = (await destination.write(archive, input.signal)) ?? true
        await revalidateAuthority(dependencies, input, expected)
        if (!saved) return cancelledResult(fileName)
        return Object.freeze({
          outcome: 'succeeded',
          saved: true,
          fileName,
          fileCount: files.size,
          archiveByteLength: archive.byteLength,
          migrationId,
          migrationPath: bundle.manifest.sourceMigration.path,
          bundleManifestDigest: bundle.manifestDigest,
          inspectedSourceLedgerHeadDigest: bundle.sourceLedger.headDigest,
          promotionLedgerIncluded: bundle.manifest.promotionLedger !== null,
          applyPerformed: false,
          deployPerformed: false
        })
      } catch (cause) {
        if (saveStarted) {
          if (
            cause instanceof DesktopSupabaseSourceMigrationExportError &&
            cause.code === 'outcome-unknown'
          ) {
            throw cause
          }
          return fail('outcome-unknown', cause)
        }
        if (cause instanceof DesktopSupabaseSourceMigrationExportError) throw cause
        if (input.signal?.aborted) return fail('aborted', cause)
        return fail(bundleStage ? 'bundle-invalid' : 'export-failed', cause)
      } finally {
        active = false
      }
    }
  })
}
