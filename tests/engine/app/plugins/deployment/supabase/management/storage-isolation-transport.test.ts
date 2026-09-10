/* oxlint-disable eslint(complexity) -- The stateful mock service intentionally models all Management, Auth, and Storage endpoints in one closure. */
import { describe, expect, test } from 'bun:test'

import {
  digestBackendApplication,
  type BackendApplicationSpecV1,
  type BackendReleaseProviderAuthorityV1
} from '@open-pencil/lowcode/backend'

import {
  createSupabaseManagementStorageIsolationTransport,
  supabaseTenantStoragePartitionKey,
  type CreateSupabaseManagementStorageIsolationTransportOptions,
  type SupabaseManagementStorageFetch
} from '@/app/plugins/host/deployment/supabase/management/storage-isolation-transport'
import {
  createSupabaseStorageIsolationVerification,
  type SupabaseStorageIsolationAuthority
} from '@/app/plugins/host/deployment/supabase/storage-isolation-verifier'

const PROJECT_REF = 'abcdefghijklmnopqrst'
const ACCOUNT_ID = 'account-1'
const GRANT = 'grant-1'
const DIGEST = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const NOW = '2026-09-03T12:00:00.000Z'
const USER_A = '11111111-1111-4111-8111-111111111111'
const USER_B = '22222222-2222-4222-8222-222222222222'
const TOKEN_A = `eyJ${'a'.repeat(48)}.${'x'.repeat(24)}`
const TOKEN_B = `eyJ${'b'.repeat(48)}.${'y'.repeat(24)}`

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

function application(): BackendApplicationSpecV1 {
  return {
    format: 'openpencil.backend-application',
    version: 1,
    applicationId: 'storage-live-probe',
    dataModel: { version: 1, entities: [], enums: [], relations: [] },
    auth: {
      version: 1,
      identities: [{ id: 'user', kind: 'user' }],
      roles: [],
      ownership: [],
      tenants: [],
      rowAccess: []
    },
    workflows: { version: 1, workflows: [] },
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
    capabilities: [{ capability: 'storage.objects', required: true }],
    secrets: []
  }
}

const provider: BackendReleaseProviderAuthorityV1 = {
  publisherId: 'open-pencil',
  packageDigest: `app-bundle-sha256:${DIGEST}`,
  pluginId: 'openpencil.supabase-backend',
  contributionId: 'supabase.backend',
  providerId: 'supabase',
  adapterId: 'open-pencil.backend.supabase',
  adapterVersion: '1.0.0',
  contractVersion: 1,
  supportedModelVersions: [1],
  capabilities: ['storage.objects'],
  permissions: [],
  outputKinds: ['security-policy']
}

async function authority(
  app: BackendApplicationSpecV1
): Promise<SupabaseStorageIsolationAuthority> {
  return {
    releaseAuthority: 'host.supabase-storage-isolation.v1',
    environment: 'staging',
    projectRef: PROJECT_REF,
    accountId: ACCOUNT_ID,
    grantGeneration: GRANT,
    provider,
    applicationDigest: await digestBackendApplication(app),
    storagePolicyArtifactDigest: DIGEST
  }
}

function actor(init: RequestInit | undefined): 'anonymous' | 'user-a' | 'user-b' {
  const headers = init?.headers as Record<string, string>
  if (!headers.authorization) return 'anonymous'
  if (headers.authorization === `Bearer ${TOKEN_A}`) return 'user-a'
  if (headers.authorization === `Bearer ${TOKEN_B}`) return 'user-b'
  throw new Error('unexpected bearer token')
}

interface MockServiceOptions {
  readonly failFirstProbe?: boolean
  readonly preserveDeletedObject?: boolean
  readonly rejectUserBJwtOnProbe?: boolean
  readonly expireUserBOnFinalProof?: boolean
}

