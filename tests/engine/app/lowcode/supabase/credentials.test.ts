import { describe, expect, test } from 'bun:test'

import {
  SUPABASE_MANAGEMENT_GRANT_GENERATION_CREDENTIAL,
  SUPABASE_MANAGEMENT_PAT_CREDENTIAL,
  clearSupabaseManagementPat,
  resolveSupabaseManagementGrantGeneration,
  resolveSupabaseManagementPat,
  setSupabaseManagementPat,
  supabaseManagementPatStatus
} from '@/app/lowcode/supabase/credentials'
import { MemoryCredentialStore } from '@/app/settings/credentials/memory'
import { appCredentialRefs } from '@/app/settings/credentials/persistence'
import { credentialKey } from '@/app/settings/credentials/reference'
import { createCredentialServices } from '@/app/settings/credentials/services'

describe('Supabase management credentials', () => {
  test('registers stable PAT and grant-generation references with app persistence', () => {
    expect(credentialKey(SUPABASE_MANAGEMENT_PAT_CREDENTIAL)).toBe(
      'v1:supabase-management:default:personal-access-token'
    )
    expect(appCredentialRefs()).toContainEqual(SUPABASE_MANAGEMENT_PAT_CREDENTIAL)
    expect(credentialKey(SUPABASE_MANAGEMENT_GRANT_GENERATION_CREDENTIAL)).toBe(
      'v1:supabase-management:default:grant-generation'
    )
    expect(appCredentialRefs()).toContainEqual(SUPABASE_MANAGEMENT_GRANT_GENERATION_CREDENTIAL)
  })

  test('manages status separately from runtime resolution', async () => {
    const services = createCredentialServices(new MemoryCredentialStore())

    await expect(supabaseManagementPatStatus(services)).resolves.toBe('missing')
    await setSupabaseManagementPat('  sbp_test_token  ', services)
    await expect(supabaseManagementPatStatus(services)).resolves.toBe('configured')
    await expect(resolveSupabaseManagementPat(services)).resolves.toBe('sbp_test_token')
    const firstGeneration = await resolveSupabaseManagementGrantGeneration(services)
    expect(firstGeneration).toMatch(/^[0-9a-f-]{36}$/)

    await setSupabaseManagementPat('sbp_replacement', services)
    await expect(resolveSupabaseManagementPat(services)).resolves.toBe('sbp_replacement')
    await expect(resolveSupabaseManagementGrantGeneration(services)).resolves.not.toBe(
      firstGeneration
    )

    await setSupabaseManagementPat('  ', services)
    await expect(resolveSupabaseManagementPat(services)).resolves.toBeNull()
    await expect(resolveSupabaseManagementGrantGeneration(services)).resolves.toMatch(
      /^[0-9a-f-]{36}$/
    )
    await clearSupabaseManagementPat(services)
  })

  test('leaves an invalid tombstone when PAT replacement fails after rotation begins', async () => {
    const base = createCredentialServices(new MemoryCredentialStore())
    await setSupabaseManagementPat('old-token', base)
    const services = {
      resolver: base.resolver,
      manager: {
        ...base.manager,
        async set(reference: typeof SUPABASE_MANAGEMENT_PAT_CREDENTIAL, value: string) {
          if (reference === SUPABASE_MANAGEMENT_PAT_CREDENTIAL) {
            throw new Error('simulated PAT write failure')
          }
          await base.manager.set(reference, value)
        }
      }
    }

    await expect(setSupabaseManagementPat('new-token', services)).rejects.toThrow(
      'simulated PAT write failure'
    )
    await expect(resolveSupabaseManagementPat(base)).resolves.toBe('old-token')
    await expect(resolveSupabaseManagementGrantGeneration(base)).resolves.toBeNull()
  })
})
