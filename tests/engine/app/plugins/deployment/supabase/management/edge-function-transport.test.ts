import { describe, expect, test } from 'bun:test'

import { unzipSync } from 'fflate'

import {
  createSupabaseManagementEdgeFunctionTransport,
  type CreateSupabaseManagementEdgeFunctionTransportOptions,
  type SupabaseManagementEdgeFunctionFetch
} from '@/app/plugins/host/deployment/supabase/management/edge-function-transport'

const PROJECT_REF = 'abcdefghijklmnopqrst'
const ACCOUNT_ID = 'account-1'
const GRANT = 'grant-1'
const DIGEST = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const NOW = '2026-09-03T10:00:00.000Z'

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

type TransportOverrides = Partial<
  Pick<
    CreateSupabaseManagementEdgeFunctionTransportOptions,
    'signal' | 'requestTimeoutMs' | 'healthTimeoutMs'
  >
>

function options(fetcher: SupabaseManagementEdgeFunctionFetch, overrides: TransportOverrides = {}) {
  return {
    personalAccessToken: `sbp_${'p'.repeat(32)}`,
    publishableKey: `sb_publishable_${'k'.repeat(32)}`,
    userAccessToken: `eyJ${'u'.repeat(32)}.${'s'.repeat(32)}`,
    authority: {
      projectRef: PROJECT_REF,
      accountId: ACCOUNT_ID,
      grantGeneration: GRANT
    },
    fetcher,
    now: () => NOW,
    ...overrides
  }
}

function secretInspectionInput(requiredSecretNames: readonly string[]) {
  return {
    projectRef: PROJECT_REF,
    accountId: ACCOUNT_ID,
    grantGeneration: GRANT,
    providerId: 'supabase' as const,
    functionSlug: 'openpencil-runtime',
    artifactDigest: DIGEST,
    requiredSecretNames
  }
}

function healthInput() {
  return {
    projectRef: PROJECT_REF,
    accountId: ACCOUNT_ID,
    grantGeneration: GRANT,
    providerId: 'supabase' as const,
    functionSlug: 'openpencil-runtime',
    functionId: 'function-1',
    versionId: '7',
    expectedHealthIdentity: DIGEST,
    authenticated: true as const
  }
}

function deployInput() {
  const source = 'Deno.serve(() => new Response("ok"))\n'
  return {
    projectRef: PROJECT_REF,
    accountId: ACCOUNT_ID,
    grantGeneration: GRANT,
    providerId: 'supabase' as const,
    functionSlug: 'openpencil-runtime',
    verifyJwt: true as const,
    files: [
      {
        path: 'backend/supabase/functions/openpencil-runtime/index.ts',
        kind: 'server-runtime' as const,
        mediaType: 'text/typescript; charset=utf-8',
        byteLength: new TextEncoder().encode(source).byteLength,
        digest: DIGEST,
        content: source
      }
    ],
    artifactDigest: DIGEST
  }
}

