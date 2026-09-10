/* oxlint-disable eslint/max-lines -- One real Release Controller fixture covers the complete branded transport boundary. */
// Supabase deployment-domain mutation transport tests.
import { describe, expect, test } from 'bun:test'

import {
  createSupabaseInspectedMigrationSnapshot,
  type CreateSupabaseInspectedMigrationSnapshotInputV1
} from '@open-pencil/compiler/backend'
import type {
  BackendApplicationSpecV1,
  BackendCredentialRef,
  BackendReleaseProviderAuthorityV1
} from '@open-pencil/lowcode/backend'
import { digestCanonicalManifest } from '@open-pencil/scene-graph'

import {
  createAppPluginStore,
  createBundledPluginCatalog,
  createMemoryAppPluginStateStorage,
  type AppBundlePluginCatalogEntry
} from '@/app/plugins'
import {
  APP_BACKEND_PROVIDER_REQUEST_FORMAT,
  SUPABASE_BACKEND_PROVIDER_PLUGIN_ID,
  listAppBackendProviderDescriptors,
  prepareAppBackendProviderBuild,
  resolveAppBackendProviderReleaseAuthority
} from '@/app/plugins/host/backend-provider'
import { createMemoryBackendHostReleaseDispatchJournal } from '@/app/plugins/host/deployment/backend/release-journal'
import {
  createSupabaseBackendRelease,
  type SupabaseBackendReleaseSnapshotRequest,
  type SupabaseBackendStagingApplyCapability,
  type SupabaseBackendStagingApplyContext
} from '@/app/plugins/host/deployment/supabase/backend-release'
import {
  createSupabaseManagementDatabaseApplyTransport,
  SUPABASE_MANAGEMENT_DATABASE_APPLY_LIMITS,
  SupabaseManagementDatabaseApplyTransportError,
  type SupabaseManagementDatabaseApplyFetch
} from '@/app/plugins/host/deployment/supabase/management/database-apply-transport'

import type { RecordedRequest } from '#tests/engine/app/plugins/deployment/supabase/management/helpers'

const NOW = '2026-09-02T09:00:00.000Z'
const PROJECT_REF = 'enekobitnhobuiuamvqj'
const ORGANIZATION_ID = 'org-123'
const GRANT_GENERATION = '123e4567-e89b-42d3-a456-426614174000'
const PAT = 'sbp_apply_secret_canary_1234567890'
const CREDENTIAL_REF = 'credential.123e4567-e89b-42d3-a456-426614174000' as BackendCredentialRef

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

interface DatabaseApplyBody {
  readonly query: string
  readonly read_only: false
}

function bundledBackendProvider(): AppBundlePluginCatalogEntry {
  const entry = createBundledPluginCatalog().find(
    ({ manifest }) => manifest.plugin.id === SUPABASE_BACKEND_PROVIDER_PLUGIN_ID
  )
  if (entry?.trustSource !== 'app-bundle') throw new Error('Missing bundled Supabase provider')
  return entry
}

