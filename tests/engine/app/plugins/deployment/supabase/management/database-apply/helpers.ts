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
  SupabaseManagementDatabaseApplyTransportError,
  type SupabaseManagementDatabaseApplyFetch
} from '@/app/plugins/host/deployment/supabase/management/database-apply-transport'

import type { RecordedRequest } from '#tests/engine/app/plugins/deployment/supabase/management/helpers'

const NOW = '2026-09-02T09:00:00.000Z'
export const PROJECT_REF = 'enekobitnhobuiuamvqj'
const ORGANIZATION_ID = 'org-123'
const GRANT_GENERATION = '123e4567-e89b-42d3-a456-426614174000'
export const PAT = 'sbp_apply_secret_canary_1234567890'
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

export interface DatabaseApplyBody {
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

export async function runBrandedApply(
  prepareApply: SupabaseBackendStagingApplyCapability['prepareApply'],
  dispatchJournal = createMemoryBackendHostReleaseDispatchJournal()
) {
  const { build, backendProvider, snapshot } = await releaseFixture()
  const sequence = ++releaseSequence
  let expectedReviewArtifactDigest = ''
  const stagingApply: SupabaseBackendStagingApplyCapability = {
    get expectedReviewArtifactDigest() {
      return expectedReviewArtifactDigest
    },
    prepareApply,
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
    dispatchJournal,
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
  return bridge.run({
    releaseId: `management-apply-release-${sequence}`,
    planId: `management-apply-plan-${sequence}`,
    receiptId: `management-apply-receipt-${sequence}`
  })
}

export async function captureBrandedApplyContext(): Promise<SupabaseBackendStagingApplyContext> {
  let captured: SupabaseBackendStagingApplyContext | undefined
  await runBrandedApply(async (context) => {
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
  })
  if (!captured) throw new Error('Release Controller did not mint a staging Apply context')
  return captured
}

export function jsonResponse(value: unknown, status: number, url = ''): Response {
  const response = new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  })
  if (url) Object.defineProperty(response, 'url', { value: url })
  return response
}

export function projectResponse(url = '', overrides: Record<string, unknown> = {}): Response {
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

export function successfulFetcher(
  requests?: RecordedRequest[]
): SupabaseManagementDatabaseApplyFetch {
  return async (input, init, maximum, timeout) => {
    const url = String(input)
    requests?.push({ url, init: init ?? {}, maximum, timeout })
    return init?.method === 'GET' ? projectResponse(url) : jsonResponse([], 201, url)
  }
}

export function errorCode(operation: Promise<unknown>): Promise<string | undefined> {
  return operation.then(
    () => undefined,
    (cause) =>
      cause instanceof SupabaseManagementDatabaseApplyTransportError ? cause.code : undefined
  )
}

export async function transportError(operation: Promise<unknown>) {
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

export async function sqlDigest(sql: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sql))
  return encodeBase64URL(new Uint8Array(digest))
}
