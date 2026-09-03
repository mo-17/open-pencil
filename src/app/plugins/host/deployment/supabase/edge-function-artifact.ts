import type { BackendProviderEmission } from '@open-pencil/compiler/backend'

import {
  digestSupabaseEdgeFunctionArtifact,
  verifySupabaseEdgeFunctionRuntimeHealthIdentity,
  type SupabaseEdgeFunctionArtifactFile,
  type SupabaseEdgeFunctionReleaseArtifact
} from './edge-function-release'

const FUNCTION_SLUG = /^[a-z](?:[a-z0-9-]{0,62}[a-z0-9])?$/u
const DEFAULT_EDGE_SECRET_NAMES = Object.freeze(['SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_URL'])

export interface CreateSupabaseEdgeFunctionArtifactInput {
  readonly emission: BackendProviderEmission
  readonly functionSlug: string
}

function copiedContent(content: string | Uint8Array): string | Uint8Array {
  return typeof content === 'string' ? content : new Uint8Array(content)
}

function requiredSecretNames(emission: BackendProviderEmission): readonly string[] {
  const names = new Set(DEFAULT_EDGE_SECRET_NAMES)
  for (const secret of emission.manifest.requiredSecrets) {
    if (secret.kind === 'environment' && secret.exposure === 'server' && secret.required) {
      names.add(secret.name)
    }
  }
  if (
    emission.manifest.capabilities.some(
      (entry) => entry.capability === 'server.http' && entry.included
    )
  ) {
    names.add('OPENPENCIL_OUTBOUND_HTTP_HOSTS')
  }
  return Object.freeze([...names].sort((left, right) => left.localeCompare(right, 'en')))
}

/**
 * Converts only the already-reviewed compiler emission into the exact Host deployment envelope.
 * No caller-supplied file, digest, secret name, or JWT mode can cross this bridge.
 */
export async function createSupabaseEdgeFunctionArtifactFromEmission(
  input: CreateSupabaseEdgeFunctionArtifactInput
): Promise<SupabaseEdgeFunctionReleaseArtifact> {
  const { emission, functionSlug } = input
  if (
    !FUNCTION_SLUG.test(functionSlug) ||
    emission.manifest.authority.providerId !== 'supabase' ||
    !emission.manifest.capabilities.some(
      (entry) => entry.capability === 'server.functions' && entry.included
    )
  ) {
    throw new TypeError('Supabase Edge Function compiler emission is not deployable.')
  }

  const prefix = `backend/supabase/functions/${functionSlug}/`
  const manifestEntries = emission.manifest.artifacts.filter(
    (entry) => entry.kind === 'server-runtime' && entry.path.startsWith(prefix)
  )
  if (!manifestEntries.some((entry) => entry.path === `${prefix}index.ts`)) {
    throw new TypeError('Supabase Edge Function entrypoint is unavailable.')
  }
  const files: SupabaseEdgeFunctionArtifactFile[] = manifestEntries.map((entry) => {
    const content = emission.files.get(entry.path)
    if (content === undefined) {
      throw new TypeError('Supabase Edge Function artifact content is unavailable.')
    }
    return Object.freeze({
      path: entry.path,
      kind: 'server-runtime' as const,
      mediaType: entry.mediaType,
      byteLength: entry.byteLength,
      digest: entry.digest,
      content: copiedContent(content)
    })
  })
  const entrypoint = files.find((entry) => entry.path === `${prefix}index.ts`)
  if (!entrypoint) throw new TypeError('Supabase Edge Function entrypoint is unavailable.')
  let entrypointSource: string
  try {
    entrypointSource =
      typeof entrypoint.content === 'string'
        ? entrypoint.content
        : new TextDecoder('utf-8', { fatal: true }).decode(entrypoint.content)
  } catch {
    throw new TypeError('Supabase Edge Function entrypoint is not valid UTF-8.')
  }
  const healthIdentity = await verifySupabaseEdgeFunctionRuntimeHealthIdentity(entrypointSource)
  const reviewed = Object.freeze({
    format: 'openpencil.supabase-edge-function-artifact.v1' as const,
    version: 1 as const,
    providerId: 'supabase' as const,
    functionSlug,
    verifyJwt: true as const,
    reviewed: true as const,
    healthIdentity,
    requiredSecretNames: requiredSecretNames(emission),
    files: Object.freeze(files)
  })
  const artifactDigest = await digestSupabaseEdgeFunctionArtifact(reviewed)
  return Object.freeze({ ...reviewed, artifactDigest })
}