function ownerApplication(): BackendApplicationSpecV1 {
  return {
    format: 'openpencil.backend-application',
    version: 1,
    applicationId: 'supabase-management-apply-test',
    dataModel: {
      version: 1,
      entities: [
        {
          id: 'notes',
          name: 'notes',
          management: 'managed',
          fields: [
            { id: 'id', name: 'id', type: 'uuid', nullable: false },
            { id: 'owner_id', name: 'owner_id', type: 'uuid', nullable: false },
            { id: 'title', name: 'title', type: 'string', nullable: true }
          ],
          primaryKey: { fields: ['id'] },
          indexes: [{ id: 'notes_owner_idx', fields: ['owner_id'] }]
        }
      ],
      enums: [],
      relations: []
    },
    auth: {
      version: 1,
      identities: [{ id: 'user', kind: 'user' }],
      roles: [],
      ownership: [{ id: 'note-owner', entityId: 'notes', identityFieldId: 'owner_id' }],
      tenants: [],
      rowAccess: [
        {
          id: 'owner-access',
          entityId: 'notes',
          effect: 'allow',
          operations: ['select', 'insert'],
          principal: { kind: 'owner', ownershipId: 'note-owner' }
        }
      ]
    },
    workflows: { version: 1, workflows: [] },
    capabilities: [
      { capability: 'auth.identity', required: true },
      { capability: 'data.read', required: true },
      { capability: 'data.write', required: true },
      { capability: 'migrations.schema', required: true },
      { capability: 'policy.row-level', required: true }
    ],
    secrets: [
      {
        kind: 'environment',
        name: 'SUPABASE_URL',
        exposure: 'client-public',
        required: true
      },
      {
        kind: 'credential',
        credentialRef: CREDENTIAL_REF,
        name: 'SUPABASE_DEPLOY_AUTHORITY',
        exposure: 'host',
        required: true
      }
    ]
  }
}

function emptyInspection(): CreateSupabaseInspectedMigrationSnapshotInputV1 {
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

async function createReleaseFixture() {
  const store = createAppPluginStore({
    storage: createMemoryAppPluginStateStorage(),
    catalog: [bundledBackendProvider()],
    activationCompatibilityPolicy: () => ({ ok: true }),
    engineVersion: '0.15.0'
  })
  const pluginSnapshot = await store.load()
  if (pluginSnapshot.error) throw pluginSnapshot.error
  const descriptor = listAppBackendProviderDescriptors(store)[0]
  if (!descriptor) throw new Error('Missing active Supabase provider')
  const build = prepareAppBackendProviderBuild(
    store,
    {
      format: APP_BACKEND_PROVIDER_REQUEST_FORMAT,
      selection: descriptor,
      application: ownerApplication()
    },
    { target: 'react', mode: 'production' }
  )
  const backendProvider = resolveAppBackendProviderReleaseAuthority(store, descriptor)
  if (!backendProvider) throw new Error('Missing exact Supabase release authority')
  const snapshot = await createSupabaseInspectedMigrationSnapshot(emptyInspection())
  return { build, backendProvider, snapshot }
}

type ReleaseFixture = Awaited<ReturnType<typeof createReleaseFixture>>
let releaseFixturePromise: Promise<ReleaseFixture> | undefined
let releaseSequence = 0

function releaseFixture(): Promise<ReleaseFixture> {
  releaseFixturePromise ??= createReleaseFixture()
  return releaseFixturePromise
}

async function captureBrandedApplyContext(): Promise<SupabaseBackendStagingApplyContext> {
  const { build, backendProvider, snapshot } = await releaseFixture()
  const sequence = ++releaseSequence
  let expectedReviewArtifactDigest = ''
  let captured: SupabaseBackendStagingApplyContext | undefined
  const stagingApply: SupabaseBackendStagingApplyCapability = {
    get expectedReviewArtifactDigest() {
      return expectedReviewArtifactDigest
    },
    async prepareApply(context) {
      captured = context
      return Object.freeze({
        async dispatch() {
          return {
            ok: false as const,
            kind: 'precondition' as const,
            code: 'test-context-capture-only'
          }
        }
      })
    },
    async reconcile() {
      return {
        outcome: 'outcome-unknown' as const,
        code: 'test-context-capture-only',
        remoteOperationIds: []
      }
    }
  }
  const bridge = createSupabaseBackendRelease({
    build,
    backendProvider: backendProvider as BackendReleaseProviderAuthorityV1,
    documentDigest: await digestCanonicalManifest({ document: 'management-apply-test' }),
    compilerVersion: '0.15.0',
    environment: 'staging',
    projectRef: PROJECT_REF,
    accountId: ORGANIZATION_ID,
    grantGeneration: GRANT_GENERATION,
    dispatchJournal: createMemoryBackendHostReleaseDispatchJournal(),
    revalidateLocalAuthority: async () => undefined,
    snapshotProvider: async (_input: SupabaseBackendReleaseSnapshotRequest) => ({
      snapshot,
      expectedInspectedSchemaDigest: snapshot.inspectedSchemaDigest
    }),
    reviewBackendRelease({ artifact }) {
      expectedReviewArtifactDigest = artifact.manifestDigest
      return true
    },
    confirmBackendRelease: () => [],
    stagingApply,
    now: () => NOW
  })
  await bridge.run({
    releaseId: `management-apply-release-${sequence}`,
    planId: `management-apply-plan-${sequence}`,
    receiptId: `management-apply-receipt-${sequence}`
  })
  if (!captured) throw new Error('Release Controller did not mint a staging Apply context')
  return captured
}

function jsonResponse(value: unknown, status: number, url = ''): Response {
  const response = new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  })
  if (url) Object.defineProperty(response, 'url', { value: url })
  return response
}

