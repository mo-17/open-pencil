import { describe, expect, test } from 'bun:test'

import {
  createSupabaseInspectedMigrationSnapshot,
  type CreateSupabaseInspectedMigrationSnapshotInputV1,
  type SupabaseInspectedMigrationSnapshotV1
} from '@open-pencil/compiler/backend'
import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

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
  appBackendProviderDocumentValue,
  listAppBackendProviderDescriptors,
  type AppBackendProviderDocumentGraph,
  type AppBackendProviderHostStore
} from '@/app/plugins/host/backend-provider'
import { createMemoryBackendHostReleaseDispatchJournal } from '@/app/plugins/host/deployment/backend/release-journal'
import type { DesktopSupabaseBackendReviewResult } from '@/app/plugins/host/deployment/desktop-supabase-backend-review'
import { createAppDesktopSupabaseBackendReviewService } from '@/app/plugins/host/deployment/desktop-supabase-backend-review-app'
import { createAppDesktopSupabaseBackendStagingReleaseService } from '@/app/plugins/host/deployment/desktop-supabase-backend-staging-release-app'
import type { SupabaseManagementDatabaseApplyFetch } from '@/app/plugins/host/deployment/supabase/management-database-apply-transport'
import type { SupabaseManagementDesktopFetch } from '@/app/plugins/host/deployment/supabase/management-pg-catalog-transport'

const PROJECT_REF = 'enekobitnhobuiuamvqj'
const PROJECT_URL = `https://${PROJECT_REF}.supabase.co`
const ORGANIZATION_ID = 'org-123'
const GRANT_GENERATION = '123e4567-e89b-42d3-a456-426614174000'
const READ_PAT = 'sbp_read_secret_canary_1234567890'
const WRITE_PAT = 'sbp_write_secret_canary_1234567890'
const NOW = '2026-09-02T05:00:00.000Z'

const COMPLETE_COVERAGE = {
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
} as const

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
    applicationId: 'desktop-staging-release-runtime-test',
    dataModel: {
      version: 1,
      entities: [],
      enums: [{ id: 'task-status', name: 'task_status', values: ['todo', 'done'] }],
      relations: []
    },
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

function graph(value: string): AppBackendProviderDocumentGraph {
  return {
    rootId: 'root-1',
    getNode(id) {
      if (id !== 'root-1') return undefined
      return {
        pluginData: [
          {
            pluginId: APP_BACKEND_PROVIDER_DOCUMENT_PLUGIN_ID,
            key: APP_BACKEND_PROVIDER_DOCUMENT_KEY,
            value
          }
        ]
      }
    }
  }
}

function inspectionInput(applied: boolean): CreateSupabaseInspectedMigrationSnapshotInputV1 {
  const currentModel = applied
    ? {
        version: 1 as const,
        entities: [],
        enums: [{ id: 'task-status', name: 'task_status', values: ['todo', 'done'] }],
        relations: []
      }
    : { version: 1 as const, entities: [], enums: [], relations: [] }
  return {
    provenance: {
      projectRef: PROJECT_REF,
      accountId: ORGANIZATION_ID,
      querySchemaVersion: 'catalog-v1',
      databaseRole: 'postgres',
      observedAt: NOW,
      completeness: 'complete',
      truncated: false
    },
    currentModel,
    coverage: COMPLETE_COVERAGE,
    objects: applied
      ? [
          {
            kind: 'enum',
            schema: 'public',
            name: 'task_status',
            management: 'managed',
            openPencilId: 'task-status',
            values: ['todo', 'done'],
            address: { classOid: '1247', objectOid: '50000', subId: 0 }
          }
        ]
      : [],
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
  }
}

function jsonResponse(value: unknown, status: number, url: string): Response {
  const response = new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  })
  Object.defineProperty(response, 'url', { value: url })
  return response
}

function projectResponse(url: string): Response {
  return jsonResponse(
    {
      ref: PROJECT_REF,
      organization_id: ORGANIZATION_ID,
      organization_slug: 'open-pencil-staging'
    },
    200,
    url
  )
}

