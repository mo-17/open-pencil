import { describe, expect, test } from 'bun:test'

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
  type AppBackendProviderDocumentGraph
} from '@/app/plugins/host/backend-provider'
import { DesktopSupabaseBackendReviewError } from '@/app/plugins/host/deployment/desktop-supabase-backend-review'
import { createAppDesktopSupabaseBackendReviewService } from '@/app/plugins/host/deployment/desktop-supabase-backend-review-app'
import type { SupabaseManagementDesktopFetch } from '@/app/plugins/host/deployment/supabase/management-pg-catalog-transport'
import { SUPABASE_PG_CATALOG_QUERY_IDS } from '@/app/plugins/host/deployment/supabase/pg-catalog-inspector'

const PROJECT_REF = 'enekobitnhobuiuamvqj'
const PROJECT_URL = `https://${PROJECT_REF}.supabase.co`
const ORGANIZATION_ID = 'org-123'
const GRANT_GENERATION = '123e4567-e89b-42d3-a456-426614174000'
const PAT = 'sbp_runtime_secret_canary_1234567890'
const NOW = '2026-08-30T10:00:00.000Z'
const SNAPSHOT_MARKER = '123:123:'

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
    applicationId: 'desktop-review-runtime-test',
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

function catalogResponse(columnPrivilegesPresent = false): unknown {
  const queryResults = Object.fromEntries(SUPABASE_PG_CATALOG_QUERY_IDS.map((id) => [id, []]))
  queryResults.provenance = [
    {
      databaseOid: '5',
      databaseName: 'postgres',
      schemaOid: '2200',
      schemaName: 'public',
      currentRoleOid: '10',
      currentRoleName: 'postgres',
      serverVersionNum: '170000',
      snapshotMarker: SNAPSHOT_MARKER,
      observedAt: NOW,
      columnPrivilegesPresent
    }
  ]
  queryResults.roles = [
    {
      roleOid: '10',
      roleName: 'postgres',
      superuser: true,
      bypassRls: true,
      inherit: true
    },
    {
      roleOid: '11',
      roleName: 'anon',
      superuser: false,
      bypassRls: false,
      inherit: true
    },
    {
      roleOid: '12',
      roleName: 'authenticated',
      superuser: false,
      bypassRls: false,
      inherit: true
    }
  ]
  return [{ snapshotMarker: SNAPSHOT_MARKER, observedAt: NOW, queryResults }]
}

function jsonResponse(value: unknown, status: number, url: string): Response {
  const response = new Response(JSON.stringify(value), { status })
  Object.defineProperty(response, 'url', { value: url })
  return response
}

