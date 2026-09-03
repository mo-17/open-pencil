import { describe, expect, test } from 'bun:test'

import type { BackendReleaseProviderAuthorityV1 } from '@open-pencil/lowcode/backend'
import { digestCanonicalManifest } from '@open-pencil/scene-graph'

import {
  createSupabaseEdgeFunctionRelease,
  digestSupabaseEdgeFunctionArtifact,
  SupabaseEdgeFunctionReleaseError,
  type SupabaseEdgeFunctionArtifactFile,
  type SupabaseEdgeFunctionReleaseArtifact,
  type SupabaseEdgeFunctionReleaseAuthority,
  type SupabaseEdgeFunctionReleaseTransports
} from '@/app/plugins/host/deployment/supabase/edge-function-release'

const NOW = '2026-09-03T10:00:00.000Z'
const DIGEST = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const CANARY = 'EDGE_FUNCTION_SECRET_CANARY_VALUE_1234567890'

const provider: BackendReleaseProviderAuthorityV1 = {
  publisherId: 'open-pencil',
  packageDigest: `app-bundle-sha256:${DIGEST}`,
  pluginId: 'openpencil.supabase-backend',
  contributionId: 'supabase-backend',
  providerId: 'supabase',
  adapterId: 'supabase-v1',
  adapterVersion: '1.0.0',
  contractVersion: 1,
  supportedModelVersions: [1],
  capabilities: ['server.functions'],
  permissions: [],
  outputKinds: ['server-runtime']
}

