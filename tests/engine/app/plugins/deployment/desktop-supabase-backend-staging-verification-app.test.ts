/* oxlint-disable eslint(complexity) -- The stateful fetch doubles model one bounded Supabase staging project end to end. */
import { describe, expect, test } from 'bun:test'

import { unzipSync } from 'fflate'

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
import { createAppDesktopSupabaseBackendStagingVerificationService } from '@/app/plugins/host/deployment/desktop-supabase-backend-staging-verification-app'
import type { SupabaseManagementEdgeFunctionFetch } from '@/app/plugins/host/deployment/supabase/management-edge-function-transport'
import type { SupabaseManagementDesktopFetch } from '@/app/plugins/host/deployment/supabase/management-pg-catalog-transport'
import type { SupabaseManagementStorageFetch } from '@/app/plugins/host/deployment/supabase/management-storage-isolation-transport'

const PROJECT_REF = 'enekobitnhobuiuamvqj'
const PROJECT_URL = `https://${PROJECT_REF}.supabase.co`
const ORGANIZATION_ID = 'org-123'
const GRANT_GENERATION = '123e4567-e89b-42d3-a456-426614174000'
const READ_PAT = 'sbp_read_secret_canary_1234567890'
const WRITE_PAT = 'sbp_write_secret_canary_1234567890'
const PUBLISHABLE_KEY = `sb_publishable_${'p'.repeat(32)}`
const EDGE_TOKEN = `eyJ${'e'.repeat(48)}.${'z'.repeat(24)}`
const USER_A = '11111111-1111-4111-8111-111111111111'
const USER_B = '22222222-2222-4222-8222-222222222222'
const TOKEN_A = `eyJ${'a'.repeat(48)}.${'x'.repeat(24)}`
const TOKEN_B = `eyJ${'b'.repeat(48)}.${'y'.repeat(24)}`
const OBSERVED_AT = '2026-09-03T12:00:00.000Z'

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
    applicationId: 'desktop-staging-capability-runtime-test',
    dataModel: { version: 1, entities: [], enums: [], relations: [] },
    auth: {
      version: 1,
      identities: [{ id: 'user', kind: 'user' }],
      roles: [],
      ownership: [],
      tenants: [],
      rowAccess: []
    },
    workflows: {
      version: 1,
      workflows: [
        {
          id: 'health-api',
          name: 'Health API',
          trigger: { kind: 'http', method: 'POST', access: 'authenticated' },
          parameters: [],
          steps: [{ id: 'respond', kind: 'respond', status: 200 }]
        }
      ]
    },
    storage: {
      version: 1,
      buckets: [
        {
          id: 'user-assets',
          name: 'user-assets',
          access: 'private',
          maxObjectBytes: 64,
          allowedMimeTypes: ['image/png'],
          pathRules: [
            {
              id: 'owner-files',
              prefix: ['users'],
              principal: { kind: 'owner' },
              operations: ['read', 'create', 'update', 'delete', 'upsert']
            }
          ]
        }
      ]
    },
    capabilities: [
      { capability: 'auth.identity', required: true },
      { capability: 'policy.row-level', required: true },
      { capability: 'server.functions', required: true },
      { capability: 'server.http', required: true },
      { capability: 'storage.objects', required: true }
    ],
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