describe('Supabase Management Edge Function transport', () => {
  test('checks secret names, deploys a bounded ZIP, and invokes authenticated health', async () => {
    let projectChecks = 0
    let deploys = 0
    let invokes = 0
    const fetcher: SupabaseManagementEdgeFunctionFetch = async (url, init) => {
      const target = String(url)
      if (target === `https://api.supabase.com/v1/projects/${PROJECT_REF}`) {
        projectChecks += 1
        return json({ ref: PROJECT_REF, organization_id: ACCOUNT_ID })
      }
      if (target === `https://api.supabase.com/v1/projects/${PROJECT_REF}/secrets`) {
        return json([
          { name: 'OPENPENCIL_OUTBOUND_HTTP_HOSTS', digest: 'redacted' },
          { name: 'SUPABASE_PUBLISHABLE_KEYS', digest: 'redacted' }
        ])
      }
      if (
        target ===
        `https://api.supabase.com/v1/projects/${PROJECT_REF}/functions/deploy?slug=openpencil-runtime`
      ) {
        deploys += 1
        expect(init?.method).toBe('POST')
        expect(init?.body).toBeInstanceOf(FormData)
        const form = init?.body as FormData
        const metadata = form.get('metadata')
        expect(typeof metadata).toBe('string')
        expect(JSON.parse(metadata as string)).toEqual({
          name: 'openpencil-runtime',
          entrypoint_path: 'index.ts',
          verify_jwt: true
        })
        const archive = form.get('file')
        expect(archive).toBeInstanceOf(File)
        const zipped = new Uint8Array(await (archive as File).arrayBuffer())
        expect(new TextDecoder().decode(unzipSync(zipped)['index.ts'])).toContain('Deno.serve')
        return json(
          {
            id: 'function-1',
            slug: 'openpencil-runtime',
            name: 'openpencil-runtime',
            status: 'ACTIVE',
            version: 7,
            verify_jwt: true
          },
          201
        )
      }
      if (target === `https://${PROJECT_REF}.supabase.co/functions/v1/openpencil-runtime`) {
        invokes += 1
        expect(init?.method).toBe('POST')
        expect(init?.body).toBe(JSON.stringify({ workflowId: '__openpencil_health_v1', args: {} }))
        const headers = init?.headers as Record<string, string>
        expect(headers.apikey).toStartWith('sb_publishable_')
        expect(headers.authorization).toStartWith('Bearer eyJ')
        return json({ healthy: true, authenticated: true, buildIdentity: DIGEST })
      }
      throw new Error(`unexpected request ${target}`)
    }
    const transport = createSupabaseManagementEdgeFunctionTransport(options(fetcher))
    const secretEvidence = await transport.inspectRequiredSecrets(
      secretInspectionInput([
        'OPENPENCIL_OUTBOUND_HTTP_HOSTS',
        'SUPABASE_PUBLISHABLE_KEYS',
        'SUPABASE_URL'
      ])
    )
    expect(secretEvidence).toMatchObject({
      projectRef: PROJECT_REF,
      accountId: ACCOUNT_ID,
      grantGeneration: GRANT,
      providerId: 'supabase',
      functionSlug: 'openpencil-runtime',
      artifactDigest: DIGEST,
      requiredSecretNames: [
        'OPENPENCIL_OUTBOUND_HTTP_HOSTS',
        'SUPABASE_PUBLISHABLE_KEYS',
        'SUPABASE_URL'
      ],
      checkedAt: NOW
    })
    expect(Reflect.ownKeys(secretEvidence)).toEqual([
      'projectRef',
      'accountId',
      'grantGeneration',
      'providerId',
      'functionSlug',
      'artifactDigest',
      'requiredSecretNames',
      'evidenceDigest',
      'checkedAt'
    ])
    expect(JSON.stringify(secretEvidence)).not.toContain('redacted')
    await transport.recheckAuthority({
      releaseAuthority: 'host.supabase-edge-functions.v1',
      projectRef: PROJECT_REF,
      accountId: ACCOUNT_ID,
      grantGeneration: GRANT,
      environment: 'staging',
      provider: {
        publisherId: 'open-pencil',
        packageDigest: `app-bundle-sha256:${DIGEST}`,
        pluginId: 'openpencil.supabase-backend',
        contributionId: 'supabase.backend',
        providerId: 'supabase',
        adapterId: 'open-pencil.backend.supabase',
        adapterVersion: '1.0.0',
        contractVersion: 1,
        supportedModelVersions: [1],
        capabilities: ['server.functions'],
        permissions: [],
        outputKinds: ['server-runtime']
      },
      artifactDigest: DIGEST,
      functionSlug: 'openpencil-runtime'
    })
    const source = 'Deno.serve(() => new Response("ok"))\n'
    const deployed = await transport.deploy({
      projectRef: PROJECT_REF,
      accountId: ACCOUNT_ID,
      grantGeneration: GRANT,
      providerId: 'supabase',
      functionSlug: 'openpencil-runtime',
      verifyJwt: true,
      files: [
        {
          path: 'backend/supabase/functions/openpencil-runtime/index.ts',
          kind: 'server-runtime',
          mediaType: 'text/typescript; charset=utf-8',
          byteLength: new TextEncoder().encode(source).byteLength,
          digest: DIGEST,
          content: source
        }
      ],
      artifactDigest: DIGEST
    })
    expect(deployed).toMatchObject({
      projectRef: PROJECT_REF,
      functionSlug: 'openpencil-runtime',
      functionId: 'function-1',
      versionId: '7'
    })
    expect(deployed.operationId).toStartWith('edge-deploy-')
    const health = await transport.invokeAuthenticated({
      projectRef: PROJECT_REF,
      accountId: ACCOUNT_ID,
      grantGeneration: GRANT,
      providerId: 'supabase',
      functionSlug: 'openpencil-runtime',
      functionId: deployed.functionId,
      versionId: deployed.versionId,
      expectedHealthIdentity: DIGEST,
      authenticated: true
    })
    expect(health).toMatchObject({ status: 200, authenticated: true, healthy: true })
    expect(health.operationId).toStartWith('edge-health-')
    expect(projectChecks).toBe(2)
    expect(deploys).toBe(1)
    expect(invokes).toBe(1)
  })

  test('blocks when a custom secret name is absent', async () => {
    const fetcher: SupabaseManagementEdgeFunctionFetch = async (url) =>
      String(url).endsWith('/secrets')
        ? json([])
        : json({ ref: PROJECT_REF, organization_id: ACCOUNT_ID })
    const transport = createSupabaseManagementEdgeFunctionTransport(options(fetcher))
    await expect(
      transport.inspectRequiredSecrets(secretInspectionInput(['OPENPENCIL_OUTBOUND_HTTP_HOSTS']))
    ).rejects.toMatchObject({ code: 'missing-secrets' })
  })

  test('accepts Supabase platform-injected secrets without querying the custom inventory', async () => {
    let secretInventoryRequests = 0
    const fetcher: SupabaseManagementEdgeFunctionFetch = async (url) => {
      if (String(url).endsWith('/secrets')) secretInventoryRequests += 1
      return json({ ref: PROJECT_REF, organization_id: ACCOUNT_ID })
    }
    const transport = createSupabaseManagementEdgeFunctionTransport(options(fetcher))

    await expect(
      transport.inspectRequiredSecrets(
        secretInspectionInput(['SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_URL'])
      )
    ).resolves.toMatchObject({
      requiredSecretNames: ['SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_URL']
    })
    expect(secretInventoryRequests).toBe(0)
  })

  test('rejects a healthy response from an older runtime identity', async () => {
    const fetcher: SupabaseManagementEdgeFunctionFetch = async () =>
      json({
        healthy: true,
        authenticated: true,
        buildIdentity: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
      })
    const transport = createSupabaseManagementEdgeFunctionTransport(options(fetcher))
    await expect(transport.invokeAuthenticated(healthInput())).rejects.toMatchObject({
      code: 'health-check-failed'
    })
  })

  test('classifies HTTP 408 from deploy as a possibly dispatched network failure', async () => {
    const transport = createSupabaseManagementEdgeFunctionTransport(
      options(async () => json({ message: 'request timeout' }, 408))
    )

    await expect(transport.deploy(deployInput())).rejects.toMatchObject({ code: 'network-failed' })
  })

  test('enforces its own response-body deadline and preserves caller abort semantics', async () => {
    const stalledFetch = createSupabaseManagementEdgeFunctionTransport(
      options(
        () =>
          new Promise<Response>(() => {
            // Intentionally never settles so the transport-owned deadline is exercised.
          }),
        { healthTimeoutMs: 10 }
      )
    )
    await expect(stalledFetch.invokeAuthenticated(healthInput())).rejects.toMatchObject({
      code: 'timeout'
    })

    const stalledBody = () =>
      new Response(new ReadableStream<Uint8Array>({ start: () => undefined }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    const timed = createSupabaseManagementEdgeFunctionTransport(
      options(async () => stalledBody(), { healthTimeoutMs: 10 })
    )
    await expect(timed.invokeAuthenticated(healthInput())).rejects.toMatchObject({
      code: 'timeout'
    })

    const controller = new AbortController()
    const aborted = createSupabaseManagementEdgeFunctionTransport(
      options(async () => stalledBody(), {
        healthTimeoutMs: 1_000,
        signal: controller.signal
      })
    )
    const pending = aborted.invokeAuthenticated(healthInput())
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'aborted' })
  })
})
