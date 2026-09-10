import { appCredentialServices } from '@/app/settings/credentials/app'
import { withCredentialPersistenceExclusiveGateV1 } from '@/app/settings/credentials/exclusive-gate'
import { credentialRef } from '@/app/settings/credentials/reference'
import type { CredentialServices } from '@/app/settings/credentials/services'
import type { CredentialRef, CredentialStatus } from '@/app/settings/credentials/types'

export const SUPABASE_MANAGEMENT_PAT_CREDENTIAL: CredentialRef = credentialRef(
  'supabase-management',
  'personal-access-token'
)
export const SUPABASE_MANAGEMENT_DATABASE_WRITE_PAT_CREDENTIAL: CredentialRef = credentialRef(
  'supabase-management',
  'database-write-personal-access-token'
)
export const SUPABASE_MANAGEMENT_GRANT_GENERATION_CREDENTIAL: CredentialRef = credentialRef(
  'supabase-management',
  'grant-generation'
)
export const SUPABASE_MANAGEMENT_DATABASE_WRITE_CREDENTIAL_INCARNATION_CREDENTIAL: CredentialRef =
  credentialRef('supabase-management', 'database-write-credential-incarnation')

const GRANT_GENERATION = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

/** Operation-scoped staging user credential used by authenticated isolation probes. */
export interface SupabaseStagingTestUserInput {
  readonly userId: string
  readonly accessToken: string
}

function nextGrantGeneration(): string {
  if (typeof crypto.randomUUID !== 'function') {
    throw new TypeError('Secure Supabase grant generation is unavailable')
  }
  return crypto.randomUUID()
}

async function rotateSupabaseManagementGrant(
  operation: () => Promise<void>,
  services: CredentialServices,
  rotateDatabaseWriteCredentialIncarnation = false
): Promise<void> {
  await withCredentialPersistenceExclusiveGateV1(async () => {
    const generation = nextGrantGeneration()
    const writeCredentialIncarnation = rotateDatabaseWriteCredentialIncarnation
      ? nextGrantGeneration()
      : null
    if (writeCredentialIncarnation === generation) {
      throw new TypeError('Secure Supabase write credential incarnation is unavailable')
    }
    await services.manager.set(
      SUPABASE_MANAGEMENT_GRANT_GENERATION_CREDENTIAL,
      `pending:${generation}`
    )
    if (writeCredentialIncarnation !== null) {
      await services.manager.set(
        SUPABASE_MANAGEMENT_DATABASE_WRITE_CREDENTIAL_INCARNATION_CREDENTIAL,
        `pending:${writeCredentialIncarnation}`
      )
    }
    await operation()
    await services.manager.set(SUPABASE_MANAGEMENT_GRANT_GENERATION_CREDENTIAL, generation)
    if (writeCredentialIncarnation !== null) {
      await services.manager.set(
        SUPABASE_MANAGEMENT_DATABASE_WRITE_CREDENTIAL_INCARNATION_CREDENTIAL,
        writeCredentialIncarnation
      )
    }
    return Object.freeze({ started: undefined })
  })
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

export function supabaseManagementDatabaseWritePatStatus(
  services: CredentialServices = appCredentialServices
): Promise<CredentialStatus> {
  return services.manager.status(SUPABASE_MANAGEMENT_DATABASE_WRITE_PAT_CREDENTIAL)
}

export async function setSupabaseManagementDatabaseWritePat(
  value: string,
  services: CredentialServices = appCredentialServices
): Promise<void> {
  const token = value.trim()
  if (!token) {
    await clearSupabaseManagementDatabaseWritePat(services)
    return
  }
  await rotateSupabaseManagementGrant(
    () => services.manager.set(SUPABASE_MANAGEMENT_DATABASE_WRITE_PAT_CREDENTIAL, token),
    services,
    true
  )
}

export function clearSupabaseManagementDatabaseWritePat(
  services: CredentialServices = appCredentialServices
): Promise<void> {
  return rotateSupabaseManagementGrant(
    () => services.manager.clear(SUPABASE_MANAGEMENT_DATABASE_WRITE_PAT_CREDENTIAL),
    services,
    true
  )
}

export function resolveSupabaseManagementDatabaseWritePat(
  services: CredentialServices = appCredentialServices
): Promise<string | null> {
  return services.resolver.resolve(SUPABASE_MANAGEMENT_DATABASE_WRITE_PAT_CREDENTIAL)
}

export async function resolveSupabaseManagementGrantGeneration(
  services: CredentialServices = appCredentialServices
): Promise<string | null> {
  const generation = await services.resolver.resolve(
    SUPABASE_MANAGEMENT_GRANT_GENERATION_CREDENTIAL
  )
  return generation && GRANT_GENERATION.test(generation) ? generation : null
}

export async function resolveSupabaseManagementDatabaseWriteCredentialIncarnation(
  services: CredentialServices = appCredentialServices
): Promise<string | null> {
  const incarnation = await services.resolver.resolve(
    SUPABASE_MANAGEMENT_DATABASE_WRITE_CREDENTIAL_INCARNATION_CREDENTIAL
  )
  return incarnation && GRANT_GENERATION.test(incarnation) ? incarnation : null
}
