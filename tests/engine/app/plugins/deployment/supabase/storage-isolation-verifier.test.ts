import { describe, expect, test } from 'bun:test'

import {
  digestBackendApplication,
  type BackendApplicationSpecV1,
  type BackendReleaseProviderAuthorityV1
} from '@open-pencil/lowcode/backend'

import {
  createSupabaseStorageIsolationVerification,
  type SupabaseStorageIsolationAuthority,
  type SupabaseStorageIsolationTransport
} from '@/app/plugins/host/deployment/supabase/storage-isolation-verifier'

const DIGEST = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const NOW = '2026-09-03T11:00:00.000Z'

function application(maxObjectBytes = 64): BackendApplicationSpecV1 {
  return {
    format: 'openpencil.backend-application',
    version: 1,
    applicationId: 'storage-probe',
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
          maxObjectBytes,
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

function transport(
  onProbe?: (input: Parameters<SupabaseStorageIsolationTransport['probeObject']>[0]) => void,
  maxObjectBytes = 64,
  onInspect?: () => void
): SupabaseStorageIsolationTransport {
  let operation = 0
  let inspection = 0
  let actorResolution = 0
  return {
    recheckAuthority: async () => undefined,
    inspectBucket: async () => {
      inspection += 1
      onInspect?.()
      return {
        bucketName: 'user-assets',
        private: true,
        maxObjectBytes,
        allowedMimeTypes: ['image/png'],
        evidenceDigest: DIGEST,
        operationId: `inspect-bucket-${inspection}`
      }
    },
    resolveActors: async () => {
      actorResolution += 1
      return {
        userAId: 'user-a',
        userBId: 'user-b',
        allowedPartition: 'user-a',
        deniedPartition: 'denied-partition',
        evidenceDigest: DIGEST,
        operationId: `resolve-actors-${actorResolution}`
      }
    },
    probeObject: async (input) => {
      onProbe?.(input)
      operation += 1
      const contentAllowed = !input.content || input.content.byteLength <= maxObjectBytes
      const mimeAllowed = input.mimeType === 'image/png'
      const pathAllowed = input.objectPath.startsWith('users/user-a/')
      const actorAllowed = input.actor === 'user-a'
      const allowed = actorAllowed && pathAllowed && mimeAllowed && contentAllowed
      return {
        outcome: allowed ? 'allowed' : 'denied',
        status: allowed ? 200 : 403,
        evidenceDigest: DIGEST,
        operationId: `probe-${operation}`
      }
    }
  }
}

async function authority(
  app: BackendApplicationSpecV1,
  environment: 'staging' | 'production' = 'staging'
): Promise<SupabaseStorageIsolationAuthority> {
  return {
    releaseAuthority: 'host.supabase-storage-isolation.v1',
    environment,
    projectRef: 'abcdefghijklmnopqrst',
    accountId: 'account-1',
    grantGeneration: 'grant-1',
    provider,
    applicationDigest: await digestBackendApplication(app),
    storagePolicyArtifactDigest: DIGEST
  }
}

describe('Supabase Storage live isolation verifier', () => {
  test('runs owner CRUD/upsert plus anonymous, User B, path, MIME, and size negatives once', async () => {
    const app = application()
    const probes: string[] = []
    const session = createSupabaseStorageIsolationVerification({
      verificationId: 'storage-probe-1',
      application: app,
      authority: await authority(app),
      bucketId: 'user-assets',
      ruleId: 'owner-files',
      maxProbePayloadBytes: 65,
      transport: transport((input) => probes.push(`${input.actor}:${input.operation}`)),
      now: () => NOW
    })
    const [first, duplicate] = await Promise.all([session.verify(), session.verify()])
    expect(first).toBe(duplicate)
    expect(first.outcome).toBe('succeeded')
    expect(first.dispatch).toBe('dispatched')
    expect(first.checks).toHaveLength(13)
    expect(first.checks.every((entry) => entry.passed)).toBe(true)
    expect(first.residualObjectPaths).toEqual([])
    expect(probes).toHaveLength(13)
    expect(first.remoteOperationIds).toHaveLength(16)
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.checks)).toBe(true)
  })

  test('persists potential residual paths before the first object mutation', async () => {
    const app = application()
    const sequence: string[] = []
    const baseTransport = transport(() => sequence.push('probe'))
    const session = createSupabaseStorageIsolationVerification({
      verificationId: 'storage-probe-journaled',
      application: app,
      authority: await authority(app),
      bucketId: 'user-assets',
      ruleId: 'owner-files',
      maxProbePayloadBytes: 65,
      transport: {
        ...baseTransport,
        async recheckAuthority(authority) {
          sequence.push('recheck')
          await baseTransport.recheckAuthority(authority)
        }
      },
      now: () => NOW,
      async beforeDispatch(evidence) {
        expect(evidence.potentialResidualObjectPaths).toContain(
          'users/user-a/probe-storage-probe-journaled.bin'
        )
        sequence.push('claim')
      },
      async onProgress(evidence) {
        expect(evidence.remoteOperationIds.length).toBeGreaterThan(2)
        sequence.push('evidence')
      }
    })
    await expect(session.verify()).resolves.toMatchObject({ outcome: 'succeeded' })
    expect(sequence.slice(0, 5)).toEqual(['recheck', 'claim', 'recheck', 'probe', 'evidence'])

    let probes = 0
    const rejected = createSupabaseStorageIsolationVerification({
      verificationId: 'storage-probe-journal-rejected',
      application: app,
      authority: await authority(app),
      bucketId: 'user-assets',
      ruleId: 'owner-files',
      maxProbePayloadBytes: 65,
      transport: transport(() => {
        probes += 1
      }),
      now: () => NOW,
      async beforeDispatch() {
        throw new Error('journal unavailable')
      }
    })
    await expect(rejected.verify()).rejects.toThrow('journal unavailable')
    expect(rejected.state()).toBe('not-dispatched')
    expect(probes).toBe(0)
  })

  test('does not probe when the final post-claim authority recheck fails', async () => {
    const app = application()
    const baseTransport = transport()
    let rechecks = 0
    let claims = 0
    let probes = 0
    const session = createSupabaseStorageIsolationVerification({
      verificationId: 'storage-probe-final-authority-stale',
      application: app,
      authority: await authority(app),
      bucketId: 'user-assets',
      ruleId: 'owner-files',
      maxProbePayloadBytes: 65,
      transport: {
        ...baseTransport,
        async recheckAuthority(authority) {
          rechecks += 1
          if (rechecks === 2) throw new Error('local or remote authority changed')
          await baseTransport.recheckAuthority(authority)
        },
        async probeObject(input) {
          probes += 1
          return baseTransport.probeObject(input)
        }
      },
      now: () => NOW,
      async beforeDispatch() {
        claims += 1
      }
    })

    await expect(session.verify()).resolves.toMatchObject({
      dispatch: 'not-dispatched',
      outcome: 'failed',
      failureCode: 'authority-recheck-failed'
    })
    expect(rechecks).toBe(2)
    expect(claims).toBe(1)
    expect(probes).toBe(0)
  })

  test('does not accept an authenticated 404 as an RLS denial', async () => {
    const app = application()
    const baseTransport = transport()
    const session = createSupabaseStorageIsolationVerification({
      verificationId: 'storage-probe-non-rls-denial',
      application: app,
      authority: await authority(app),
      bucketId: 'user-assets',
      ruleId: 'owner-files',
      maxProbePayloadBytes: 65,
      transport: {
        ...baseTransport,
        probeObject: async (input) =>
          input.actor === 'user-b' && input.operation === 'read'
            ? {
                outcome: 'denied',
                status: 404,
                evidenceDigest: DIGEST,
                operationId: 'probe-non-rls-denial'
              }
            : baseTransport.probeObject(input)
      },
      now: () => NOW
    })

    await expect(session.verify()).resolves.toMatchObject({
      dispatch: 'outcome-unknown',
      outcome: 'outcome-unknown',
      failureCode: 'cleanup-required'
    })
  })

  test('requires exact production confirmation and explicit oversize bandwidth authority', async () => {
    const app = application()
    const productionAuthority = await authority(app, 'production')
    const unconfirmed = createSupabaseStorageIsolationVerification({
      verificationId: 'storage-probe-2',
      application: app,
      authority: productionAuthority,
      bucketId: 'user-assets',
      ruleId: 'owner-files',
      maxProbePayloadBytes: 65,
      transport: transport(),
      now: () => NOW
    })
    await expect(unconfirmed.verify()).rejects.toMatchObject({ code: 'confirmation-required' })

    const undersized = createSupabaseStorageIsolationVerification({
      verificationId: 'storage-probe-3',
      application: app,
      authority: await authority(app),
      bucketId: 'user-assets',
      ruleId: 'owner-files',
      maxProbePayloadBytes: 64,
      transport: transport(),
      now: () => NOW
    })
    await expect(undersized.verify()).rejects.toMatchObject({ code: 'size-probe-limit' })
  })

  test('uses repeat read-only bucket evidence when N+1 exceeds the bounded probe cap', async () => {
    const maxObjectBytes = 5_368_709_120
    const app = application(maxObjectBytes)
    const probes: Parameters<SupabaseStorageIsolationTransport['probeObject']>[0][] = []
    let inspections = 0
    const session = createSupabaseStorageIsolationVerification({
      verificationId: 'storage-probe-large-limit',
      application: app,
      authority: await authority(app),
      bucketId: 'user-assets',
      ruleId: 'owner-files',
      maxProbePayloadBytes: 32,
      transport: transport(
        (input) => probes.push(input),
        maxObjectBytes,
        () => {
          inspections += 1
        }
      ),
      now: () => NOW
    })

    const receipt = await session.verify()

    expect(receipt.outcome).toBe('succeeded')
    expect(receipt.checks).toHaveLength(13)
    expect(receipt.remoteOperationIds).toHaveLength(16)
    expect(receipt.checks.find((entry) => entry.check === 'size-limit-denied')).toMatchObject({
      passed: true,
      operationId: 'inspect-bucket-2'
    })
    expect(inspections).toBe(2)
    expect(probes).toHaveLength(12)
    expect(Math.max(...probes.map((probe) => probe.content?.byteLength ?? 0))).toBe(32)
  })

  test('records a potentially created object when the transport becomes ambiguous', async () => {
    const app = application()
    let probes = 0
    const session = createSupabaseStorageIsolationVerification({
      verificationId: 'storage-probe-ambiguous',
      application: app,
      authority: await authority(app),
      bucketId: 'user-assets',
      ruleId: 'owner-files',
      maxProbePayloadBytes: 65,
      transport: transport(() => {
        probes += 1
        if (probes === 2) throw new Error('connection lost after owner create')
      }),
      now: () => NOW
    })

    const receipt = await session.verify()

    expect(receipt.outcome).toBe('outcome-unknown')
    expect(receipt.failureCode).toBe('cleanup-required')
    expect(receipt.residualObjectPaths).toHaveLength(1)
    expect(receipt.residualObjectPaths[0]).toStartWith('users/user-a/probe-')
  })

  test('retains the known object path when final cleanup is denied', async () => {
    const app = application()
    const base = transport()
    const deniedCleanup: SupabaseStorageIsolationTransport = {
      ...base,
      probeObject: async (input) =>
        input.actor === 'user-a' && input.operation === 'delete'
          ? {
              outcome: 'denied',
              status: 403,
              evidenceDigest: DIGEST,
              operationId: 'probe-cleanup-denied'
            }
          : base.probeObject(input)
    }
    const session = createSupabaseStorageIsolationVerification({
      verificationId: 'storage-probe-cleanup-denied',
      application: app,
      authority: await authority(app),
      bucketId: 'user-assets',
      ruleId: 'owner-files',
      maxProbePayloadBytes: 65,
      transport: deniedCleanup,
      now: () => NOW
    })

    const receipt = await session.verify()

    expect(receipt.dispatch).toBe('outcome-unknown')
    expect(receipt.outcome).toBe('outcome-unknown')
    expect(receipt.failureCode).toBe('cleanup-required')
    expect(receipt.checks.at(-1)).toMatchObject({ check: 'owner-delete', passed: false })
    expect(receipt.residualObjectPaths).toHaveLength(1)
  })
})
