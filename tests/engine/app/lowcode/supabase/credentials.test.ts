import { describe, expect, test } from 'bun:test'

import {
  SUPABASE_MANAGEMENT_PAT_CREDENTIAL,
  clearSupabaseManagementPat,
  resolveSupabaseManagementPat,
  setSupabaseManagementPat,
  supabaseManagementPatStatus
} from '@/app/lowcode/supabase/credentials'
import { MemoryCredentialStore } from '@/app/settings/credentials/memory'
import { appCredentialRefs } from '@/app/settings/credentials/persistence'
import { credentialKey } from '@/app/settings/credentials/reference'
import { createCredentialServices } from '@/app/settings/credentials/services'

describe('Supabase management credentials', () => {
  test('uses one stable PAT credential reference registered with app persistence', () => {
    expect(credentialKey(SUPABASE_MANAGEMENT_PAT_CREDENTIAL)).toBe(
      'v1:supabase-management:default:personal-access-token'
    )
    expect(appCredentialRefs()).toContainEqual(SUPABASE_MANAGEMENT_PAT_CREDENTIAL)
  })

  test('manages status separately from runtime resolution', async () => {
    const services = createCredentialServices(new MemoryCredentialStore())

    await expect(supabaseManagementPatStatus(services)).resolves.toBe('missing')
    await setSupabaseManagementPat('  sbp_test_token  ', services)
    await expect(supabaseManagementPatStatus(services)).resolves.toBe('configured')
    await expect(resolveSupabaseManagementPat(services)).resolves.toBe('sbp_test_token')

    await setSupabaseManagementPat('  ', services)
    await expect(resolveSupabaseManagementPat(services)).resolves.toBeNull()
    await clearSupabaseManagementPat(services)
  })
})
