/* eslint-disable max-lines -- Destination, authority, archive, cancellation, and tamper cases share one Host export fixture. */
import { describe, expect, test } from 'bun:test'

import { unzipSync } from 'fflate'

import {
  createSupabaseInspectedMigrationReview,
  createSupabaseInspectedMigrationSnapshot,
  createSupabaseSourceMigrationBundle,
  type CreateSupabaseSourceMigrationBundleInputV1,
  type SupabaseInspectedMigrationReviewV1,
  type SupabaseSourceMigrationBundleV1,
  type SupabaseSourceMigrationFileV1
} from '@open-pencil/compiler/backend'
import {
  createSourceMigrationLedger,
  type BackendApplicationSpecV1,
  type BackendReleaseProviderAuthorityV1
} from '@open-pencil/lowcode/backend'
import { digestCanonicalManifest, encodeBase64URL } from '@open-pencil/scene-graph'

import {
  createAppPluginStore,
  createBundledPluginCatalog,
  createMemoryAppPluginStateStorage,
  type AppBundlePluginCatalogEntry
} from '@/app/plugins'
import {
  APP_BACKEND_PROVIDER_DOCUMENT_KEY,
  APP_BACKEND_PROVIDER_DOCUMENT_PLUGIN_ID,
  APP_BACKEND_PROVIDER_REQUEST_FORMAT,
  SUPABASE_BACKEND_PROVIDER_PLUGIN_ID,
  listAppBackendProviderDescriptors,
  prepareAppBackendProviderBuild,
  appBackendProviderDocumentValue,
  type AppBackendProviderDocumentGraph,
  type PreparedAppBackendProviderBuild
} from '@/app/plugins/host/backend-provider'
import type { DesktopSupabaseBackendReviewResult } from '@/app/plugins/host/deployment/desktop/supabase/backend/review'
import { createAppDesktopSupabaseBackendReviewServiceForTestingV1 } from '@/app/plugins/host/deployment/desktop/supabase/backend/review-app'
import type { DesktopSupabaseBackendTarget } from '@/app/plugins/host/deployment/desktop/supabase/backend/target'
import {
  MAX_SUPABASE_SOURCE_LEDGER_IMPORT_BYTES,
  SUPABASE_SOURCE_MIGRATION_EXPORT_MANIFEST_PATH,
  createDesktopSupabaseSourceMigrationExportService,
  DesktopSupabaseSourceMigrationExportError,
  type DesktopSupabaseSourceMigrationExportDependencies
} from '@/app/plugins/host/deployment/desktop/supabase/source-migration/export'
import { createAppDesktopSupabaseSourceMigrationExportService } from '@/app/plugins/host/deployment/desktop/supabase/source-migration/export-app'
import type { SupabaseBackendReleaseReviewArtifactV1 } from '@/app/plugins/host/deployment/supabase/backend-release'

const PROJECT_REF = 'enekobitnhobuiuamvqj'
const PROJECT_URL = `https://${PROJECT_REF}.supabase.co`
const ACCOUNT_ID = 'organization-1'
const GRANT_GENERATION = '123e4567-e89b-42d3-a456-426614174000'
const NOW = '2026-09-03T02:00:00.000Z'
const MIGRATION_ID = '123e4567-e89b-42d3-a456-426614174001'
const NAME = 'add-tasks'
interface HostExportManifestFixture {
  readonly format: string
  readonly bundleManifestDigest: string
  readonly files: readonly unknown[]
}

function asFixture<T>(value: object): T {
  return value as T
}

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`Missing ${label}`)
  return value
}

const AUTHORITY: BackendReleaseProviderAuthorityV1 = Object.freeze({
  publisherId: 'open-pencil',
  packageDigest: 'package-digest',
  pluginId: 'open-pencil.supabase-backend',
  contributionId: 'supabase.backend',
  providerId: 'supabase',
  adapterId: 'open-pencil.compiler.backend.supabase',
  adapterVersion: '1.0.0',
  contractVersion: 1,
  supportedModelVersions: Object.freeze([1]),
  capabilities: Object.freeze(['data.read']),
  permissions: Object.freeze([]),
  outputKinds: Object.freeze(['schema'])
})

function bundledBackendProvider(): AppBundlePluginCatalogEntry {
  const entry = createBundledPluginCatalog().find(
    ({ manifest }) => manifest.plugin.id === SUPABASE_BACKEND_PROVIDER_PLUGIN_ID
  )
  if (entry?.trustSource !== 'app-bundle') throw new Error('Missing bundled Supabase provider')
  return entry
}