function mockService(options: MockServiceOptions = {}): {
  readonly fetcher: SupabaseManagementStorageFetch
  readonly requests: string[]
} {
  const objects = new Map<string, Uint8Array>()
  const requests: string[] = []
  let probeCount = 0
  let userBAuthChecks = 0
  const fetcher: SupabaseManagementStorageFetch = async (input, init) => {
    const url = String(input)
    requests.push(`${init?.method ?? 'GET'} ${url}`)
    if (url === `https://api.supabase.com/v1/projects/${PROJECT_REF}`) {
      const headers = (init?.headers ?? {}) as Record<string, string>
      expect(headers.authorization).toStartWith('Bearer sbp_')
      return json({ ref: PROJECT_REF, organization_id: ACCOUNT_ID })
    }
    if (url === `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query/read-only`) {
      expect(init?.method).toBe('POST')
      const body = JSON.parse(String(init?.body))
      expect(body.query).toContain('from storage.buckets')
      expect(body.parameters).toEqual(['user-assets'])
      return json(
        [
          {
            id: 'user-assets',
            name: 'user-assets',
            public: false,
            file_size_limit: 64,
            allowed_mime_types: ['image/png']
          }
        ],
        201
      )
    }
    if (url === `https://${PROJECT_REF}.supabase.co/auth/v1/user`) {
      const identity = actor(init)
      const headers = (init?.headers ?? {}) as Record<string, string>
      expect(headers.apikey).toStartWith('sb_publishable_')
      if (identity === 'user-b') {
        userBAuthChecks += 1
        if (options.expireUserBOnFinalProof && userBAuthChecks === 2) {
          return json({ error: 'InvalidJWT' }, 401)
        }
      }
      return json({ id: identity === 'user-a' ? USER_A : USER_B })
    }
    if (!url.startsWith(`https://${PROJECT_REF}.supabase.co/storage/v1/object/`)) {
      throw new Error(`unexpected request ${url}`)
    }
    probeCount += 1
    if (options.failFirstProbe && probeCount === 1) return json({ message: 'temporary' }, 503)
    const identity = actor(init)
    if (options.rejectUserBJwtOnProbe && identity === 'user-b') {
      return json({ error: 'InvalidJWT' }, 401)
    }
    const contentType = ((init?.headers ?? {}) as Record<string, string>)['content-type']
    const isDeleteRoot = url.endsWith('/storage/v1/object/user-assets')
    const objectPath = isDeleteRoot
      ? String((JSON.parse(String(init?.body)) as { prefixes: string[] }).prefixes[0])
      : decodeURIComponent(url.split('/storage/v1/object/user-assets/')[1] ?? '')
    const allowedIdentity = identity === 'user-a'
    const allowedPath = objectPath.startsWith(`users/${USER_A}/`)

    if (init?.method === 'GET') {
      if (!allowedIdentity || !allowedPath) {
        return json({ message: `denied-${'x'.repeat(256)}` }, 403)
      }
      const value = objects.get(objectPath)
      return value
        ? new Response(value.slice(), { status: 200, headers: { 'content-type': 'image/png' } })
        : json({ message: 'missing' }, 404)
    }
    if (init?.method === 'DELETE') {
      if (!allowedIdentity || !allowedPath) return json({ message: 'denied' }, 403)
      if (!options.preserveDeletedObject) objects.delete(objectPath)
      return json({ message: 'deleted' })
    }
    const bytes = new Uint8Array(await new Response(init?.body).arrayBuffer())
    if (!allowedIdentity || !allowedPath) return json({ message: 'denied' }, 403)
    if (contentType !== 'image/png') return json({ message: 'mime rejected' }, 400)
    if (bytes.byteLength > 64) return json({ message: 'too large' }, 413)
    objects.set(objectPath, bytes)
    return json({ key: `user-assets/${objectPath}` })
  }
  return { fetcher, requests }
}

type TransportOverrides = Partial<
  Pick<
    CreateSupabaseManagementStorageIsolationTransportOptions,
    'tenantPartitions' | 'signal' | 'requestTimeoutMs' | 'probeTimeoutMs'
  >
>

