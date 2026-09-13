import { describe, expect, test } from 'bun:test'

import {
  SUPABASE_MANAGEMENT_GRANT_GENERATION_CREDENTIAL,
  SUPABASE_MANAGEMENT_PAT_CREDENTIAL
} from '@/app/lowcode/supabase/credentials'
import { createAppPluginStore, createMemoryAppPluginStateStorage } from '@/app/plugins'
import { appPluginStore, appPluginStoreReady } from '@/app/plugins/app'
import {
  APP_BACKEND_PROVIDER_DOCUMENT_KEY,
  APP_BACKEND_PROVIDER_DOCUMENT_PLUGIN_ID,
  APP_BACKEND_PROVIDER_REQUEST_FORMAT,
  appBackendProviderDocumentValue,
  listAppBackendProviderDescriptors,
  type AppBackendProviderDocumentGraph
} from '@/app/plugins/host/backend-provider'
import { DesktopSupabaseBackendReviewError } from '@/app/plugins/host/deployment/desktop/supabase/backend/review'
import {
  createAppDesktopSupabaseBackendReviewService,
  createAppDesktopSupabaseBackendReviewServiceForTestingV1
} from '@/app/plugins/host/deployment/desktop/supabase/backend/review-app'
import type { SupabaseManagementDesktopFetch } from '@/app/plugins/host/deployment/supabase/management/pg-catalog-transport'
import { appCredentialServices } from '@/app/settings/credentials/app'

import { clearTauriMocks, mockTauriIPC } from '#tests/helpers/tauri/mocks'

import {
  PROJECT_REF,
  PROJECT_URL,
  ORGANIZATION_ID,
  GRANT_GENERATION,
  PAT,
  NOW,
  bundledBackendProvider,
  application,
  graph,
  catalogResponse,
  jsonResponse
} from './helpers'

async function restoreCredential(
  reference: typeof SUPABASE_MANAGEMENT_PAT_CREDENTIAL,
  value: string | null
): Promise<void> {
  if (value === null) await appCredentialServices.manager.clear(reference)
  else await appCredentialServices.manager.set(reference, value)
}

async function withProductionReviewCredentials<T>(operation: () => Promise<T>): Promise<T> {
  const previousPat = await appCredentialServices.resolver.resolve(
    SUPABASE_MANAGEMENT_PAT_CREDENTIAL
  )
  const previousGrant = await appCredentialServices.resolver.resolve(
    SUPABASE_MANAGEMENT_GRANT_GENERATION_CREDENTIAL
  )
  await appCredentialServices.manager.set(SUPABASE_MANAGEMENT_PAT_CREDENTIAL, PAT)
  await appCredentialServices.manager.set(
    SUPABASE_MANAGEMENT_GRANT_GENERATION_CREDENTIAL,
    GRANT_GENERATION
  )
  try {
    return await operation()
  } finally {
    await restoreCredential(SUPABASE_MANAGEMENT_PAT_CREDENTIAL, previousPat)
    await restoreCredential(SUPABASE_MANAGEMENT_GRANT_GENERATION_CREDENTIAL, previousGrant)
  }
}

describe('Desktop Supabase Backend Provider review app wiring', () => {
  test('maps bounded native review failures through the production-only transport', async () => {
    const loaded = await appPluginStoreReady
    if (loaded.error) throw loaded.error
    const descriptor = listAppBackendProviderDescriptors(appPluginStore).find(
      (provider) => provider.providerId === 'supabase'
    )
    if (!descriptor) throw new Error('Missing production Supabase provider')
    const documentValue = appBackendProviderDocumentValue({
      format: APP_BACKEND_PROVIDER_REQUEST_FORMAT,
      selection: descriptor,
      application: application()
    })
    const cases = [
      ['credential-missing', 'credential-missing'],
      ['credential-changed', 'grant-changed'],
      ['invalid-authority', 'review-failed'],
      ['write-credential-missing', 'review-failed'],
      ['credential-not-independent', 'review-failed']
    ] as const

    await withProductionReviewCredentials(async () => {
      for (const [nativeCode, expectedCode] of cases) {
        let calls = 0
        await mockTauriIPC((command, args) => {
          calls += 1
          expect(command).toBe('supabase_management_inspect_pg_catalog_v1')
          expect(JSON.stringify(args)).not.toContain(PAT)
          throw { code: nativeCode, message: `provider-controlled ${PAT}` }
        })
        try {
          const service = createAppDesktopSupabaseBackendReviewService()
          let error: unknown
          try {
            await service.review({
              config: { url: PROJECT_URL, anonKey: '', schema: 'public' },
              graph: graph(documentValue)
            })
          } catch (cause) {
            error = cause
          }
          expect(error).toBeInstanceOf(DesktopSupabaseBackendReviewError)
          expect((error as DesktopSupabaseBackendReviewError).code).toBe(expectedCode)
          expect(JSON.stringify(error)).not.toContain(PAT)
          expect(calls).toBe(1)
        } finally {
          await clearTauriMocks()
        }
      }
    })
  })

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
    const service = createAppDesktopSupabaseBackendReviewServiceForTestingV1({
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
    const service = createAppDesktopSupabaseBackendReviewServiceForTestingV1({
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
    const service = createAppDesktopSupabaseBackendReviewServiceForTestingV1({
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
    const service = createAppDesktopSupabaseBackendReviewServiceForTestingV1({
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
    const service = createAppDesktopSupabaseBackendReviewServiceForTestingV1({
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