function application(): BackendApplicationSpecV1 {
  return {
    format: 'openpencil.backend-application',
    version: 1,
    applicationId: 'source-migration-export-test',
    dataModel: { version: 1, entities: [], enums: [], relations: [] },
    auth: {
      version: 1,
      identities: [],
      roles: [],
      ownership: [],
      tenants: [],
      rowAccess: []
    },
    workflows: { version: 1, workflows: [] },
    capabilities: [],
    secrets: []
  }
}

async function pluginStore() {
  const store = createAppPluginStore({
    storage: createMemoryAppPluginStateStorage(),
    catalog: [bundledBackendProvider()],
    activationCompatibilityPolicy: () => ({ ok: true }),
    engineVersion: '0.15.0'
  })
  const loaded = await store.load()
  if (loaded.error) throw loaded.error
  return store
}

async function preparedBuild(
  target: DesktopSupabaseBackendTarget = 'react'
): Promise<PreparedAppBackendProviderBuild> {
  const store = await pluginStore()
  const descriptor = listAppBackendProviderDescriptors(store)[0]
  if (!descriptor) throw new Error('Missing active Supabase provider')
  return prepareAppBackendProviderBuild(
    store,
    {
      format: APP_BACKEND_PROVIDER_REQUEST_FORMAT,
      selection: descriptor,
      application: application()
    },
    { target, mode: 'production' }
  )
}

const BUILD = await preparedBuild()
const GRAPH: AppBackendProviderDocumentGraph = Object.freeze({
  rootId: 'root-1',
  getNode: () => undefined
})

async function documentDigest(build = BUILD): Promise<string> {
  return digestCanonicalManifest({
    format: 'openpencil.desktop-supabase-backend-review-document.v1',
    rootId: GRAPH.rootId,
    projectRef: PROJECT_REF,
    schema: 'public',
    backendProviderRequest: build.request
  })
}

async function previousReview(
  stagedExecutionPlan: Readonly<Record<string, unknown>> | null = null
): Promise<DesktopSupabaseBackendReviewResult> {
  const inspectedSchemaDigest = 'inspected-schema-digest'
  const inspectedReview = asFixture<SupabaseInspectedMigrationReviewV1>({
    snapshot: {},
    sql: '-- Review only.\n',
    manifest: {
      applicationDigest: BUILD.plan.applicationDigest,
      migrationPlanDigest: 'migration-plan-digest',
      stagedExecutionPlan,
      inspectedSchemaDigest,
      reviewReady: true,
      applyAllowed: false,
      releaseReady: false,
      blockers: []
    },
    manifestDigest: 'inspected-review-manifest-digest'
  })
  return desktopReview(inspectedReview)
}

async function desktopReview(
  inspectedReview: SupabaseInspectedMigrationReviewV1,
  build = BUILD
): Promise<DesktopSupabaseBackendReviewResult> {
  const inspectedSchemaDigest = inspectedReview.manifest.inspectedSchemaDigest
  const manifest = {
    format: 'openpencil.supabase-backend-host-review.v1',
    version: 1,
    documentDigest: await documentDigest(build),
    compilerVersion: '0.15.0',
    target: build.plan.target,
    environment: 'staging',
    compiler: {
      applicationDigest: build.plan.applicationDigest,
      planDigest: build.plan.planDigest,
      emissionManifestDigest: build.emission.manifestDigest
    },
    backendProvider: AUTHORITY,
    remoteAuthority: {
      projectRef: PROJECT_REF,
      accountId: ACCOUNT_ID,
      grantGeneration: GRANT_GENERATION,
      inspectedSchemaDigest
    },
    inspectedReview: {
      manifestDigest: inspectedReview.manifestDigest,
      migrationPlanDigest: inspectedReview.manifest.migrationPlanDigest,
      targetModelDigest: 'target-model-digest',
      reviewReady: true,
      applyAllowed: false,
      releaseReady: false
    }
  }
  const artifact = asFixture<SupabaseBackendReleaseReviewArtifactV1>({
    format: 'openpencil.supabase-backend-review-artifact.v1',
    version: 1,
    manifest,
    manifestDigest: await digestCanonicalManifest(manifest),
    inspectedReview
  })
  return {
    artifact,
    documentDigest: manifest.documentDigest,
    projectRef: PROJECT_REF,
    accountId: ACCOUNT_ID,
    grantGeneration: GRANT_GENERATION,
    reviewReady: true,
    blockerCount: 0,
    applyAvailable: false,
    applyPerformed: false
  }
}