function transport(fetcher: SupabaseManagementStorageFetch, overrides: TransportOverrides = {}) {
  return createSupabaseManagementStorageIsolationTransport({
    personalAccessToken: `sbp_${'p'.repeat(40)}`,
    publishableKey: `sb_publishable_${'k'.repeat(40)}`,
    authority: { projectRef: PROJECT_REF, accountId: ACCOUNT_ID, grantGeneration: GRANT },
    userA: { userId: USER_A, accessToken: TOKEN_A },
    userB: { userId: USER_B, accessToken: TOKEN_B },
    fetcher,
    now: () => NOW,
    ...overrides
  })
}

describe('Supabase Management Storage isolation transport', () => {
  test('binds live identities and proves owner CRUD/upsert plus negative isolation checks', async () => {
    const app = application()
    const service = mockService()
    const session = createSupabaseStorageIsolationVerification({
      verificationId: 'management-storage-probe-1',
      application: app,
      authority: await authority(app),
      bucketId: 'user-assets',
      ruleId: 'owner-files',
      maxProbePayloadBytes: 65,
      transport: transport(service.fetcher),
      now: () => NOW
    })
    const receipt = await session.verify()
    expect(receipt.outcome).toBe('succeeded')
    expect(receipt.checks).toHaveLength(13)
    expect(receipt.remoteOperationIds).toHaveLength(16)
    expect(service.requests.filter((entry) => entry.includes('/auth/v1/user'))).toHaveLength(4)
    expect(service.requests.filter((entry) => entry.includes('/storage/v1/object/'))).toHaveLength(
      14
    )
    expect(
      service.requests.some((entry) =>
        entry.startsWith(
          `GET https://${PROJECT_REF}.supabase.co/storage/v1/object/user-assets/users/${USER_A}/`
        )
      )
    ).toBe(true)
    const serialized = JSON.stringify(receipt)
    expect(serialized).not.toContain(TOKEN_A)
    expect(serialized).not.toContain(TOKEN_B)
    expect(serialized).not.toContain('sbp_')
  })

  test('records outcome-unknown after a transient Storage response once dispatch starts', async () => {
    const app = application()
    const service = mockService({ failFirstProbe: true })
    const session = createSupabaseStorageIsolationVerification({
      verificationId: 'management-storage-probe-2',
      application: app,
      authority: await authority(app),
      bucketId: 'user-assets',
      ruleId: 'owner-files',
      maxProbePayloadBytes: 65,
      transport: transport(service.fetcher),
      now: () => NOW
    })
    const receipt = await session.verify()
    expect(receipt).toMatchObject({
      dispatch: 'outcome-unknown',
      outcome: 'outcome-unknown',
      failureCode: 'cleanup-required'
    })
    expect(service.requests.filter((entry) => entry.includes('/storage/v1/object/'))).toHaveLength(
      1
    )
  })

  test('retains cleanup residual until the post-delete GET proves an exact 404', async () => {
    const app = application()
    const service = mockService({ preserveDeletedObject: true })
    const session = createSupabaseStorageIsolationVerification({
      verificationId: 'management-storage-probe-delete-confirmation',
      application: app,
      authority: await authority(app),
      bucketId: 'user-assets',
      ruleId: 'owner-files',
      maxProbePayloadBytes: 65,
      transport: transport(service.fetcher),
      now: () => NOW
    })

    const receipt = await session.verify()

    expect(receipt).toMatchObject({
      dispatch: 'outcome-unknown',
      outcome: 'outcome-unknown',
      failureCode: 'cleanup-required'
    })
    expect(receipt.residualObjectPaths).toHaveLength(1)
    expect(service.requests.filter((entry) => entry.includes('/storage/v1/object/'))).toHaveLength(
      14
    )
  })

  test('rejects an authenticated InvalidJWT response instead of counting it as RLS denial', async () => {
    const app = application()
    const service = mockService({ rejectUserBJwtOnProbe: true })
    const session = createSupabaseStorageIsolationVerification({
      verificationId: 'management-storage-probe-invalid-jwt',
      application: app,
      authority: await authority(app),
      bucketId: 'user-assets',
      ruleId: 'owner-files',
      maxProbePayloadBytes: 65,
      transport: transport(service.fetcher),
      now: () => NOW
    })

    await expect(session.verify()).resolves.toMatchObject({
      dispatch: 'outcome-unknown',
      outcome: 'outcome-unknown',
      failureCode: 'cleanup-required'
    })
  })

  test('requires both actor sessions to remain live immediately before success', async () => {
    const app = application()
    const service = mockService({ expireUserBOnFinalProof: true })
    const session = createSupabaseStorageIsolationVerification({
      verificationId: 'management-storage-probe-final-auth',
      application: app,
      authority: await authority(app),
      bucketId: 'user-assets',
      ruleId: 'owner-files',
      maxProbePayloadBytes: 65,
      transport: transport(service.fetcher),
      now: () => NOW
    })

    await expect(session.verify()).resolves.toMatchObject({
      dispatch: 'outcome-unknown',
      outcome: 'outcome-unknown',
      failureCode: 'transport-failed',
      residualObjectPaths: []
    })
    expect(service.requests.filter((entry) => entry.includes('/auth/v1/user'))).toHaveLength(4)
  })

  test('binds tenant partitions to bucket plus rule and rejects an ambiguous legacy collision', async () => {
    const service = mockService()
    const rule = {
      id: 'tenant-files',
      prefix: ['tenants'],
      principal: { kind: 'tenant-member' as const, tenantId: 'organizations' },
      operations: ['read', 'create', 'update', 'delete', 'upsert'] as const
    }
    const scoped = transport(service.fetcher, {
      tenantPartitions: {
        [supabaseTenantStoragePartitionKey('bucket-a', rule.id)]: {
          allowedPartition: 'tenant-a',
          deniedPartition: 'tenant-b'
        },
        [supabaseTenantStoragePartitionKey('bucket-b', rule.id)]: {
          allowedPartition: 'tenant-c',
          deniedPartition: 'tenant-d'
        }
      }
    })

    await expect(
      scoped.resolveActors({ projectRef: PROJECT_REF, bucketName: 'bucket-a', rule })
    ).resolves.toMatchObject({ allowedPartition: 'tenant-a', deniedPartition: 'tenant-b' })
    await expect(
      scoped.resolveActors({ projectRef: PROJECT_REF, bucketName: 'bucket-b', rule })
    ).resolves.toMatchObject({ allowedPartition: 'tenant-c', deniedPartition: 'tenant-d' })

    const legacy = transport(service.fetcher, {
      tenantPartitions: {
        [rule.id]: { allowedPartition: 'tenant-a', deniedPartition: 'tenant-b' }
      }
    })
    await legacy.resolveActors({ projectRef: PROJECT_REF, bucketName: 'bucket-a', rule })
    await expect(
      legacy.resolveActors({ projectRef: PROJECT_REF, bucketName: 'bucket-b', rule })
    ).rejects.toMatchObject({ code: 'invalid-authority' })
  })

  test('enforces its own response-body deadline and merges a caller abort', async () => {
    const stalledFetch = transport(
      () =>
        new Promise<Response>(() => {
          // Intentionally never settles so the transport-owned deadline is exercised.
        }),
      { requestTimeoutMs: 10 }
    )
    await expect(
      stalledFetch.recheckAuthority({
        ...(await authority(application())),
        provider
      })
    ).rejects.toMatchObject({ code: 'transport-failed' })

    const stalledBody = () =>
      new Response(new ReadableStream<Uint8Array>({ start: () => undefined }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    const deadlineTransport = transport(async () => stalledBody(), { requestTimeoutMs: 10 })
    await expect(
      deadlineTransport.recheckAuthority({
        ...(await authority(application())),
        provider
      })
    ).rejects.toMatchObject({ code: 'transport-failed' })

    const controller = new AbortController()
    const abortedTransport = transport(async () => stalledBody(), {
      requestTimeoutMs: 1_000,
      signal: controller.signal
    })
    const pending = abortedTransport.recheckAuthority({
      ...(await authority(application())),
      provider
    })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'transport-failed' })
  })
})