describe('Desktop Supabase Backend Provider review app wiring', () => {
  test('is explicitly unavailable in Browser before any network request', async () => {
    let fetchCalls = 0
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
    const documentValue = appBackendProviderDocumentValue({
      format: APP_BACKEND_PROVIDER_REQUEST_FORMAT,
      selection: descriptor,
      application: application()
    })
    const service = createAppDesktopSupabaseBackendReviewService({
      isDesktop: () => false,
      pluginStore: store,
      pluginStoreReady: () => Promise.resolve(),
      fetcher: async () => {
        fetchCalls += 1
        return new Response('{}')
      },
      dependencyOverrides: {
        resolveCredential: async () => PAT,
        resolveGrantGeneration: async () => GRANT_GENERATION
      }
    })

    let error: Error | undefined
    try {
      await service.review({
        config: { url: PROJECT_URL, anonKey: '' },
        graph: graph(documentValue)
      })
    } catch (cause) {
      if (cause instanceof Error) error = cause
    }
    expect(error).toBeInstanceOf(DesktopSupabaseBackendReviewError)
    expect((error as DesktopSupabaseBackendReviewError).code).toBe('desktop-required')
    expect(fetchCalls).toBe(0)
  })

  test('waits for the current plugin Store reload before resolving Provider authority', async () => {
    const backing = createMemoryAppPluginStateStorage()
    let blockList = false
    let markReloadEntered: (() => void) | undefined
    let releaseReload: (() => void) | undefined
    const reloadEntered = new Promise<void>((resolve) => {
      markReloadEntered = resolve
    })
    const reloadGate = new Promise<void>((resolve) => {
      releaseReload = resolve
    })
    const storage = {
      revision: backing.revision,
      async list() {
        if (blockList) {
          markReloadEntered?.()
          await reloadGate
        }
        return backing.list()
      },
      put: backing.put,
      delete: backing.delete
    }
    const store = createAppPluginStore({
      storage,
      catalog: [bundledBackendProvider()],
      activationCompatibilityPolicy: () => ({ ok: true }),
      engineVersion: '0.15.0'
    })
    const loaded = await store.load()
    if (loaded.error) throw loaded.error
    const descriptor = listAppBackendProviderDescriptors(store)[0]
    if (!descriptor) throw new Error('Missing active Supabase provider')
    const documentValue = appBackendProviderDocumentValue({
      format: APP_BACKEND_PROVIDER_REQUEST_FORMAT,
      selection: descriptor,
      application: application()
    })
    let fetchCalls = 0
    const service = createAppDesktopSupabaseBackendReviewService({
      isDesktop: () => true,
      pluginStore: store,
      pluginStoreReady: () => (store.snapshot().ready ? undefined : store.load()),
      fetcher: async () => {
        fetchCalls += 1
        return new Response('{}')
      },
      dependencyOverrides: {
        resolveCredential: async () => PAT,
        resolveGrantGeneration: async () => null
      }
    })

    blockList = true
    const reloading = store.load()
    await reloadEntered
    expect(store.snapshot().ready).toBe(false)

    const review = service
      .review({
        config: { url: PROJECT_URL, anonKey: '', schema: 'public' },
        graph: graph(documentValue)
      })
      .then(
        () => 'unexpected-success',
        (cause) =>
          cause instanceof DesktopSupabaseBackendReviewError ? cause.code : 'unexpected-error'
      )
    let settled = false
    void review.finally(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    releaseReload?.()
    await reloading
    expect(await review).toBe('grant-unavailable')
    expect(listAppBackendProviderDescriptors(store)).toHaveLength(1)
    expect(fetchCalls).toBe(0)
  })

  test('builds from the live store and produces review-only evidence with one catalog POST', async () => {
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
    const documentValue = appBackendProviderDocumentValue({
      format: APP_BACKEND_PROVIDER_REQUEST_FORMAT,
      selection: descriptor,
      application: application()
    })
    const requests: Array<{ url: string; method: string; body: string }> = []
    const fetcher: SupabaseManagementDesktopFetch = async (input, init) => {
      const url = String(input)
      requests.push({ url, method: init?.method ?? 'GET', body: String(init?.body ?? '') })
      if (init?.method === 'POST') return jsonResponse(catalogResponse(), 201, url)
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
    let id = 0
    const service = createAppDesktopSupabaseBackendReviewService({
      isDesktop: () => true,
      fetcher,
      pluginStore: store,
      pluginStoreReady: () => Promise.resolve(),
      now: () => NOW,
      nextId: () => `review-id-${++id}`,
      dependencyOverrides: {
        resolveCredential: async () => PAT,
        resolveGrantGeneration: async () => GRANT_GENERATION
      }
    })

    const result = await service.review({
      config: { url: PROJECT_URL, anonKey: '', schema: 'public' },
      graph: graph(documentValue)
    })

    expect(result).toMatchObject({
      projectRef: PROJECT_REF,
      accountId: ORGANIZATION_ID,
      applyAvailable: false,
      applyPerformed: false
    })
    expect(result.artifact.inspectedReview.sql).toContain('Review only')
    expect(result.artifact.manifest.inspectedReview).toMatchObject({
      applyAllowed: false,
      releaseReady: false
    })
    expect(requests.filter(({ method }) => method === 'POST')).toHaveLength(1)
    expect(requests.filter(({ method }) => method === 'GET')).toHaveLength(2)
    expect(requests.some(({ url, body }) => url.includes(PAT) || body.includes(PAT))).toBe(false)
    const postBody = JSON.parse(requests.find(({ method }) => method === 'POST')?.body ?? '{}')
    expect(postBody).toHaveProperty('query')
    expect(Object.keys(postBody)).toEqual(['query', 'parameters'])
    expect(JSON.stringify(result)).not.toContain(PAT)
  })

  test('fails closed before returning an artifact when any public relation has a column ACL', async () => {
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
    const documentValue = appBackendProviderDocumentValue({
      format: APP_BACKEND_PROVIDER_REQUEST_FORMAT,
      selection: descriptor,
      application: application()
    })
    const requests: Array<{ url: string; method: string; body: string }> = []
    const fetcher: SupabaseManagementDesktopFetch = async (input, init) => {
      const url = String(input)
      requests.push({ url, method: init?.method ?? 'GET', body: String(init?.body ?? '') })
      if (init?.method === 'POST') return jsonResponse(catalogResponse(true), 201, url)
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
    const service = createAppDesktopSupabaseBackendReviewService({
      isDesktop: () => true,
      fetcher,
      pluginStore: store,
      pluginStoreReady: () => Promise.resolve(),
      now: () => NOW,
      nextId: () => 'review-id-column-acl',
      dependencyOverrides: {
        resolveCredential: async () => PAT,
        resolveGrantGeneration: async () => GRANT_GENERATION
      }
    })

    let artifact: unknown
    let error: DesktopSupabaseBackendReviewError | undefined
    try {
      artifact = await service.review({
        config: { url: PROJECT_URL, anonKey: '', schema: 'public' },
        graph: graph(documentValue)
      })
    } catch (cause) {
      if (cause instanceof DesktopSupabaseBackendReviewError) error = cause
    }

    expect(artifact).toBeUndefined()
    expect(error?.code).toBe('review-failed')
    expect(requests.filter(({ method }) => method === 'POST')).toHaveLength(1)
    expect(requests.some(({ url, body }) => url.includes(PAT) || body.includes(PAT))).toBe(false)
    expect(JSON.stringify(error)).not.toContain(PAT)
  })

  test('rebuilds live graph authority after project GET and before the catalog POST', async () => {
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
    let documentValue = appBackendProviderDocumentValue({
      format: APP_BACKEND_PROVIDER_REQUEST_FORMAT,
      selection: descriptor,
      application: application()
    })
    const liveGraph: AppBackendProviderDocumentGraph = {
      rootId: 'root-1',
      getNode(id) {
        if (id !== 'root-1') return undefined
        return {
          pluginData: [
            {
              pluginId: APP_BACKEND_PROVIDER_DOCUMENT_PLUGIN_ID,
              key: APP_BACKEND_PROVIDER_DOCUMENT_KEY,
              value: documentValue
            }
          ]
        }
      }
    }
    const requests: Array<{ method: string }> = []
    const fetcher: SupabaseManagementDesktopFetch = async (input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      requests.push({ method })
      if (method === 'POST') return jsonResponse(catalogResponse(), 201, url)
      documentValue = appBackendProviderDocumentValue({
        format: APP_BACKEND_PROVIDER_REQUEST_FORMAT,
        selection: descriptor,
        application: { ...application(), applicationId: 'mutated-during-project-get' }
      })
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
    const service = createAppDesktopSupabaseBackendReviewService({
      isDesktop: () => true,
      fetcher,
      pluginStore: store,
      pluginStoreReady: () => Promise.resolve(),
      now: () => NOW,
      nextId: () => 'review-id-stale',
      dependencyOverrides: {
        resolveCredential: async () => PAT,
        resolveGrantGeneration: async () => GRANT_GENERATION
      }
    })

    let code: string | undefined
    try {
      await service.review({
        config: { url: PROJECT_URL, anonKey: '', schema: 'public' },
        graph: liveGraph
      })
    } catch (cause) {
      if (cause instanceof DesktopSupabaseBackendReviewError) code = cause.code
    }

    expect(code).toBe('review-stale')
    expect(requests.filter(({ method }) => method === 'GET')).toHaveLength(1)
    expect(requests.filter(({ method }) => method === 'POST')).toHaveLength(0)
  })
})