async function realInspectedReview(): Promise<SupabaseInspectedMigrationReviewV1> {
  const snapshot = await createSupabaseInspectedMigrationSnapshot({
    provenance: {
      projectRef: PROJECT_REF,
      accountId: ACCOUNT_ID,
      querySchemaVersion: 'catalog-v1',
      databaseRole: 'postgres',
      observedAt: '2026-09-03T01:59:00.000Z',
      completeness: 'complete',
      truncated: false
    },
    currentModel: { version: 1, entities: [], enums: [], relations: [] },
    coverage: {
      schemas: 'complete',
      tables: 'complete',
      columns: 'complete',
      enums: 'complete',
      constraints: 'complete',
      indexes: 'complete',
      sequences: 'complete',
      views: 'complete',
      functions: 'complete',
      roles: 'complete',
      roleMemberships: 'complete',
      rls: 'complete',
      policies: 'complete',
      storageBuckets: 'complete',
      storagePolicies: 'complete',
      privileges: 'complete'
    },
    objects: [],
    columns: [],
    constraints: [],
    indexes: [],
    roles: [
      { roleName: 'postgres', superuser: true, bypassRls: true, inherit: true },
      { roleName: 'anon', superuser: false, bypassRls: false, inherit: true },
      { roleName: 'authenticated', superuser: false, bypassRls: false, inherit: true }
    ],
    roleMemberships: [],
    policies: [],
    storageBuckets: [],
    storagePolicies: [],
    privileges: [],
    defaultPrivileges: []
  })
  return createSupabaseInspectedMigrationReview({
    application: BUILD.request.application,
    snapshot,
    expectedProjectRef: PROJECT_REF,
    expectedAccountId: ACCOUNT_ID,
    environment: 'staging'
  })
}

async function digestText(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return encodeBase64URL(new Uint8Array(digest))
}

async function sourceFile(
  path: string,
  content: string,
  kind: SupabaseSourceMigrationFileV1['kind'],
  mediaType: SupabaseSourceMigrationFileV1['mediaType']
): Promise<SupabaseSourceMigrationFileV1> {
  return {
    path,
    content,
    kind,
    mediaType,
    byteLength: new TextEncoder().encode(content).byteLength,
    digest: await digestText(content)
  }
}

async function fakeBundle(
  input: CreateSupabaseSourceMigrationBundleInputV1,
  options: Readonly<{ unsafePath?: boolean }> = {}
): Promise<SupabaseSourceMigrationBundleV1> {
  const migration = await sourceFile(
    options.unsafePath ? '../outside.sql' : `supabase/migrations/20260903020000_${input.name}.sql`,
    '-- migration\n',
    'migration-sql',
    'application/sql; charset=utf-8'
  )
  const sourceLedger = await sourceFile(
    'supabase/openpencil-inspected-source-ledger.json',
    '{"source":true}\n',
    'inspected-source-ledger',
    'application/json; charset=utf-8'
  )
  const promotionLedger = await sourceFile(
    'supabase/openpencil-migration-ledger.json',
    '{"promotion":true}\n',
    'promotion-ledger',
    'application/json; charset=utf-8'
  )
  const manifest = {
    format: 'openpencil.supabase-source-migration.v1' as const,
    version: 1 as const,
    providerId: 'supabase' as const,
    environment: 'staging' as const,
    migrationId: input.migrationId,
    sequence: 1,
    reviewManifestDigest: input.reviewed.manifestDigest,
    applicationDigest: input.reviewed.manifest.applicationDigest,
    migrationPlanDigest: input.reviewed.manifest.migrationPlanDigest,
    executionPlanDigest: 'E'.repeat(43),
    emissionManifestDigest: BUILD.emission.manifestDigest,
    emissionPlanDigest: BUILD.plan.planDigest,
    reviewSqlDigest: 'R'.repeat(43),
    storagePolicyArtifactDigest: null,
    sourceMigration: {
      path: migration.path,
      byteLength: migration.byteLength,
      digest: migration.digest
    },
    inspectedSourceLedger: {
      path: sourceLedger.path,
      byteLength: sourceLedger.byteLength,
      digest: sourceLedger.digest
    },
    promotionLedger: {
      path: promotionLedger.path,
      byteLength: promotionLedger.byteLength,
      digest: promotionLedger.digest
    }
  }
  return {
    manifest,
    manifestDigest: await digestCanonicalManifest(manifest),
    files: [migration, sourceLedger, promotionLedger],
    ledger: input.ledger as SupabaseSourceMigrationBundleV1['ledger'],
    sourceLedger: {
      ...(input.sourceLedger as SupabaseSourceMigrationBundleV1['sourceLedger']),
      headDigest: 'H'.repeat(43)
    }
  }
}

