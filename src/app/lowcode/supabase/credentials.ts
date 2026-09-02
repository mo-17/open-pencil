import { appCredentialServices } from '@/app/settings/credentials/app'
import { credentialRef } from '@/app/settings/credentials/reference'
import type { CredentialServices } from '@/app/settings/credentials/services'
import type { CredentialRef, CredentialStatus } from '@/app/settings/credentials/types'

export const SUPABASE_MANAGEMENT_PAT_CREDENTIAL: CredentialRef = credentialRef(
  'supabase-management',
  'personal-access-token'
)
export const SUPABASE_MANAGEMENT_GRANT_GENERATION_CREDENTIAL: CredentialRef = credentialRef(
  'supabase-management',
  'grant-generation'
)

const GRANT_GENERATION = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

function nextGrantGeneration(): string {
  if (typeof crypto.randomUUID !== 'function') {
    throw new TypeError('Secure Supabase grant generation is unavailable')
  }
  return crypto.randomUUID()
}

async function rotateSupabaseManagementGrant(
  operation: () => Promise<void>,
  services: CredentialServices
): Promise<void> {
  const generation = nextGrantGeneration()
  await services.manager.set(
    SUPABASE_MANAGEMENT_GRANT_GENERATION_CREDENTIAL,
    `pending:${generation}`
  )
  await operation()
  await services.manager.set(SUPABASE_MANAGEMENT_GRANT_GENERATION_CREDENTIAL, generation)
}

export function supabaseManagementPatStatus(
  services: CredentialServices = appCredentialServices
): Promise<CredentialStatus> {
  return services.manager.status(SUPABASE_MANAGEMENT_PAT_CREDENTIAL)
}

export async function setSupabaseManagementPat(
  value: string,
  services: CredentialServices = appCredentialServices
): Promise<void> {
  const token = value.trim()
  if (!token) {
    await clearSupabaseManagementPat(services)
    return
  }
  await rotateSupabaseManagementGrant(
    () => services.manager.set(SUPABASE_MANAGEMENT_PAT_CREDENTIAL, token),
    services
  )
}

export function clearSupabaseManagementPat(
  services: CredentialServices = appCredentialServices
): Promise<void> {
  return rotateSupabaseManagementGrant(
    () => services.manager.clear(SUPABASE_MANAGEMENT_PAT_CREDENTIAL),
    services
  )
}

export function resolveSupabaseManagementPat(
  services: CredentialServices = appCredentialServices
): Promise<string | null> {
  return services.resolver.resolve(SUPABASE_MANAGEMENT_PAT_CREDENTIAL)
}

export async function resolveSupabaseManagementGrantGeneration(
  services: CredentialServices = appCredentialServices
): Promise<string | null> {
  const generation = await services.resolver.resolve(
    SUPABASE_MANAGEMENT_GRANT_GENERATION_CREDENTIAL
  )
  return generation && GRANT_GENERATION.test(generation) ? generation : null
}
