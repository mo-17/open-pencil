import {
  backendSha256,
  canonicalBackendBytes,
  canonicalBackendValue,
  freezeBackendValue
} from '#compiler/backend/canonical'
import type { BackendProviderSelectionV2 } from '#compiler/backend/v2/contracts'

import {
  SUPABASE_BACKFILL_INSPECTION_QUERY_FAMILY_V1,
  SUPABASE_BACKFILL_INSPECTION_SUBJECT_FORMAT_V1
} from './backfill/inspection'
import { SUPABASE_BACKEND_PROVIDER_DESCRIPTOR_V2 } from './descriptor'

export const SUPABASE_BACKFILL_INSPECTION_WIRE_PROTOCOL_ID_V1 =
  'openpencil.supabase-backfill-inspection-wire.v1' as const
export const SUPABASE_BACKFILL_INSPECTION_WIRE_VERSION_V1 = 1 as const

export const SUPABASE_BACKFILL_COMPILER_TRUST_DIGEST_DOMAIN_V1 =
  'openpencil.compiler.supabase-backfill-inspection-trust.v1' as const

export const SUPABASE_BACKFILL_COMPILER_TRUST_PROFILE_V1 = freezeBackendValue({
  format: 'openpencil.supabase-backfill-compiler-trust-profile.v1',
  version: 1,
  application: {
    format: 'openpencil.backend-application',
    version: 2
  },
  compilationMode: 'production',
  targets: ['react', 'vue'],
  output: {
    subjectFormat: SUPABASE_BACKFILL_INSPECTION_SUBJECT_FORMAT_V1,
    queryFamily: SUPABASE_BACKFILL_INSPECTION_QUERY_FAMILY_V1
  },
  reviewOnly: true,
  networkAuthorityCreated: false,
  credentialAuthorityCreated: false,
  sqlExecutionAuthorityCreated: false,
  appBundleAuthorityCreated: false,
  installAuthorityCreated: false,
  executionAuthorityCreated: false,
  releaseAuthorityCreated: false
} as const)

export const SUPABASE_BACKFILL_COMPILER_TRUST_DESCRIPTOR_V1 = freezeBackendValue({
  providerDescriptor: SUPABASE_BACKEND_PROVIDER_DESCRIPTOR_V2,
  trustProfile: SUPABASE_BACKFILL_COMPILER_TRUST_PROFILE_V1
} as const)

function domainSeparatedDigest(domain: string, value: unknown, path: string): string {
  const prefix = new TextEncoder().encode(`${domain}\0`)
  const payload = canonicalBackendBytes(value, path)
  const framed = new Uint8Array(prefix.byteLength + payload.byteLength)
  framed.set(prefix)
  framed.set(payload, prefix.byteLength)
  return backendSha256(framed)
}

/**
 * Stable identity of the reviewed Compiler descriptor and trust profile. This
 * is deliberately not an app-bundle digest, installed-package attestation, or
 * publisher provenance.
 */
export const SUPABASE_BACKFILL_COMPILER_TRUST_DOMAIN_DIGEST_V1 = domainSeparatedDigest(
  SUPABASE_BACKFILL_COMPILER_TRUST_DIGEST_DOMAIN_V1,
  SUPABASE_BACKFILL_COMPILER_TRUST_DESCRIPTOR_V1,
  '$.supabaseBackfillCompilerTrustDescriptor'
)

/** Compiler-local registry selection only; never expose it as install authority. */
export const SUPABASE_BACKFILL_COMPILER_TRUST_SELECTION_DIGEST_V1 =
  `sha256:${SUPABASE_BACKFILL_COMPILER_TRUST_DOMAIN_DIGEST_V1}` as const