interface DependencyCapture {
  bundleInputs: CreateSupabaseSourceMigrationBundleInputV1[]
  archivedFiles: Array<ReadonlyMap<string, string | Uint8Array>>
  writes: Uint8Array[]
  buildCalls: number
  destinationCalls: number
}

function dependencies(
  capture: DependencyCapture,
  overrides: Partial<DesktopSupabaseSourceMigrationExportDependencies> = {}
): DesktopSupabaseSourceMigrationExportDependencies {
  return {
    isDesktop: () => true,
    now: () => NOW,
    nextId: () => MIGRATION_ID,
    prepareBuild: () => {
      capture.buildCalls += 1
      return BUILD
    },
    resolveBackendProviderAuthority: () => AUTHORITY,
    async createBundle(input) {
      capture.bundleInputs.push(input)
      return fakeBundle(input)
    },
    async archive(files) {
      capture.archivedFiles.push(new Map(files))
      return new Uint8Array([1, 2, 3])
    },
    async chooseDestination() {
      capture.destinationCalls += 1
      return {
        async write(bytes) {
          capture.writes.push(bytes)
          return true
        }
      }
    },
    ...overrides
  }
}

function emptyCapture(): DependencyCapture {
  return { bundleInputs: [], archivedFiles: [], writes: [], buildCalls: 0, destinationCalls: 0 }
}

function exportInput(reviewed: DesktopSupabaseBackendReviewResult) {
  return {
    config: { url: PROJECT_URL, anonKey: '' },
    graph: GRAPH,
    reviewed,
    name: NAME
  }
}

async function errorCode(operation: Promise<unknown>): Promise<string | undefined> {
  try {
    await operation
  } catch (cause) {
    return cause instanceof DesktopSupabaseSourceMigrationExportError ? cause.code : undefined
  }
  return undefined
}