async function setup(): Promise<{
  store: AppBackendProviderHostStore
  graph: AppBackendProviderDocumentGraph
  baseline: SupabaseInspectedMigrationSnapshotV1
  applied: SupabaseInspectedMigrationSnapshotV1
  reviewed: DesktopSupabaseBackendReviewResult
  readFetcher: SupabaseManagementDesktopFetch
}> {
  const store = createAppPluginStore({
    storage: createMemoryAppPluginStateStorage(),
    catalog: [bundledBackendProvider()],
    activationCompatibilityPolicy: () => ({ ok: true }),
    engineVersion: '0.15.0'
  })
  const loaded = await store.load()
  if (loaded.error) throw loaded.error
  const descriptor = listAppBackendProviderDescriptors(store)[0]
  if (!descriptor) throw new Error('Missing active Supabase provider')
  const documentGraph = graph(
    appBackendProviderDocumentValue({
      format: APP_BACKEND_PROVIDER_REQUEST_FORMAT,
      selection: descriptor,
      application: application()
    })
  )
  const baseline = await createSupabaseInspectedMigrationSnapshot(inspectionInput(false))
  const applied = await createSupabaseInspectedMigrationSnapshot(inspectionInput(true))
  const readFetcher: SupabaseManagementDesktopFetch = async (input) =>
    projectResponse(String(input))
  let id = 0
  const reviewService = createAppDesktopSupabaseBackendReviewService({
    isDesktop: () => true,
    pluginStore: store,
    pluginStoreReady: () => Promise.resolve(),
    fetcher: readFetcher,
    inspectCatalog: async () => baseline,
    now: () => NOW,
    nextId: () => `review-id-${++id}`,
    dependencyOverrides: {
      resolveCredential: async () => READ_PAT,
      resolveGrantGeneration: async () => GRANT_GENERATION
    }
  })
  const reviewed = await reviewService.review({
    config: { url: PROJECT_URL, anonKey: '', schema: 'public' },
    graph: documentGraph
  })
  return { store, graph: documentGraph, baseline, applied, reviewed, readFetcher }
}

function releaseService(
  prepared: Awaited<ReturnType<typeof setup>>,
  writeFetcher: SupabaseManagementDatabaseApplyFetch,
  resolveGrantGeneration: () => Promise<string | null> = async () => GRANT_GENERATION
) {
  let id = 0
  let inspectionCount = 0
  return createAppDesktopSupabaseBackendStagingReleaseService({
    isDesktop: () => true,
    pluginStore: prepared.store,
    pluginStoreReady: () => Promise.resolve(),
    readFetcher: prepared.readFetcher,
    writeFetcher,
    dispatchJournal: createMemoryBackendHostReleaseDispatchJournal(),
    inspectCatalog: async () => {
      inspectionCount += 1
      return inspectionCount < 3 ? prepared.baseline : prepared.applied
    },
    stagingTargetStore: {
      read: () => ({
        schemaVersion: 1,
        projectRef: PROJECT_REF,
        accountId: ORGANIZATION_ID,
        boundAt: NOW
      })
    },
    now: () => NOW,
    nextId: () => `release-id-${++id}`,
    dependencyOverrides: {
      resolveReadCredential: async () => READ_PAT,
      resolveWriteCredential: async () => WRITE_PAT,
      resolveGrantGeneration
    }
  })
}

function releaseInput(prepared: Awaited<ReturnType<typeof setup>>) {
  return {
    config: { url: PROJECT_URL, anonKey: '', schema: 'public' },
    graph: prepared.graph,
    reviewed: prepared.reviewed,
    projectRefConfirmation: PROJECT_REF,
    confirmedIndependentStaging: true as const
  }
}