function projectResponse(url = '', overrides: Record<string, unknown> = {}): Response {
  return jsonResponse(
    {
      ref: PROJECT_REF,
      organization_id: ORGANIZATION_ID,
      organization_slug: 'open-pencil-staging',
      name: 'Staging',
      ...overrides
    },
    200,
    url
  )
}

function successfulFetcher(requests?: RecordedRequest[]): SupabaseManagementDatabaseApplyFetch {
  return async (input, init, maximum, timeout) => {
    const url = String(input)
    requests?.push({ url, init: init ?? {}, maximum, timeout })
    return init?.method === 'GET' ? projectResponse(url) : jsonResponse([], 201, url)
  }
}

function errorCode(operation: Promise<unknown>): Promise<string | undefined> {
  return operation.then(
    () => undefined,
    (cause) =>
      cause instanceof SupabaseManagementDatabaseApplyTransportError ? cause.code : undefined
  )
}

async function transportError(operation: Promise<unknown>) {
  try {
    await operation
  } catch (cause) {
    if (cause instanceof SupabaseManagementDatabaseApplyTransportError) return cause
  }
  throw new TypeError('Expected a typed Supabase Management Apply transport error')
}

function encodeBase64URL(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

async function sqlDigest(sql: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sql))
  return encodeBase64URL(new Uint8Array(digest))
}