describe('Desktop Supabase source migration export authority', () => {
  test.each(['missing-artifact', 'null-artifact', 'missing-manifest', 'null-manifest'] as const)(
    'rejects a %s review envelope before opening the destination',
    async (shape) => {
      const reviewed = structuredClone(await previousReview())
      if (shape === 'missing-artifact') Reflect.deleteProperty(reviewed, 'artifact')
      if (shape === 'null-artifact') Reflect.set(reviewed, 'artifact', null)
      if (shape === 'missing-manifest') Reflect.deleteProperty(reviewed.artifact, 'manifest')
      if (shape === 'null-manifest') Reflect.set(reviewed.artifact, 'manifest', null)
      const capture = emptyCapture()
      const service = createDesktopSupabaseSourceMigrationExportService(dependencies(capture))
      expect(await errorCode(service.exportMigration(exportInput(reviewed)))).toBe('review-stale')
      expect(capture.destinationCalls).toBe(0)
      expect(capture.bundleInputs).toEqual([])
      expect(capture.writes).toEqual([])
    }
  )

  test.each(['vue', 'flutter', null])(
    'rejects a recomputed %s review target before opening the destination',
    async (target) => {
      const reviewed = await previousReview()
      if (target === null) Reflect.deleteProperty(reviewed.artifact.manifest, 'target')
      else Reflect.set(reviewed.artifact.manifest, 'target', target)
      Reflect.set(
        reviewed.artifact,
        'manifestDigest',
        await digestCanonicalManifest(reviewed.artifact.manifest)
      )
      const capture = emptyCapture()
      const service = createDesktopSupabaseSourceMigrationExportService(dependencies(capture))
      expect(await errorCode(service.exportMigration(exportInput(reviewed)))).toBe('review-stale')
      expect(capture.destinationCalls).toBe(0)
      expect(capture.bundleInputs).toEqual([])
      expect(capture.writes).toEqual([])
    }
  )

  test.each(['plan', 'emission'] as const)(
    'rejects a wrong %s target with retained digests before any save capability',
    async (field) => {
      const reviewed = await previousReview()
      const build = {
        ...BUILD,
        plan: { ...BUILD.plan },
        emission: { ...BUILD.emission, manifest: { ...BUILD.emission.manifest } }
      }
      Reflect.set(field === 'plan' ? build.plan : build.emission.manifest, 'target', 'vue')
      const capture = emptyCapture()
      const service = createDesktopSupabaseSourceMigrationExportService(
        dependencies(capture, { prepareBuild: () => build })
      )
      expect(await errorCode(service.exportMigration(exportInput(reviewed)))).toBe('review-stale')
      expect(capture.destinationCalls).toBe(0)
      expect(capture.bundleInputs).toEqual([])
      expect(capture.writes).toEqual([])
    }
  )

  test('rebuilds the captured Vue target at each destination boundary', async () => {
    const build = await preparedBuild('vue')
    const reviewed = await desktopReview(await realInspectedReview(), build)
    const capture = emptyCapture()
    const targets: unknown[] = []
    const service = createDesktopSupabaseSourceMigrationExportService(
      dependencies(capture, {
        prepareBuild(_graph, target) {
          if (targets.length === 0) Reflect.set(reviewed.artifact.manifest, 'target', 'react')
          targets.push(target)
          return build
        },
        createBundle: createSupabaseSourceMigrationBundle
      })
    )
    expect((await service.exportMigration(exportInput(reviewed))).outcome).toBe('succeeded')
    expect(targets).toEqual(['vue', 'vue', 'vue', 'vue'])
    expect(capture.writes).toHaveLength(1)
  })

  test.each(['plan', 'emission'] as const)(
    'rejects fresh %s target drift after destination choice and before bundle or write',
    async (field) => {
      const reviewed = await previousReview()
      const drifted = {
        ...BUILD,
        plan: { ...BUILD.plan },
        emission: { ...BUILD.emission, manifest: { ...BUILD.emission.manifest } }
      }
      Reflect.set(field === 'plan' ? drifted.plan : drifted.emission.manifest, 'target', 'vue')
      const capture = emptyCapture()
      const service = createDesktopSupabaseSourceMigrationExportService(
        dependencies(capture, {
          prepareBuild: () => (++capture.buildCalls === 1 ? BUILD : drifted)
        })
      )
      expect(await errorCode(service.exportMigration(exportInput(reviewed)))).toBe('review-stale')
      expect(capture.buildCalls).toBe(2)
      expect(capture.destinationCalls).toBe(1)
      expect(capture.bundleInputs).toEqual([])
      expect(capture.writes).toEqual([])
    }
  )

  test.each(['react', 'vue'] as const)(
    'wires an actual %s compiler review through the App exporter into a readable ZIP',
    async (target) => {
      const store = await pluginStore()
      const build = await preparedBuild(target)
      const graph: AppBackendProviderDocumentGraph = {
        rootId: GRAPH.rootId,
        getNode(id) {
          return id === GRAPH.rootId
            ? {
                pluginData: [
                  {
                    pluginId: APP_BACKEND_PROVIDER_DOCUMENT_PLUGIN_ID,
                    key: APP_BACKEND_PROVIDER_DOCUMENT_KEY,
                    value: appBackendProviderDocumentValue(build.request)
                  }
                ]
              }
            : undefined
        }
      }
      const inspected = await realInspectedReview()
      let reviewId = 0
      const reviewService = createAppDesktopSupabaseBackendReviewServiceForTestingV1({
        isDesktop: () => true,
        pluginStore: store,
        fetcher: async () =>
          Response.json({
            ref: PROJECT_REF,
            organization_id: ACCOUNT_ID,
            organization_slug: 'test'
          }),
        inspectCatalog: async () => inspected.snapshot,
        now: () => NOW,
        nextId: () => `source-review-${++reviewId}`,
        dependencyOverrides: {
          resolveCredential: async () => 'sbp_export_review_canary_1234567890',
          resolveGrantGeneration: async () => GRANT_GENERATION
        }
      })
      const reviewed = await reviewService.review({
        graph,
        config: { url: PROJECT_URL, anonKey: '' },
        ...(target === 'vue' ? { target } : {})
      })
      expect(reviewed.artifact.manifest.target).toBe(target)
      const writes: Uint8Array[] = []
      const service = createAppDesktopSupabaseSourceMigrationExportService({
        isDesktop: () => true,
        pluginStore: store,
        now: () => NOW,
        nextId: () => MIGRATION_ID,
        dependencyOverrides: {
          chooseDestination: async () => ({
            write: async (bytes) => {
              writes.push(bytes)
              return true
            }
          })
        }
      })
      const result = await service.exportMigration({ ...exportInput(reviewed), graph })
      expect(result).toMatchObject({ outcome: 'succeeded', saved: true, applyPerformed: false })
      expect(writes).toHaveLength(1)
      const files = unzipSync(required(writes[0], 'saved ZIP'))
      expect(Object.keys(files)).toHaveLength(result.fileCount)
      const manifest = JSON.parse(
        new TextDecoder().decode(
          required(files[SUPABASE_SOURCE_MIGRATION_EXPORT_MANIFEST_PATH], 'export manifest')
        )
      )
      expect(manifest.bundleManifestDigest).toBe(result.bundleManifestDigest)
      expect(await digestCanonicalManifest(manifest.bundleManifest)).toBe(
        result.bundleManifestDigest
      )
      expect(
        new TextDecoder().decode(required(files[result.migrationPath ?? ''], 'SQL'))
      ).toContain(reviewed.artifact.inspectedReview.sql.trim())
    }
  )

  test('exports an ordinary review with compiler-normalized promotion authority', async () => {
    const capture = emptyCapture()
    const reviewed = await previousReview()
    const service = createDesktopSupabaseSourceMigrationExportService(dependencies(capture))

    const result = await service.exportMigration(exportInput(reviewed))

    expect(result).toMatchObject({
      outcome: 'succeeded',
      saved: true,
      fileCount: 4,
      migrationId: MIGRATION_ID,
      migrationPath: `supabase/migrations/20260903020000_${NAME}.sql`,
      promotionLedgerIncluded: true,
      applyPerformed: false,
      deployPerformed: false
    })
    const bundleInput = required(capture.bundleInputs[0], 'bundle input')
    const archivedFiles = required(capture.archivedFiles[0], 'archive input')
    expect(Object.hasOwn(bundleInput, 'executionPlan')).toBe(false)
    expect(bundleInput.sourceLedger).toMatchObject({
      ledgerId: `supabase:${PROJECT_REF}:inspected`,
      entries: []
    })
    expect(bundleInput.ledger).toMatchObject({
      ledgerId: `supabase:${PROJECT_REF}:promotion`,
      entries: []
    })
    expect([...archivedFiles.keys()].sort()).toEqual([
      'supabase/migrations/20260903020000_add-tasks.sql',
      'supabase/openpencil-inspected-source-ledger.json',
      'supabase/openpencil-migration-ledger.json',
      SUPABASE_SOURCE_MIGRATION_EXPORT_MANIFEST_PATH
    ])
    const hostManifestContent = archivedFiles.get(SUPABASE_SOURCE_MIGRATION_EXPORT_MANIFEST_PATH)
    if (typeof hostManifestContent !== 'string') throw new Error('Missing Host export manifest')
    const hostManifest = JSON.parse(hostManifestContent) as HostExportManifestFixture
    expect(hostManifest.format).toBe('openpencil.supabase-source-migration-host-export.v1')
    expect(hostManifest.bundleManifestDigest).toBe(result.bundleManifestDigest)
    expect(hostManifest.files).toHaveLength(3)
    expect(capture.buildCalls).toBe(4)
    expect(capture.writes).toHaveLength(1)
  })

  test('accepts the real trusted compiler bundle and preserves its canonical manifest digest', async () => {
    const capture = emptyCapture()
    const inspected = await realInspectedReview()
    expect(inspected.manifest.reviewReady).toBe(true)
    const reviewed = await desktopReview(inspected)
    const service = createDesktopSupabaseSourceMigrationExportService(
      dependencies(capture, {
        async createBundle(input) {
          capture.bundleInputs.push(input)
          return createSupabaseSourceMigrationBundle(input)
        }
      })
    )

    const result = await service.exportMigration(exportInput(reviewed))

    expect(result).toMatchObject({
      outcome: 'succeeded',
      saved: true,
      migrationPath: 'supabase/migrations/20260903020000_add-tasks.sql',
      promotionLedgerIncluded: true
    })
    expect(result.bundleManifestDigest).toHaveLength(43)
    expect(required(capture.archivedFiles[0], 'archive input').size).toBe(4)
  })

  test('imports both ledgers and includes exact staged review authority', async () => {
    const capture = emptyCapture()
    const stagedPlan = Object.freeze({ format: 'staged-plan-test', planId: 'plan-1' })
    const reviewed = await previousReview(stagedPlan)
    const inspectedLedger = {
      format: 'openpencil.supabase-inspected-source-migration-ledger.v1',
      version: 1,
      ledgerId: `supabase:${PROJECT_REF}:inspected`,
      entries: [],
      headDigest: null,
      createdAt: '2026-09-02T00:00:00.000Z',
      updatedAt: '2026-09-02T00:00:00.000Z'
    }
    const promotionLedger = createSourceMigrationLedger({
      ledgerId: `supabase:${PROJECT_REF}:promotion`,
      createdAt: '2026-09-02T00:00:00.000Z'
    })
    const service = createDesktopSupabaseSourceMigrationExportService(dependencies(capture))

    const result = await service.exportMigration({
      ...exportInput(reviewed),
      inspectedSourceLedgerJSON: JSON.stringify(inspectedLedger),
      promotionLedgerJSON: JSON.stringify(promotionLedger)
    })

    expect(result.promotionLedgerIncluded).toBe(true)
    const bundleInput = required(capture.bundleInputs[0], 'bundle input')
    expect(bundleInput.executionPlan).toEqual(stagedPlan)
    expect(bundleInput.sourceLedger).toMatchObject({
      ledgerId: `supabase:${PROJECT_REF}:inspected`
    })
    expect(bundleInput.ledger).toMatchObject({
      ledgerId: `supabase:${PROJECT_REF}:promotion`
    })
    expect([...required(capture.archivedFiles[0], 'archive input').keys()].sort()).toEqual([
      'supabase/migrations/20260903020000_add-tasks.sql',
      'supabase/openpencil-inspected-source-ledger.json',
      'supabase/openpencil-migration-ledger.json',
      SUPABASE_SOURCE_MIGRATION_EXPORT_MANIFEST_PATH
    ])
  })

  test('rejects a tampered review before opening a save destination', async () => {
    const capture = emptyCapture()
    const reviewed = await previousReview()
    const service = createDesktopSupabaseSourceMigrationExportService(dependencies(capture))
    const tampered = {
      ...reviewed,
      artifact: { ...reviewed.artifact, manifestDigest: 'A'.repeat(43) }
    }

    expect(await errorCode(service.exportMigration(exportInput(tampered)))).toBe('review-stale')
    expect(capture.destinationCalls).toBe(0)
    expect(capture.bundleInputs).toHaveLength(0)
  })

  test('rejects document/build drift after destination choice and before bundle creation', async () => {
    const capture = emptyCapture()
    const reviewed = await previousReview()
    const changedBuild = structuredClone(BUILD)
    changedBuild.request.application.applicationId = 'changed-after-review'
    const service = createDesktopSupabaseSourceMigrationExportService(
      dependencies(capture, {
        prepareBuild: () => {
          capture.buildCalls += 1
          return capture.buildCalls === 1 ? BUILD : changedBuild
        }
      })
    )

    expect(await errorCode(service.exportMigration(exportInput(reviewed)))).toBe('review-stale')
    expect(capture.destinationCalls).toBe(1)
    expect(capture.bundleInputs).toHaveLength(0)
    expect(capture.writes).toHaveLength(0)
  })

  test('treats save-panel cancellation as a side-effect-free cancelled result', async () => {
    const capture = emptyCapture()
    const reviewed = await previousReview()
    const service = createDesktopSupabaseSourceMigrationExportService(
      dependencies(capture, {
        chooseDestination: async () => {
          capture.destinationCalls += 1
          return null
        }
      })
    )

    expect(await service.exportMigration(exportInput(reviewed))).toEqual({
      outcome: 'cancelled',
      saved: false,
      fileName: 'openpencil-supabase-migration-add-tasks.zip',
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
    expect(capture.bundleInputs).toHaveLength(0)
    expect(capture.archivedFiles).toHaveLength(0)
  })

  test('rejects invalid imported ledgers and oversized JSON before destination choice', async () => {
    const capture = emptyCapture()
    const reviewed = await previousReview()
    const service = createDesktopSupabaseSourceMigrationExportService(dependencies(capture))

    expect(
      await errorCode(
        service.exportMigration({
          ...exportInput(reviewed),
          inspectedSourceLedgerJSON: '{"format":"wrong"}'
        })
      )
    ).toBe('invalid-ledger')
    expect(capture.destinationCalls).toBe(0)

    expect(
      await errorCode(
        service.exportMigration({
          ...exportInput(reviewed),
          promotionLedgerJSON: ' '.repeat(MAX_SUPABASE_SOURCE_LEDGER_IMPORT_BYTES + 1)
        })
      )
    ).toBe('invalid-ledger')
    expect(capture.destinationCalls).toBe(0)
  })

  test('rejects valid ledgers whose ids belong to a different Supabase project', async () => {
    const capture = emptyCapture()
    const reviewed = await previousReview()
    const service = createDesktopSupabaseSourceMigrationExportService(dependencies(capture))
    const foreignSourceLedger = {
      format: 'openpencil.supabase-inspected-source-migration-ledger.v1',
      version: 1,
      ledgerId: 'supabase:foreignprojectref123:inspected',
      entries: [],
      headDigest: null,
      createdAt: '2026-09-02T00:00:00.000Z',
      updatedAt: '2026-09-02T00:00:00.000Z'
    }
    const foreignPromotionLedger = createSourceMigrationLedger({
      ledgerId: 'supabase:foreignprojectref123:promotion',
      createdAt: '2026-09-02T00:00:00.000Z'
    })

    expect(
      await errorCode(
        service.exportMigration({
          ...exportInput(reviewed),
          inspectedSourceLedgerJSON: JSON.stringify(foreignSourceLedger)
        })
      )
    ).toBe('invalid-ledger')
    expect(
      await errorCode(
        service.exportMigration({
          ...exportInput(reviewed),
          promotionLedgerJSON: JSON.stringify(foreignPromotionLedger)
        })
      )
    ).toBe('invalid-ledger')
    expect(capture.destinationCalls).toBe(0)
    expect(capture.bundleInputs).toHaveLength(0)
  })

  test('rejects unsafe compiler paths before archiving or writing', async () => {
    const capture = emptyCapture()
    const reviewed = await previousReview()
    const service = createDesktopSupabaseSourceMigrationExportService(
      dependencies(capture, {
        async createBundle(input) {
          capture.bundleInputs.push(input)
          return fakeBundle(input, { unsafePath: true })
        }
      })
    )

    expect(await errorCode(service.exportMigration(exportInput(reviewed)))).toBe('bundle-invalid')
    expect(capture.archivedFiles).toHaveLength(0)
    expect(capture.writes).toHaveLength(0)
  })

  test('marks a post-save authority change as outcome unknown', async () => {
    const capture = emptyCapture()
    const reviewed = await previousReview()
    const changedBuild = structuredClone(BUILD)
    changedBuild.request.application.applicationId = 'changed-after-save'
    const service = createDesktopSupabaseSourceMigrationExportService(
      dependencies(capture, {
        prepareBuild: () => {
          capture.buildCalls += 1
          return capture.buildCalls < 4 ? BUILD : changedBuild
        }
      })
    )

    expect(await errorCode(service.exportMigration(exportInput(reviewed)))).toBe('outcome-unknown')
    expect(capture.writes).toHaveLength(1)
  })

  test('enforces single-flight and honors AbortSignal before any side effect', async () => {
    const capture = emptyCapture()
    const reviewed = await previousReview()
    let continueDestination!: () => void
    const destinationPending = new Promise<void>((resolve) => {
      continueDestination = resolve
    })
    let destinationStarted!: () => void
    const destinationDidStart = new Promise<void>((resolve) => {
      destinationStarted = resolve
    })
    const service = createDesktopSupabaseSourceMigrationExportService(
      dependencies(capture, {
        async chooseDestination() {
          destinationStarted()
          await destinationPending
          return null
        }
      })
    )
    const first = service.exportMigration(exportInput(reviewed))
    await destinationDidStart
    expect(await errorCode(service.exportMigration(exportInput(reviewed)))).toBe('already-running')
    continueDestination()
    expect((await first).outcome).toBe('cancelled')

    const controller = new AbortController()
    controller.abort()
    expect(
      await errorCode(
        service.exportMigration({ ...exportInput(reviewed), signal: controller.signal })
      )
    ).toBe('aborted')
  })
})