export interface SupabaseBackfillCompilerBuildAuthorityV1 {
  readonly format: 'openpencil.supabase-backfill-compiler-build-authority.v1'
  readonly version: 1
  readonly protocol: {
    readonly id: typeof SUPABASE_BACKFILL_INSPECTION_WIRE_PROTOCOL_ID_V1
    readonly version: typeof SUPABASE_BACKFILL_INSPECTION_WIRE_VERSION_V1
  }
  readonly compilerTrustDomain: {
    readonly domain: typeof SUPABASE_BACKFILL_COMPILER_TRUST_DIGEST_DOMAIN_V1
    readonly digest: typeof SUPABASE_BACKFILL_COMPILER_TRUST_DOMAIN_DIGEST_V1
    readonly descriptor: typeof SUPABASE_BACKFILL_COMPILER_TRUST_DESCRIPTOR_V1
  }
  readonly networkAuthorityCreated: false
  readonly credentialAuthorityCreated: false
  readonly sqlExecutionAuthorityCreated: false
  readonly appBundleAuthorityCreated: false
  readonly installAuthorityCreated: false
  readonly executionAuthorityCreated: false
  readonly releaseAuthorityCreated: false
}

const COMPILER_BUILD_AUTHORITY_V1 = freezeBackendValue({
  format: 'openpencil.supabase-backfill-compiler-build-authority.v1',
  version: 1,
  protocol: {
    id: SUPABASE_BACKFILL_INSPECTION_WIRE_PROTOCOL_ID_V1,
    version: SUPABASE_BACKFILL_INSPECTION_WIRE_VERSION_V1
  },
  compilerTrustDomain: {
    domain: SUPABASE_BACKFILL_COMPILER_TRUST_DIGEST_DOMAIN_V1,
    digest: SUPABASE_BACKFILL_COMPILER_TRUST_DOMAIN_DIGEST_V1,
    descriptor: SUPABASE_BACKFILL_COMPILER_TRUST_DESCRIPTOR_V1
  },
  networkAuthorityCreated: false,
  credentialAuthorityCreated: false,
  sqlExecutionAuthorityCreated: false,
  appBundleAuthorityCreated: false,
  installAuthorityCreated: false,
  executionAuthorityCreated: false,
  releaseAuthorityCreated: false
} as const) satisfies SupabaseBackfillCompilerBuildAuthorityV1

const COMPILER_BUILD_AUTHORITY_CANONICAL_V1 = new TextDecoder().decode(
  canonicalBackendBytes(
    COMPILER_BUILD_AUTHORITY_V1,
    '$.supabaseBackfillCompilerBuildAuthority.expected'
  )
)

export function createSupabaseBackfillCompilerBuildAuthorityV1(): SupabaseBackfillCompilerBuildAuthorityV1 {
  return COMPILER_BUILD_AUTHORITY_V1
}

/** Accept only the one deterministic review-only Compiler trust declaration. */
export function parseSupabaseBackfillCompilerBuildAuthorityV1(
  value: unknown
): SupabaseBackfillCompilerBuildAuthorityV1 {
  let canonical: string
  try {
    canonical = JSON.stringify(
      canonicalBackendValue(value, '$.supabaseBackfillCompilerBuildAuthority.actual')
    )
  } catch {
    throw new TypeError('Supabase backfill Compiler build authority must be bounded inert data.')
  }
  if (canonical !== COMPILER_BUILD_AUTHORITY_CANONICAL_V1) {
    throw new TypeError('Supabase backfill Compiler build authority is not trusted.')
  }
  return COMPILER_BUILD_AUTHORITY_V1
}

/**
 * Create the fixed selection used inside the isolated Compiler process. The
 * digest names a Compiler trust domain, not an installed app plugin package.
 */
export function createSupabaseBackfillCompilerSelectionV1(): BackendProviderSelectionV2 {
  return freezeBackendValue({
    descriptor: SUPABASE_BACKEND_PROVIDER_DESCRIPTOR_V2,
    packageDigest: SUPABASE_BACKFILL_COMPILER_TRUST_SELECTION_DIGEST_V1,
    enabled: true
  }) as BackendProviderSelectionV2
}