function inspectionInput(): CreateSupabaseInspectedMigrationSnapshotInputV1 {
  return {
    provenance: {
      projectRef: PROJECT_REF,
      accountId: ORGANIZATION_ID,
      querySchemaVersion: 'catalog-v1',
      databaseRole: 'postgres',
      observedAt: OBSERVED_AT,
      completeness: 'complete',
      truncated: false
    },
    currentModel: { version: 1, entities: [], enums: [], relations: [] },
    coverage: COMPLETE_COVERAGE,
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

function bytesResponse(value: Uint8Array, status: number, url: string): Response {
  const response = new Response(value.slice(), {
    status,
    headers: { 'content-type': 'image/png' }
  })
  Object.defineProperty(response, 'url', { value: url })
  return response
}

function projectResponse(url: string): Response {
  return jsonResponse(
    { ref: PROJECT_REF, organization_id: ORGANIZATION_ID, organization_slug: 'staging' },
    200,
    url
  )
}

async function setup(): Promise<{
  store: AppBackendProviderHostStore
  graph: AppBackendProviderDocumentGraph
  snapshot: SupabaseInspectedMigrationSnapshotV1
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
  const snapshot = await createSupabaseInspectedMigrationSnapshot(inspectionInput())
  const readFetcher: SupabaseManagementDesktopFetch = async (input) =>
    projectResponse(String(input))
  let reviewId = 0
  const reviewService = createAppDesktopSupabaseBackendReviewService({
    isDesktop: () => true,
    pluginStore: store,
    pluginStoreReady: () => Promise.resolve(),
    fetcher: readFetcher,
    inspectCatalog: async () => snapshot,
    now: () => OBSERVED_AT,
    nextId: () => `review-id-${++reviewId}`,
    dependencyOverrides: {
      resolveCredential: async () => READ_PAT,
      resolveGrantGeneration: async () => GRANT_GENERATION
    }
  })
  const reviewed = await reviewService.review({
    config: { url: PROJECT_URL, anonKey: PUBLISHABLE_KEY, schema: 'public' },
    graph: documentGraph
  })
  expect(reviewed.reviewReady).toBe(true)
  expect(reviewed.blockerCount).toBe(0)
  expect(reviewed.artifact.inspectedReview.manifest.migrationPlan.operations).toEqual([])
  return { store, graph: documentGraph, snapshot, reviewed, readFetcher }
}

function operationClock(): () => string {
  let tick = 0
  const base = Date.parse('2026-09-03T12:01:00.000Z')
  return () => new Date(base + tick++ * 100).toISOString()
}

function edgeService(missingSecrets = false): {
  fetcher: SupabaseManagementEdgeFunctionFetch
  requests: string[]
} {
  const requests: string[] = []
  let healthIdentity = ''
  const fetcher: SupabaseManagementEdgeFunctionFetch = async (input, init) => {
    const url = String(input)
    requests.push(`${init?.method ?? 'GET'} ${url}`)
    if (url === `https://api.supabase.com/v1/projects/${PROJECT_REF}`) {
      return projectResponse(url)
    }
    if (url === `https://api.supabase.com/v1/projects/${PROJECT_REF}/secrets`) {
      return jsonResponse(
        missingSecrets
          ? [{ name: 'SUPABASE_URL', digest: 'redacted' }]
          : [
              { name: 'OPENPENCIL_OUTBOUND_HTTP_HOSTS', digest: 'redacted' },
              { name: 'SUPABASE_PUBLISHABLE_KEYS', digest: 'redacted' },
              { name: 'SUPABASE_URL', digest: 'redacted' }
            ],
        200,
        url
      )
    }
    if (
      url ===
      `https://api.supabase.com/v1/projects/${PROJECT_REF}/functions/deploy?slug=openpencil-runtime`
    ) {
      const form = init?.body as FormData
      const archive = form.get('file')
      if (!(archive instanceof File)) throw new Error('Missing Edge archive')
      const zipped = new Uint8Array(await archive.arrayBuffer())
      const source = new TextDecoder().decode(unzipSync(zipped)['index.ts'])
      healthIdentity =
        source.match(/OPENPENCIL_EDGE_BUILD_IDENTITY = "([A-Za-z0-9_-]{43})"/u)?.[1] ?? ''
      return jsonResponse(
        {
          id: 'function-1',
          slug: 'openpencil-runtime',
          name: 'openpencil-runtime',
          status: 'ACTIVE',
          version: 7,
          verify_jwt: true
        },
        201,
        url
      )
    }
    if (url === `${PROJECT_URL}/functions/v1/openpencil-runtime`) {
      expect(((init?.headers ?? {}) as Record<string, string>).authorization).toBe(
        `Bearer ${EDGE_TOKEN}`
      )
      return jsonResponse(
        { healthy: true, authenticated: true, buildIdentity: healthIdentity },
        200,
        url
      )
    }
    throw new Error(`Unexpected Edge request: ${url}`)
  }
  return { fetcher, requests }
}

function storageActor(init: RequestInit | undefined): 'anonymous' | 'user-a' | 'user-b' {
  const authorization = ((init?.headers ?? {}) as Record<string, string>).authorization
  if (!authorization) return 'anonymous'
  if (authorization === `Bearer ${TOKEN_A}`) return 'user-a'
  if (authorization === `Bearer ${TOKEN_B}`) return 'user-b'
  throw new Error('Unexpected Storage bearer token')
}

function storageService(): {
  fetcher: SupabaseManagementStorageFetch
  requests: string[]
} {
  const objects = new Map<string, Uint8Array>()
  const requests: string[] = []
  const fetcher: SupabaseManagementStorageFetch = async (input, init) => {
    const url = String(input)
    requests.push(`${init?.method ?? 'GET'} ${url}`)
    if (url === `https://api.supabase.com/v1/projects/${PROJECT_REF}`) {
      return projectResponse(url)
    }
    if (url === `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query/read-only`) {
      return jsonResponse(
        [
          {
            id: 'user-assets',
            name: 'user-assets',
            public: false,
            file_size_limit: 64,
            allowed_mime_types: ['image/png']
          }
        ],
        201,
        url
      )
    }
    if (url === `${PROJECT_URL}/auth/v1/user`) {
      const identity = storageActor(init)
      return jsonResponse({ id: identity === 'user-a' ? USER_A : USER_B }, 200, url)
    }
    if (!url.startsWith(`${PROJECT_URL}/storage/v1/object/`)) {
      throw new Error(`Unexpected Storage request: ${url}`)
    }
    const identity = storageActor(init)
    const isDeleteRoot = url.endsWith('/storage/v1/object/user-assets')
    const objectPath = isDeleteRoot
      ? String((JSON.parse(String(init?.body)) as { prefixes: string[] }).prefixes[0])
      : decodeURIComponent(url.split('/storage/v1/object/user-assets/')[1] ?? '')
    const allowed = identity === 'user-a' && objectPath.startsWith(`users/${USER_A}/`)
    if (init?.method === 'GET') {
      if (!allowed) return jsonResponse({ message: 'denied' }, 403, url)
      const content = objects.get(objectPath)
      return content
        ? bytesResponse(content, 200, url)
        : jsonResponse({ message: 'missing' }, 404, url)
    }
    if (init?.method === 'DELETE') {
      if (!allowed) return jsonResponse({ message: 'denied' }, 403, url)
      objects.delete(objectPath)
      return jsonResponse({ message: 'deleted' }, 200, url)
    }
    const bytes = new Uint8Array(await new Response(init?.body).arrayBuffer())
    const contentType = ((init?.headers ?? {}) as Record<string, string>)['content-type']
    if (!allowed) return jsonResponse({ message: 'denied' }, 403, url)
    if (contentType !== 'image/png') return jsonResponse({ message: 'mime rejected' }, 400, url)
    if (bytes.byteLength > 64) return jsonResponse({ message: 'too large' }, 413, url)
    objects.set(objectPath, bytes)
    return jsonResponse({ key: `user-assets/${objectPath}` }, 200, url)
  }
  return { fetcher, requests }
}

function verificationInput(prepared: Awaited<ReturnType<typeof setup>>) {
  return {
    config: { url: PROJECT_URL, anonKey: PUBLISHABLE_KEY, schema: 'public' },
    graph: prepared.graph,
    reviewed: prepared.reviewed,
    projectRefConfirmation: PROJECT_REF,
    confirmedIndependentStaging: true as const,
    edgeUserAccessToken: EDGE_TOKEN,
    storageUserA: { userId: USER_A, accessToken: TOKEN_A },
    storageUserB: { userId: USER_B, accessToken: TOKEN_B }
  }
}

describe('Desktop Supabase staging capability app wiring', () => {
  test('deploys the exact Edge artifact and proves real two-account Storage isolation', async () => {
    const prepared = await setup()
    const edge = edgeService()
    const storage = storageService()
    let id = 0
    const service = createAppDesktopSupabaseBackendStagingVerificationService({
      isDesktop: () => true,
      pluginStore: prepared.store,
      pluginStoreReady: () => Promise.resolve(),
      readFetcher: prepared.readFetcher,
      edgeFetcher: edge.fetcher,
      storageFetcher: storage.fetcher,
      inspectCatalog: async () => prepared.snapshot,
      stagingTargetStore: {
        read: () => ({
          schemaVersion: 1,
          projectRef: PROJECT_REF,
          accountId: ORGANIZATION_ID,
          boundAt: OBSERVED_AT
        })
      },
      now: operationClock(),
      nextId: () => `capability-${++id}`,
      dispatchJournal: createMemoryBackendHostReleaseDispatchJournal(),
      dependencyOverrides: {
        resolveReadCredential: async () => READ_PAT,
        resolveWriteCredential: async () => WRITE_PAT,
        resolveGrantGeneration: async () => GRANT_GENERATION
      }
    })

    const result = await service.verify(verificationInput(prepared))

    expect(result.receipt.outcome).toBe('blocked')
    expect(result.receipt.schemaApplied).toBe(true)
    expect(result.receipt.edgeFunctionReceipt).toMatchObject({
      outcome: 'succeeded',
      dispatch: 'dispatched',
      remote: { functionId: 'function-1', versionId: '7' }
    })
    expect(result.receipt.storageIsolationReceipts).toHaveLength(1)
    expect(result.receipt.storageIsolationReceipts[0]).toMatchObject({
      bucketId: 'user-assets',
      ruleId: 'owner-files',
      outcome: 'succeeded',
      residualObjectPaths: []
    })
    const gates = new Map(result.receipt.gates.map((gate) => [gate.gate, gate.status]))
    expect(gates.get('auth-policy-verified')).toBe('unknown')
    expect(gates.get('server-workflows-deployed')).toBe('passed')
    expect(gates.get('required-secrets-present')).toBe('passed')
    expect(gates.get('storage-policy-verified')).toBe('passed')
    expect(gates.get('backend-health-check')).toBe('passed')
    expect(gates.get('target-capabilities-supported')).toBe('passed')
    expect(result.productionReleaseReady).toBe(false)
    expect(edge.requests.some((entry) => entry.includes('/functions/deploy'))).toBe(true)
    expect(storage.requests.filter((entry) => entry.includes('/auth/v1/user'))).toHaveLength(4)
    expect(storage.requests.filter((entry) => entry.includes('/storage/v1/object/')).length).toBe(
      14
    )
    const serialized = JSON.stringify(result)
    for (const secret of [READ_PAT, WRITE_PAT, PUBLISHABLE_KEY, EDGE_TOKEN, TOKEN_A, TOKEN_B]) {
      expect(serialized).not.toContain(secret)
    }
  })

  test('blocks before deployment and Storage mutation when an Edge secret name is absent', async () => {
    const prepared = await setup()
    const edge = edgeService(true)
    const storage = storageService()
    let id = 0
    const service = createAppDesktopSupabaseBackendStagingVerificationService({
      isDesktop: () => true,
      pluginStore: prepared.store,
      pluginStoreReady: () => Promise.resolve(),
      readFetcher: prepared.readFetcher,
      edgeFetcher: edge.fetcher,
      storageFetcher: storage.fetcher,
      inspectCatalog: async () => prepared.snapshot,
      stagingTargetStore: {
        read: () => ({
          schemaVersion: 1,
          projectRef: PROJECT_REF,
          accountId: ORGANIZATION_ID,
          boundAt: OBSERVED_AT
        })
      },
      now: operationClock(),
      nextId: () => `blocked-capability-${++id}`,
      dispatchJournal: createMemoryBackendHostReleaseDispatchJournal(),
      dependencyOverrides: {
        resolveReadCredential: async () => READ_PAT,
        resolveWriteCredential: async () => WRITE_PAT,
        resolveGrantGeneration: async () => GRANT_GENERATION
      }
    })

    const result = await service.verify(verificationInput(prepared))

    expect(result.receipt.outcome).toBe('blocked')
    expect(result.receipt.edgeFunctionReceipt).toMatchObject({
      outcome: 'blocked',
      dispatch: 'not-dispatched',
      failureCode: 'missing-secrets'
    })
    expect(result.receipt.storageIsolationReceipts).toEqual([])
    expect(edge.requests.some((entry) => entry.includes('/functions/deploy'))).toBe(false)
    expect(storage.requests.some((entry) => entry.includes('/storage/v1/object/'))).toBe(false)
  })
})
