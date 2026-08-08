import { appCredentialServices } from '@/app/settings/credentials/app'
import { credentialRef } from '@/app/settings/credentials/reference'
import type { CredentialServices } from '@/app/settings/credentials/services'
import type { CredentialRef, CredentialStatus } from '@/app/settings/credentials/types'

export const SUPABASE_MANAGEMENT_PAT_CREDENTIAL: CredentialRef = credentialRef(
  'supabase-management',
  'personal-access-token'
)

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
  await services.manager.set(SUPABASE_MANAGEMENT_PAT_CREDENTIAL, token)
}

export function clearSupabaseManagementPat(
  services: CredentialServices = appCredentialServices
): Promise<void> {
  return services.manager.clear(SUPABASE_MANAGEMENT_PAT_CREDENTIAL)
}

export function resolveSupabaseManagementPat(
  services: CredentialServices = appCredentialServices
): Promise<string | null> {
  return services.resolver.resolve(SUPABASE_MANAGEMENT_PAT_CREDENTIAL)
}