async function sha256(content: string): Promise<string> {
  const bytes = new TextEncoder().encode(content)
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  let binary = ''
  for (const byte of new Uint8Array(hash)) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

async function runtimeSource(): Promise<{
  readonly content: string
  readonly healthIdentity: string
}> {
  const sourceWithoutIdentity =
    'import { serve } from "https://deno.land/std/http/server.ts"\nDeno.serve(() => new Response("ok"))\n'
  const healthIdentity = await sha256(sourceWithoutIdentity)
  const newline = sourceWithoutIdentity.indexOf('\n')
  return {
    content: `${sourceWithoutIdentity.slice(0, newline + 1)}const OPENPENCIL_EDGE_BUILD_IDENTITY = ${JSON.stringify(healthIdentity)}\n${sourceWithoutIdentity.slice(newline + 1)}`,
    healthIdentity
  }
}

async function file(content: string): Promise<SupabaseEdgeFunctionArtifactFile> {
  const bytes = new TextEncoder().encode(content)
  const digest = await sha256(content)
  return {
    path: 'backend/supabase/functions/openpencil-runtime/index.ts',
    kind: 'server-runtime',
    mediaType: 'text/typescript; charset=utf-8',
    byteLength: bytes.byteLength,
    digest,
    content
  }
}

async function artifact(overrides: Partial<SupabaseEdgeFunctionReleaseArtifact> = {}) {
  const runtime = await runtimeSource()
  const source = await file(runtime.content)
  const base = {
    format: 'openpencil.supabase-edge-function-artifact.v1' as const,
    version: 1 as const,
    providerId: 'supabase' as const,
    functionSlug: 'openpencil-runtime',
    verifyJwt: true as const,
    reviewed: true as const,
    healthIdentity: runtime.healthIdentity,
    requiredSecretNames: ['SUPABASE_URL'],
    files: [source]
  }
  const artifactDigest = await digestSupabaseEdgeFunctionArtifact(base)
  return { ...base, artifactDigest, ...overrides }
}

function authority(
  artifactDigest: string,
  environment: 'staging' | 'production' = 'staging'
): SupabaseEdgeFunctionReleaseAuthority {
  return {
    releaseAuthority: 'host.supabase-edge-functions.v1',
    projectRef: 'abcdefghijklmnopqrst',
    accountId: 'account-1',
    grantGeneration: 'grant-1',
    environment,
    provider,
    artifactDigest,
    functionSlug: 'openpencil-runtime'
  }
}

async function secretInspection(
  input: Parameters<SupabaseEdgeFunctionReleaseTransports['inspectRequiredSecrets']>[0]
) {
  const evidenceDigest = await digestCanonicalManifest({
    format: 'openpencil.supabase-edge-secret-inspection-evidence.v1',
    version: 1,
    projectRef: input.projectRef,
    accountId: input.accountId,
    grantGeneration: input.grantGeneration,
    providerId: input.providerId,
    functionSlug: input.functionSlug,
    artifactDigest: input.artifactDigest,
    requiredSecretNames: input.requiredSecretNames,
    checkedAt: NOW
  })
  return {
    projectRef: input.projectRef,
    accountId: input.accountId,
    grantGeneration: input.grantGeneration,
    providerId: input.providerId,
    functionSlug: input.functionSlug,
    artifactDigest: input.artifactDigest,
    requiredSecretNames: [...input.requiredSecretNames],
    evidenceDigest,
    checkedAt: NOW
  }
}

async function healthEvidence(
  input: Parameters<SupabaseEdgeFunctionReleaseTransports['invokeAuthenticated']>[0]
) {
  const evidenceDigest = await digestCanonicalManifest({
    format: 'openpencil.supabase-edge-health-evidence.v1',
    version: 1,
    projectRef: input.projectRef,
    accountId: input.accountId,
    grantGeneration: input.grantGeneration,
    functionSlug: input.functionSlug,
    functionId: input.functionId,
    versionId: input.versionId,
    expectedHealthIdentity: input.expectedHealthIdentity,
    authenticated: true,
    healthy: true,
    checkedAt: NOW
  })
  return {
    status: 200 as const,
    authenticated: true as const,
    healthy: true as const,
    healthIdentity: input.expectedHealthIdentity,
    evidenceDigest,
    operationId: `edge-health-${evidenceDigest.slice(0, 32)}`,
    checkedAt: NOW
  }
}

function transports(
  overrides: Partial<SupabaseEdgeFunctionReleaseTransports> = {}
): SupabaseEdgeFunctionReleaseTransports {
  return {
    recheckAuthority: async () => undefined,
    inspectRequiredSecrets: secretInspection,
    deploy: async (input) => ({
      projectRef: input.projectRef,
      functionSlug: input.functionSlug,
      functionId: 'function-1',
      versionId: 'version-1',
      operationId: 'deploy-1'
    }),
    invokeAuthenticated: healthEvidence,
    ...overrides
  }
}

async function create(
  environment: 'staging' | 'production' | undefined = 'staging',
  options: Partial<Parameters<typeof createSupabaseEdgeFunctionRelease>[0]> = {}
) {
  const edgeArtifact = await artifact()
  return createSupabaseEdgeFunctionRelease({
    releaseId: 'release-1',
    authority: authority(edgeArtifact.artifactDigest, environment ?? 'staging'),
    artifact: edgeArtifact,
    transports: transports(),
    now: () => NOW,
    ...options
  })
}

describe('Supabase Edge Function release', () => {
  test('deploys once, performs authenticated health check, and freezes a secret-free receipt', async () => {
    let deploys = 0
    let invokes = 0
    const edgeArtifact = await artifact()
    const session = createSupabaseEdgeFunctionRelease({
      releaseId: 'release-1',
      authority: authority(edgeArtifact.artifactDigest),
      artifact: edgeArtifact,
      transports: transports({
        deploy: async (input) => {
          deploys += 1
          return {
            projectRef: input.projectRef,
            functionSlug: input.functionSlug,
            functionId: 'function-1',
            versionId: 'version-1',
            operationId: 'deploy-1'
          }
        },
        invokeAuthenticated: async (input) => {
          invokes += 1
          return healthEvidence(input)
        }
      }),
      now: () => NOW
    })
    const receipt = await session.dispatch()
    expect(receipt.outcome).toBe('succeeded')
    expect(receipt.dispatch).toBe('dispatched')
    expect(receipt.requiredSecretNames).toEqual(['SUPABASE_URL'])
    expect(receipt.remote.operationIds[0]).toBe('deploy-1')
    expect(receipt.remote.operationIds[1]).toStartWith('edge-health-')
    expect(receipt.health?.authenticated).toBe(true)
    expect(receipt.health?.healthIdentity).toBe(edgeArtifact.healthIdentity)
    expect(receipt.secretInspection?.requiredSecretNames).toEqual(['SUPABASE_URL'])
    expect(deploys).toBe(1)
    expect(invokes).toBe(1)
    expect(Object.isFrozen(receipt)).toBe(true)
    expect(Object.isFrozen(receipt.remote)).toBe(true)
    expect(Object.isFrozen(receipt.remote.operationIds)).toBe(true)
    expect(JSON.stringify(receipt)).not.toContain(CANARY)
  })

  test('coalesces duplicate clicks to one dispatch', async () => {
    let deploys = 0
    const edgeArtifact = await artifact()
    const session = createSupabaseEdgeFunctionRelease({
      releaseId: 'release-1',
      authority: authority(edgeArtifact.artifactDigest),
      artifact: edgeArtifact,
      transports: transports({
        deploy: async (input) => {
          deploys += 1
          await Promise.resolve()
          return {
            projectRef: input.projectRef,
            functionSlug: input.functionSlug,
            functionId: 'function-1',
            versionId: 'version-1',
            operationId: 'deploy-1'
          }
        }
      }),
      now: () => NOW
    })
    const [left, right] = await Promise.all([session.dispatch(), session.dispatch()])
    expect(left).toBe(right)
    expect(deploys).toBe(1)
  })

  test('requires the durable claim before deploy and persists remote version before health', async () => {
    const sequence: string[] = []
    const edgeArtifact = await artifact()
    const session = createSupabaseEdgeFunctionRelease({
      releaseId: 'release-1',
      authority: authority(edgeArtifact.artifactDigest),
      artifact: edgeArtifact,
      transports: transports({
        async recheckAuthority() {
          sequence.push('recheck')
        },
        async deploy(input) {
          sequence.push('deploy')
          return {
            projectRef: input.projectRef,
            functionSlug: input.functionSlug,
            functionId: 'function-1',
            versionId: 'version-7',
            operationId: 'deploy-1'
          }
        },
        async invokeAuthenticated(input) {
          sequence.push('health')
          return healthEvidence(input)
        }
      }),
      now: () => NOW,
      async beforeDispatch(evidence) {
        expect(evidence.secretInspectionEvidenceDigest).toHaveLength(43)
        sequence.push('claim')
      },
      async onRemoteEvidence(evidence) {
        expect(evidence.versionId).toBe('version-7')
        sequence.push('remote-evidence')
      }
    })

    await expect(session.dispatch()).resolves.toMatchObject({ outcome: 'succeeded' })
    expect(sequence).toEqual(['recheck', 'claim', 'recheck', 'deploy', 'remote-evidence', 'health'])

    let rejectedDeploys = 0
    const rejected = createSupabaseEdgeFunctionRelease({
      releaseId: 'release-2',
      authority: authority(edgeArtifact.artifactDigest),
      artifact: edgeArtifact,
      transports: transports({
        async deploy(input) {
          rejectedDeploys += 1
          return {
            projectRef: input.projectRef,
            functionSlug: input.functionSlug,
            functionId: 'unexpected',
            versionId: 'unexpected',
            operationId: 'unexpected'
          }
        }
      }),
      now: () => NOW,
      async beforeDispatch() {
        throw new Error('journal unavailable')
      }
    })
    await expect(rejected.dispatch()).rejects.toThrow('journal unavailable')
    expect(rejected.state()).toBe('not-dispatched')
    expect(rejectedDeploys).toBe(0)
  })

  test('does not POST when the final post-claim authority recheck fails', async () => {
    let rechecks = 0
    let claims = 0
    let deploys = 0
    const edgeArtifact = await artifact()
    const session = createSupabaseEdgeFunctionRelease({
      releaseId: 'release-final-authority-stale',
      authority: authority(edgeArtifact.artifactDigest),
      artifact: edgeArtifact,
      transports: transports({
        async recheckAuthority() {
          rechecks += 1
          if (rechecks === 2) throw new Error('local or remote authority changed')
        },
        async deploy() {
          deploys += 1
          throw new Error('unexpected deploy')
        }
      }),
      now: () => NOW,
      async beforeDispatch() {
        claims += 1
      }
    })

    await expect(session.dispatch()).resolves.toMatchObject({
      dispatch: 'not-dispatched',
      outcome: 'failed',
      failureCode: 'authority-recheck-failed'
    })
    expect(rechecks).toBe(2)
    expect(claims).toBe(1)
    expect(deploys).toBe(0)
  })

  test('requires exact confirmation for production', async () => {
    const session = await create('production')
    await expect(session.dispatch()).rejects.toMatchObject({ code: 'confirmation-required' })
    expect(session.state()).toBe('not-dispatched')
  })

  test('fails closed for a tampered artifact', async () => {
    const edgeArtifact = await artifact()
    const tampered = { ...edgeArtifact, files: [{ ...edgeArtifact.files[0], content: 'tampered' }] }
    const session = createSupabaseEdgeFunctionRelease({
      releaseId: 'release-1',
      authority: authority(edgeArtifact.artifactDigest),
      artifact: tampered,
      transports: transports(),
      now: () => NOW
    })
    await expect(session.dispatch()).rejects.toMatchObject({ code: 'invalid-artifact' })
  })

  test('ignores caller-forged presence and obtains exact secret evidence inside the session', async () => {
    let deploys = 0
    const edgeArtifact = await artifact()
    const untrustedInput = {
      releaseId: 'release-1',
      authority: authority(edgeArtifact.artifactDigest),
      artifact: edgeArtifact,
      // This legacy-shaped caller assertion must have no authority.
      requiredSecretPresence: [{ name: 'SUPABASE_URL', present: true }],
      transports: transports({
        inspectRequiredSecrets: async () => {
          throw new SupabaseEdgeFunctionReleaseError('missing-secrets')
        },
        deploy: async () => {
          deploys += 1
          throw new Error('unexpected')
        }
      }),
      now: () => NOW
    }
    const receipt = await createSupabaseEdgeFunctionRelease(untrustedInput).dispatch()
    expect(receipt.outcome).toBe('blocked')
    expect(receipt.dispatch).toBe('not-dispatched')
    expect(receipt.failureCode).toBe('missing-secrets')
    expect(receipt.secretInspection).toBeNull()
    expect(deploys).toBe(0)
  })

  test('rejects health evidence from an older runtime identity', async () => {
    const session = await create(undefined, {
      transports: transports({
        invokeAuthenticated: async (input) => {
          const evidence = await healthEvidence(input)
          return { ...evidence, healthIdentity: DIGEST }
        }
      })
    })
    const receipt = await session.dispatch()
    expect(receipt.outcome).toBe('failed')
    expect(receipt.failureCode).toBe('health-check-failed')
    expect(receipt.health).toBeNull()
  })

  test('does not dispatch after stale authority recheck', async () => {
    let deploys = 0
    const session = await create(undefined, {
      transports: transports({
        recheckAuthority: async () => {
          throw new Error('stale')
        },
        deploy: async () => {
          deploys += 1
          throw new Error('unexpected')
        }
      })
    })
    const receipt = await session.dispatch()
    expect(receipt.outcome).toBe('failed')
    expect(receipt.dispatch).toBe('not-dispatched')
    expect(receipt.failureCode).toBe('authority-recheck-failed')
    expect(deploys).toBe(0)
  })

  test('records timeout as outcome-unknown with no leaked error text', async () => {
    const session = await create(undefined, {
      transports: transports({
        deploy: async () => {
          throw new SupabaseEdgeFunctionReleaseError('timeout', CANARY)
        }
      })
    })
    const receipt = await session.dispatch()
    expect(receipt.outcome).toBe('outcome-unknown')
    expect(receipt.dispatch).toBe('outcome-unknown')
    expect(JSON.stringify(receipt)).not.toContain(CANARY)
  })

  test('treats an invalid post-dispatch response as outcome-unknown', async () => {
    const session = await create(undefined, {
      transports: transports({
        deploy: async () => {
          throw new SupabaseEdgeFunctionReleaseError('invalid-response')
        }
      })
    })
    const receipt = await session.dispatch()
    expect(receipt.outcome).toBe('outcome-unknown')
    expect(receipt.dispatch).toBe('outcome-unknown')
    expect(receipt.failureCode).toBe('invalid-response')
  })
})