describe('Supabase Management trusted database Apply transport', () => {
  test('checks authority at prepare and again before one exact single-use query dispatch', async () => {
    const context = await captureBrandedApplyContext()
    const requests: RecordedRequest[] = []
    const transport = createSupabaseManagementDatabaseApplyTransport({
      personalAccessToken: PAT,
      fetcher: successfulFetcher(requests)
    })

    const prepared = await transport.prepareReviewedMigration(context)

    expect(Object.keys(transport)).toEqual(['prepareReviewedMigration'])
    expect(Object.keys(prepared)).toEqual(['dispatch'])
    expect(Object.isFrozen(prepared)).toBe(true)
    expect(requests).toHaveLength(1)
    expect(requests[0]?.url).toBe(`https://api.supabase.com/v1/projects/${PROJECT_REF}`)
    expect(requests[0]?.init.method).toBe('GET')

    const result = await prepared.dispatch()

    expect(requests).toHaveLength(3)
    expect(requests[1]?.url).toBe(`https://api.supabase.com/v1/projects/${PROJECT_REF}`)
    expect(requests[1]?.init.method).toBe('GET')
    expect(requests[2]?.url).toBe(
      `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`
    )
    expect(requests[2]?.init.method).toBe('POST')
    expect(requests.every(({ init }) => init.redirect === 'error')).toBe(true)
    expect(requests.every(({ init }) => init.credentials === 'omit')).toBe(true)
    expect(requests.every(({ timeout }) => timeout === 180_000)).toBe(true)
    expect(requests.map(({ maximum }) => maximum)).toEqual([
      SUPABASE_MANAGEMENT_DATABASE_APPLY_LIMITS.maxProjectResponseBytes,
      SUPABASE_MANAGEMENT_DATABASE_APPLY_LIMITS.maxProjectResponseBytes,
      SUPABASE_MANAGEMENT_DATABASE_APPLY_LIMITS.maxApplyResponseBytes
    ])
    const bodyText = requests[2]?.init.body
    if (typeof bodyText !== 'string') throw new TypeError('Expected exact JSON body')
    const body = JSON.parse(bodyText) as DatabaseApplyBody
    expect(Object.keys(body)).toEqual(['query', 'read_only'])
    expect(body).toEqual({ query: context.artifact.inspectedReview.sql, read_only: false })
    expect(body.query).toStartWith(
      [
        '-- OpenPencil Supabase inspected migration review v1.',
        '-- Review only. The Compiler has no network, credential, filesystem, or Apply authority.',
        'BEGIN;',
        "SET LOCAL lock_timeout = '5s';",
        "SET LOCAL statement_timeout = '15s';",
        'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;',
        ''
      ].join('\n')
    )
    expect(bodyText).not.toContain(PAT)
    expect(requests.some(({ url }) => url.includes(PAT))).toBe(false)
    expect(new Headers(requests[2]?.init.headers).get('authorization')).toBe(`Bearer ${PAT}`)
    expect(result).toEqual({ provider: 'supabase', status: 201, remoteOperationIds: [] })
    expect(Object.isFrozen(result)).toBe(true)
    expect(await errorCode(prepared.dispatch())).toBe('dispatch-already-used')
    expect(requests.filter(({ init }) => init.method === 'POST')).toHaveLength(1)
  })

  test('rejects plain or hand-wrapped SQL contexts without exposing a test mint', async () => {
    const branded = await captureBrandedApplyContext()
    const manualSQL = [
      '-- OpenPencil Supabase inspected migration review v1.',
      '-- Review only. The Compiler has no network, credential, filesystem, or Apply authority.',
      'BEGIN;',
      "SET LOCAL lock_timeout = '5s';",
      "SET LOCAL statement_timeout = '15s';",
      'SELECT 1;',
      'COMMIT;',
      ''
    ].join('\n')
    const plainClone = { artifact: branded.artifact, release: branded.release }
    const handWrapped = {
      artifact: {
        ...branded.artifact,
        inspectedReview: {
          ...branded.artifact.inspectedReview,
          sql: manualSQL,
          manifest: {
            ...branded.artifact.inspectedReview.manifest,
            sqlDigest: await sqlDigest(manualSQL)
          }
        }
      },
      release: branded.release
    }
    let fetchCalls = 0
    const transport = createSupabaseManagementDatabaseApplyTransport({
      personalAccessToken: PAT,
      fetcher: async () => {
        fetchCalls += 1
        return projectResponse()
      }
    })

    for (const forged of [plainClone, handWrapped]) {
      expect(
        await errorCode(
          transport.prepareReviewedMigration(forged as SupabaseBackendStagingApplyContext)
        )
      ).toBe('invalid-authority')
    }
    expect(fetchCalls).toBe(0)
  })

  test('fails project authority before any mutation dispatch', async () => {
    for (const overrides of [
      { ref: 'differentprojectrefaa' },
      { organization_id: 'org-foreign' },
      { organization_slug: '' }
    ]) {
      const context = await captureBrandedApplyContext()
      let postCalls = 0
      const transport = createSupabaseManagementDatabaseApplyTransport({
        personalAccessToken: PAT,
        fetcher: async (input, init) => {
          if (init?.method === 'POST') postCalls += 1
          return projectResponse(String(input), overrides)
        }
      })

      expect(await errorCode(transport.prepareReviewedMigration(context))).toBe('invalid-authority')
      expect(postCalls).toBe(0)
    }
  })

  test('rechecks project authority immediately before POST and consumes the attempt on failure', async () => {
    for (const failure of ['transferred', 'network'] as const) {
      const context = await captureBrandedApplyContext()
      let getCalls = 0
      let postCalls = 0
      const transport = createSupabaseManagementDatabaseApplyTransport({
        personalAccessToken: PAT,
        fetcher: async (input, init) => {
          if (init?.method === 'POST') {
            postCalls += 1
            return jsonResponse({}, 201, String(input))
          }
          getCalls += 1
          if (getCalls === 2) {
            if (failure === 'network') throw new Error(`authority lookup failed ${PAT}`)
            return projectResponse(String(input), { organization_id: 'org-transferred' })
          }
          return projectResponse(String(input))
        }
      })
      const prepared = await transport.prepareReviewedMigration(context)
      const error = await transportError(prepared.dispatch())
      expect(error.code).toBe('authority-recheck-failed')
      expect(error.message).not.toContain(PAT)
      expect(postCalls).toBe(0)
      expect(await errorCode(prepared.dispatch())).toBe('dispatch-already-used')
    }
  })

  test('requires exact response status, URL, redirect policy, media type, and body', async () => {
    const cases: ReadonlyArray<{
      phase: 'prepare' | 'dispatch'
      expected: string
      fetcher: SupabaseManagementDatabaseApplyFetch
    }> = [
      {
        phase: 'prepare',
        expected: 'http-error',
        fetcher: async (input) => jsonResponse({}, 201, String(input))
      },
      {
        phase: 'prepare',
        expected: 'http-error',
        fetcher: async (input) => {
          const response = projectResponse(String(input))
          Object.defineProperty(response, 'redirected', { value: true })
          return response
        }
      },
      {
        phase: 'dispatch',
        expected: 'http-error',
        fetcher: async (input, init) =>
          init?.method === 'GET'
            ? projectResponse(String(input))
            : jsonResponse({}, 200, String(input))
      },
      {
        phase: 'dispatch',
        expected: 'http-error',
        fetcher: async (input, init) =>
          init?.method === 'GET'
            ? projectResponse(String(input))
            : jsonResponse({}, 201, 'https://api.supabase.com/redirected')
      },
      {
        phase: 'dispatch',
        expected: 'invalid-response',
        fetcher: async (input, init) =>
          init?.method === 'GET'
            ? projectResponse(String(input))
            : new Response('{}', {
                status: 201,
                headers: { 'content-type': 'text/plain' }
              })
      },
      {
        phase: 'dispatch',
        expected: 'invalid-response',
        fetcher: async (input, init) =>
          init?.method === 'GET'
            ? projectResponse(String(input))
            : jsonResponse({ operation_id: 'untrusted' }, 201, String(input))
      },
      {
        phase: 'dispatch',
        expected: 'invalid-response',
        fetcher: async (input, init) =>
          init?.method === 'GET'
            ? projectResponse(String(input))
            : jsonResponse([{ unexpected: true }], 201, String(input))
      }
    ]

    for (const entry of cases) {
      const context = await captureBrandedApplyContext()
      const transport = createSupabaseManagementDatabaseApplyTransport({
        personalAccessToken: PAT,
        fetcher: entry.fetcher
      })
      if (entry.phase === 'prepare') {
        expect(await errorCode(transport.prepareReviewedMigration(context))).toBe(entry.expected)
      } else {
        const prepared = await transport.prepareReviewedMigration(context)
        expect(await errorCode(prepared.dispatch())).toBe(entry.expected)
      }
    }
  })

  test('bounds project and Apply response bytes and rejects invalid UTF-8 JSON', async () => {
    const oversizedProjectContext = await captureBrandedApplyContext()
    const oversizedProjectTransport = createSupabaseManagementDatabaseApplyTransport({
      personalAccessToken: PAT,
      fetcher: async () =>
        new Response('{}', {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'content-length': String(
              SUPABASE_MANAGEMENT_DATABASE_APPLY_LIMITS.maxProjectResponseBytes + 1
            )
          }
        })
    })
    expect(
      await errorCode(oversizedProjectTransport.prepareReviewedMigration(oversizedProjectContext))
    ).toBe('response-too-large')

    const invalidUTF8Context = await captureBrandedApplyContext()
    const invalidUTF8Transport = createSupabaseManagementDatabaseApplyTransport({
      personalAccessToken: PAT,
      fetcher: async () =>
        new Response(new Uint8Array([0xff]), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
    })
    expect(await errorCode(invalidUTF8Transport.prepareReviewedMigration(invalidUTF8Context))).toBe(
      'invalid-response'
    )

    const oversizedApplyContext = await captureBrandedApplyContext()
    const oversizedApplyTransport = createSupabaseManagementDatabaseApplyTransport({
      personalAccessToken: PAT,
      fetcher: async (input, init) =>
        init?.method === 'GET'
          ? projectResponse(String(input))
          : new Response('{}', {
              status: 201,
              headers: {
                'content-type': 'application/json',
                'content-length': String(
                  SUPABASE_MANAGEMENT_DATABASE_APPLY_LIMITS.maxApplyResponseBytes + 1
                )
              }
            })
    })
    const prepared = await oversizedApplyTransport.prepareReviewedMigration(oversizedApplyContext)
    expect(await errorCode(prepared.dispatch())).toBe('response-too-large')
  })

  test('maps aborts and network failures to typed secret-free, non-retryable errors', async () => {
    const prepareAbortContext = await captureBrandedApplyContext()
    const prepareController = new AbortController()
    prepareController.abort()
    let abortedFetchCalls = 0
    const prepareAbortTransport = createSupabaseManagementDatabaseApplyTransport({
      personalAccessToken: PAT,
      signal: prepareController.signal,
      fetcher: async () => {
        abortedFetchCalls += 1
        return projectResponse()
      }
    })
    expect(
      await errorCode(prepareAbortTransport.prepareReviewedMigration(prepareAbortContext))
    ).toBe('aborted')
    expect(abortedFetchCalls).toBe(0)

    const dispatchAbortContext = await captureBrandedApplyContext()
    const dispatchController = new AbortController()
    let abortPostCalls = 0
    const dispatchAbortTransport = createSupabaseManagementDatabaseApplyTransport({
      personalAccessToken: PAT,
      signal: dispatchController.signal,
      fetcher: async (input, init) => {
        if (init?.method === 'POST') abortPostCalls += 1
        return init?.method === 'GET'
          ? projectResponse(String(input))
          : jsonResponse({}, 201, String(input))
      }
    })
    const abortedPrepared =
      await dispatchAbortTransport.prepareReviewedMigration(dispatchAbortContext)
    dispatchController.abort()
    expect(await errorCode(abortedPrepared.dispatch())).toBe('authority-recheck-failed')
    expect(await errorCode(abortedPrepared.dispatch())).toBe('dispatch-already-used')
    expect(abortPostCalls).toBe(0)

    const networkContext = await captureBrandedApplyContext()
    let postCalls = 0
    const networkTransport = createSupabaseManagementDatabaseApplyTransport({
      personalAccessToken: PAT,
      fetcher: async (input, init) => {
        if (init?.method === 'GET') return projectResponse(String(input))
        postCalls += 1
        throw new Error(`ambiguous provider outcome ${PAT}`)
      }
    })
    const networkPrepared = await networkTransport.prepareReviewedMigration(networkContext)
    const error = await transportError(networkPrepared.dispatch())
    expect(error.code).toBe('network-failed')
    expect(error.message).not.toContain(PAT)
    expect(error.message).not.toContain(PROJECT_REF)
    expect(await errorCode(networkPrepared.dispatch())).toBe('dispatch-already-used')
    expect(postCalls).toBe(1)
  })
})
