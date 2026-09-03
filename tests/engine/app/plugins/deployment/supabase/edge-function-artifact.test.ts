import { describe, expect, test } from 'bun:test'

import type { BackendProviderEmission } from '@open-pencil/compiler/backend'

import { createSupabaseEdgeFunctionArtifactFromEmission } from '@/app/plugins/host/deployment/supabase/edge-function-artifact'

function asFixture<T>(value: object): T {
  return value as T
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  let binary = ''
  for (const byte of digest) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

describe('Supabase Edge Function compiler artifact bridge', () => {
  test('derives files and secret names only from the reviewed emission', async () => {
    const path = 'backend/supabase/functions/openpencil-runtime/index.ts'
    const sourceWithoutIdentity =
      'import { serve } from "https://deno.land/std/http/server.ts"\nDeno.serve(() => new Response("ok"))\n'
    const healthIdentity = await sha256(sourceWithoutIdentity)
    const newline = sourceWithoutIdentity.indexOf('\n')
    const source = `${sourceWithoutIdentity.slice(0, newline + 1)}const OPENPENCIL_EDGE_BUILD_IDENTITY = ${JSON.stringify(healthIdentity)}\n${sourceWithoutIdentity.slice(newline + 1)}`
    const digest = await sha256(source)
    const emission = asFixture<BackendProviderEmission>({
      files: new Map([[path, source]]),
      manifest: {
        authority: { providerId: 'supabase' },
        capabilities: [
          { capability: 'server.functions', included: true },
          { capability: 'server.http', included: true }
        ],
        requiredSecrets: [
          {
            kind: 'environment',
            name: 'EMAIL_API_TOKEN',
            exposure: 'server',
            required: true
          },
          {
            kind: 'credential',
            credentialRef: 'credential.123e4567-e89b-12d3-a456-426614174000',
            name: 'SUPABASE_PAT',
            exposure: 'host',
            required: true
          }
        ],
        artifacts: [
          {
            path,
            kind: 'server-runtime',
            mediaType: 'text/typescript; charset=utf-8',
            byteLength: new TextEncoder().encode(source).byteLength,
            digest
          }
        ]
      }
    })
    const artifact = await createSupabaseEdgeFunctionArtifactFromEmission({
      emission,
      functionSlug: 'openpencil-runtime'
    })
    expect(artifact.requiredSecretNames).toEqual([
      'EMAIL_API_TOKEN',
      'OPENPENCIL_OUTBOUND_HTTP_HOSTS',
      'SUPABASE_PUBLISHABLE_KEYS',
      'SUPABASE_URL'
    ])
    expect(artifact.files.map((file) => file.path)).toEqual([path])
    expect(artifact.healthIdentity).toBe(healthIdentity)
    expect(artifact.artifactDigest).toHaveLength(43)
    expect(JSON.stringify(artifact)).not.toContain('SUPABASE_PAT')
  })
})