describe('Desktop Supabase staging Apply app wiring', () => {
  test('dispatches one reviewed migration then verifies the post-Apply catalog snapshot', async () => {
    const prepared = await setup()
    const requests: Array<{ method: string; body: string }> = []
    const writeFetcher: SupabaseManagementDatabaseApplyFetch = async (input, init) => {
      const method = init?.method ?? 'GET'
      requests.push({ method, body: String(init?.body ?? '') })
      return method === 'GET'
        ? projectResponse(String(input))
        : jsonResponse([], 201, String(input))
    }
    const service = releaseService(prepared, writeFetcher)

    const result = await service.release(releaseInput(prepared))

    expect(result.outcome).toBe('succeeded')
    expect(result.receipt.outcome).toBe('succeeded')
    expect(result.receipt.environment).toBe('staging')
    expect(result.productionReleaseReady).toBe(false)
    expect(requests.map(({ method }) => method)).toEqual(['GET', 'GET', 'POST'])
    const body = JSON.parse(requests[2]?.body ?? '{}')
    expect(Object.keys(body)).toEqual(['query', 'read_only'])
    expect(body.read_only).toBe(false)
    expect(body.query).toBe(prepared.reviewed.artifact.inspectedReview.sql)
    expect(JSON.stringify(result)).not.toContain(READ_PAT)
    expect(JSON.stringify(result)).not.toContain(WRITE_PAT)
  })

  test('records an uncertain POST failure as outcome-unknown without retry', async () => {
    const prepared = await setup()
    let postCalls = 0
    const writeFetcher: SupabaseManagementDatabaseApplyFetch = async (input, init) => {
      if ((init?.method ?? 'GET') === 'GET') return projectResponse(String(input))
      postCalls += 1
      throw new TypeError('network uncertainty')
    }
    const service = releaseService(prepared, writeFetcher)

    const result = await service.release(releaseInput(prepared))

    expect(result.outcome).toBe('outcome-unknown')
    expect(result.state.automaticRetryAllowed).toBe(false)
    expect(result.state.reconcileRequired).toBe(true)
    expect(result.receipt.failure).toMatchObject({ outcomeUnknown: true })
    expect(postCalls).toBe(1)
  })

  test('records a remote authority recheck failure as known pre-POST failure', async () => {
    for (const failure of ['transferred', 'network'] as const) {
      const prepared = await setup()
      let getCalls = 0
      let postCalls = 0
      const writeFetcher: SupabaseManagementDatabaseApplyFetch = async (input, init) => {
        if ((init?.method ?? 'GET') === 'POST') {
          postCalls += 1
          return jsonResponse({}, 201, String(input))
        }
        getCalls += 1
        if (getCalls === 2) {
          if (failure === 'network') throw new TypeError(`remote recheck failed ${WRITE_PAT}`)
          return jsonResponse(
            {
              ref: PROJECT_REF,
              organization_id: 'org-transferred',
              organization_slug: 'other'
            },
            200,
            String(input)
          )
        }
        return projectResponse(String(input))
      }
      const service = releaseService(prepared, writeFetcher)

      const result = await service.release(releaseInput(prepared))

      expect(result.outcome).toBe('failed')
      expect(result.receipt.failure).toMatchObject({
        code: 'supabase-staging-project-authority-recheck-failed',
        outcomeUnknown: false
      })
      expect(result.state.reconcileRequired).toBe(false)
      expect(postCalls).toBe(0)
      expect(JSON.stringify(result)).not.toContain(WRITE_PAT)
    }
  })

  test('revalidates local authority immediately before POST and retains the failed receipt', async () => {
    const prepared = await setup()
    let postCalls = 0
    let grantReads = 0
    const writeFetcher: SupabaseManagementDatabaseApplyFetch = async (input, init) => {
      if ((init?.method ?? 'GET') === 'GET') return projectResponse(String(input))
      postCalls += 1
      return jsonResponse({}, 201, String(input))
    }
    const service = releaseService(prepared, writeFetcher, async () => {
      grantReads += 1
      return grantReads < 6 ? GRANT_GENERATION : '123e4567-e89b-42d3-a456-426614174001'
    })

    const result = await service.release(releaseInput(prepared))

    expect(result.outcome).toBe('failed')
    expect(result.receipt.failure?.code).toBe('supabase-staging-local-authority-changed')
    expect(result.state.automaticRetryAllowed).toBe(false)
    expect(result.state.reconcileRequired).toBe(false)
    expect(postCalls).toBe(0)
  })
})
