import { describe, expect, test } from 'bun:test'

import {
  SUPABASE_MANAGEMENT_DATABASE_WRITE_CREDENTIAL_INCARNATION_CREDENTIAL,
  SUPABASE_MANAGEMENT_DATABASE_WRITE_PAT_CREDENTIAL,
  SUPABASE_MANAGEMENT_GRANT_GENERATION_CREDENTIAL,
  SUPABASE_MANAGEMENT_PAT_CREDENTIAL,
  clearSupabaseManagementDatabaseWritePat,
  clearSupabaseManagementPat,
  resolveSupabaseManagementDatabaseWriteCredentialIncarnation,
  resolveSupabaseManagementDatabaseWritePat,
  resolveSupabaseManagementGrantGeneration,
  resolveSupabaseManagementPat,
  setSupabaseManagementDatabaseWritePat,
  setSupabaseManagementPat,
  supabaseManagementDatabaseWritePatStatus,
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
    expect(credentialKey(SUPABASE_MANAGEMENT_DATABASE_WRITE_PAT_CREDENTIAL)).toBe(
      'v1:supabase-management:default:database-write-personal-access-token'
    )
    expect(appCredentialRefs()).toContainEqual(SUPABASE_MANAGEMENT_DATABASE_WRITE_PAT_CREDENTIAL)
    expect(
      credentialKey(SUPABASE_MANAGEMENT_DATABASE_WRITE_CREDENTIAL_INCARNATION_CREDENTIAL)
    ).toBe('v1:supabase-management:default:database-write-credential-incarnation')
    expect(appCredentialRefs()).toContainEqual(
      SUPABASE_MANAGEMENT_DATABASE_WRITE_CREDENTIAL_INCARNATION_CREDENTIAL
    )
    expect(credentialKey(SUPABASE_MANAGEMENT_GRANT_GENERATION_CREDENTIAL)).toBe(
      'v1:supabase-management:default:grant-generation'
    )
    expect(appCredentialRefs()).toContainEqual(SUPABASE_MANAGEMENT_GRANT_GENERATION_CREDENTIAL)
  })

  test('keeps database-write authority separate and rotates the shared grant', async () => {
    const services = createCredentialServices(new MemoryCredentialStore())
    await setSupabaseManagementPat('sbp_read_token', services)
    const readGeneration = await resolveSupabaseManagementGrantGeneration(services)

    await expect(supabaseManagementDatabaseWritePatStatus(services)).resolves.toBe('missing')
    await setSupabaseManagementDatabaseWritePat('  sbp_write_token  ', services)
    await expect(supabaseManagementDatabaseWritePatStatus(services)).resolves.toBe('configured')
    await expect(resolveSupabaseManagementDatabaseWritePat(services)).resolves.toBe(
      'sbp_write_token'
    )
    const writeIncarnation =
      await resolveSupabaseManagementDatabaseWriteCredentialIncarnation(services)
    expect(writeIncarnation).toMatch(/^[0-9a-f-]{36}$/)
    await expect(resolveSupabaseManagementPat(services)).resolves.toBe('sbp_read_token')
    await expect(resolveSupabaseManagementGrantGeneration(services)).resolves.not.toBe(
      readGeneration
    )

    await clearSupabaseManagementDatabaseWritePat(services)
    await expect(resolveSupabaseManagementDatabaseWritePat(services)).resolves.toBeNull()
    await expect(resolveSupabaseManagementPat(services)).resolves.toBe('sbp_read_token')
    await expect(
      resolveSupabaseManagementDatabaseWriteCredentialIncarnation(services)
    ).resolves.not.toBe(writeIncarnation)
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

  test('keeps write incarnation stable across read-token rotation and rotates it for every write mutation', async () => {
    const services = createCredentialServices(new MemoryCredentialStore())
    await setSupabaseManagementDatabaseWritePat('write-token-00000001', services)
    const initial = await resolveSupabaseManagementDatabaseWriteCredentialIncarnation(services)
    expect(initial).toMatch(/^[0-9a-f-]{36}$/)

    await setSupabaseManagementPat('read-token-00000001', services)
    await expect(
      resolveSupabaseManagementDatabaseWriteCredentialIncarnation(services)
    ).resolves.toBe(initial)

    await setSupabaseManagementDatabaseWritePat('write-token-00000002', services)
    const replaced = await resolveSupabaseManagementDatabaseWriteCredentialIncarnation(services)
    expect(replaced).not.toBe(initial)

    await clearSupabaseManagementDatabaseWritePat(services)
    await expect(
      resolveSupabaseManagementDatabaseWriteCredentialIncarnation(services)
    ).resolves.not.toBe(replaced)
  })

  test('leaves both shared and write incarnations invalid when write-token rotation fails', async () => {
    const base = createCredentialServices(new MemoryCredentialStore())
    await setSupabaseManagementDatabaseWritePat('old-write-token-0001', base)
    const services = {
      resolver: base.resolver,
      manager: {
        ...base.manager,
        async set(
          reference: typeof SUPABASE_MANAGEMENT_DATABASE_WRITE_PAT_CREDENTIAL,
          value: string
        ) {
          if (reference === SUPABASE_MANAGEMENT_DATABASE_WRITE_PAT_CREDENTIAL) {
            throw new Error('simulated write PAT failure')
          }
          await base.manager.set(reference, value)
        }
      }
    }

    await expect(
      setSupabaseManagementDatabaseWritePat('new-write-token-0001', services)
    ).rejects.toThrow('simulated write PAT failure')
    await expect(resolveSupabaseManagementDatabaseWritePat(base)).resolves.toBe(
      'old-write-token-0001'
    )
    await expect(resolveSupabaseManagementGrantGeneration(base)).resolves.toBeNull()
    await expect(
      resolveSupabaseManagementDatabaseWriteCredentialIncarnation(base)
    ).resolves.toBeNull()
  })

  test('rejects pending or malformed persisted generations', async () => {
    const services = createCredentialServices(new MemoryCredentialStore())
    await services.manager.set(SUPABASE_MANAGEMENT_GRANT_GENERATION_CREDENTIAL, 'pending:test')
    await services.manager.set(
      SUPABASE_MANAGEMENT_DATABASE_WRITE_CREDENTIAL_INCARNATION_CREDENTIAL,
      'pending:test'
    )
    await expect(resolveSupabaseManagementGrantGeneration(services)).resolves.toBeNull()
    await expect(
      resolveSupabaseManagementDatabaseWriteCredentialIncarnation(services)
    ).resolves.toBeNull()
  })

  test('serializes read and write token rotation under one shared grant generation', async () => {
    const base = createCredentialServices(new MemoryCredentialStore())
    let markReadMutationStarted: () => void = () => undefined
    let releaseReadMutation: () => void = () => undefined
    const readMutationStarted = new Promise<void>((resolve) => {
      markReadMutationStarted = resolve
    })
    const readMutationGate = new Promise<void>((resolve) => {
      releaseReadMutation = resolve
    })
    let writeMutationStarted = false
    let publishedGenerations = 0
    const services = {
      resolver: base.resolver,
      manager: {
        ...base.manager,
        async set(reference: typeof SUPABASE_MANAGEMENT_PAT_CREDENTIAL, value: string) {
          if (reference === SUPABASE_MANAGEMENT_PAT_CREDENTIAL) {
            markReadMutationStarted()
            await readMutationGate
          }
          if (reference === SUPABASE_MANAGEMENT_DATABASE_WRITE_PAT_CREDENTIAL) {
            writeMutationStarted = true
          }
          if (
            reference === SUPABASE_MANAGEMENT_GRANT_GENERATION_CREDENTIAL &&
            !value.startsWith('pending:')
          ) {
            publishedGenerations += 1
            if (publishedGenerations === 2) throw new Error('simulated second publish failure')
          }
          await base.manager.set(reference, value)
        }
      }
    }

    const readRotation = setSupabaseManagementPat('read-token', services)
    await readMutationStarted
    const writeRotation = setSupabaseManagementDatabaseWritePat('write-token', services)
    await Promise.resolve()
    await Promise.resolve()
    expect(writeMutationStarted).toBe(false)

    releaseReadMutation()
    const results = await Promise.allSettled([readRotation, writeRotation])
    expect(results.map(({ status }) => status)).toEqual(['fulfilled', 'rejected'])
    await expect(resolveSupabaseManagementPat(base)).resolves.toBe('read-token')
    await expect(resolveSupabaseManagementDatabaseWritePat(base)).resolves.toBe('write-token')
    await expect(resolveSupabaseManagementGrantGeneration(base)).resolves.toBeNull()
  })
})
