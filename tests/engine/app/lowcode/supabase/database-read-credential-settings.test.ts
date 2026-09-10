import { describe, expect, test } from 'bun:test'

import {
  createSupabaseDatabaseReadCredentialSettingsController,
  type SupabaseDatabaseReadCredentialSettingsDependenciesV1
} from '@/app/lowcode/supabase/database-read-credential-settings'
import {
  SUPABASE_DATABASE_READ_CREDENTIAL_MUTATION_RECEIPT_FORMAT,
  type SupabaseDatabaseReadCredentialMutationReceiptV1
} from '@/app/tauri/supabase-database-read-credentials'

const CURRENT_GENERATION = '123e4567-e89b-42d3-a456-426614174000'
const NEXT_GENERATION = '223e4567-e89b-42d3-a456-426614174000'

function receipt(
  overrides: Partial<SupabaseDatabaseReadCredentialMutationReceiptV1> = {}
): SupabaseDatabaseReadCredentialMutationReceiptV1 {
  return {
    format: SUPABASE_DATABASE_READ_CREDENTIAL_MUTATION_RECEIPT_FORMAT,
    version: 1,
    configured: true,
    commitDurability: 'confirmed',
    grantGeneration: NEXT_GENERATION,
    credentialIncarnation: 'A'.repeat(42) + 'E',
    connectionProfileDigest: 'B'.repeat(42) + 'E',
    ...overrides
  }
}

function dependencies(
  overrides: Partial<SupabaseDatabaseReadCredentialSettingsDependenciesV1> = {}
): SupabaseDatabaseReadCredentialSettingsDependenciesV1 {
  return {
    bridge: {
      statusV1: async () => 'missing',
      replaceV1: async () => receipt(),
      clearV1: async () => receipt({ configured: false, connectionProfileDigest: null })
    },
    resolveGrantGeneration: async () => CURRENT_GENERATION,
    ...overrides
  }
}

describe('Supabase database-read credential Settings controller', () => {
  test('requires the canonical Management PAT generation without inventing one', async () => {
    let statusCalls = 0
    const controller = createSupabaseDatabaseReadCredentialSettingsController(
      dependencies({
        bridge: {
          statusV1: async () => {
            statusCalls += 1
            return 'configured'
          },
          replaceV1: async () => receipt(),
          clearV1: async () => receipt({ configured: false, connectionProfileDigest: null })
        },
        resolveGrantGeneration: async () => null
      })
    )

    const snapshot = await controller.refreshStatus()

    expect(statusCalls).toBe(0)
    expect(snapshot.status).toBe('management-pat-required')
  })

  test('injects the bridge, derives the strict direct profile, and does not retain a password', async () => {
    let request:
      | Parameters<SupabaseDatabaseReadCredentialSettingsDependenciesV1['bridge']['replaceV1']>[0]
      | null = null
    const controller = createSupabaseDatabaseReadCredentialSettingsController(
      dependencies({
        bridge: {
          statusV1: async () => 'missing',
          replaceV1: async (value) => {
            request = value
            return receipt()
          },
          clearV1: async () => receipt({ configured: false, connectionProfileDigest: null })
        }
      })
    )

    const snapshot = await controller.replace(
      {
        projectRef: 'abcdefghijklmnopqrst',
        accountId: 'postgres.admin',
        mode: 'direct'
      },
      'only-bridge-sees-this-password'
    )

    expect(request).toMatchObject({
      expectedGrantGeneration: CURRENT_GENERATION,
      connectionProfile: {
        projectRef: 'abcdefghijklmnopqrst',
        accountId: 'postgres.admin',
        mode: 'direct',
        host: 'db.abcdefghijklmnopqrst.supabase.co',
        user: 'postgres'
      }
    })
    expect(snapshot.status).toBe('configured')
    expect(JSON.stringify(snapshot)).not.toContain('only-bridge-sees-this-password')
  })

  test('keeps both generations and blocks further mutations after unconfirmed durability', async () => {
    let replaceCalls = 0
    let clearCalls = 0
    const controller = createSupabaseDatabaseReadCredentialSettingsController(
      dependencies({
        bridge: {
          statusV1: async () => 'configured',
          replaceV1: async () => {
            replaceCalls += 1
            return receipt({ commitDurability: 'unconfirmed' })
          },
          clearV1: async () => {
            clearCalls += 1
            return receipt({ configured: false, connectionProfileDigest: null })
          }
        }
      })
    )

    const first = await controller.replace(
      {
        projectRef: 'abcdefghijklmnopqrst',
        accountId: 'postgres.admin',
        mode: 'direct'
      },
      'password'
    )
    const second = await controller.clear()

    expect(replaceCalls).toBe(1)
    expect(clearCalls).toBe(0)
    expect(first).toMatchObject({
      status: 'reconciliation-required',
      reconciliation: {
        expectedGrantGeneration: CURRENT_GENERATION,
        nextGrantGeneration: NEXT_GENERATION
      }
    })
    expect(second.status).toBe('reconciliation-required')
    expect(second.error).toContain('unconfirmed durability')
  })

  test('prevents duplicate submissions while a replacement is pending', async () => {
    let resolveReplace!: (value: SupabaseDatabaseReadCredentialMutationReceiptV1) => void
    let calls = 0
    const controller = createSupabaseDatabaseReadCredentialSettingsController(
      dependencies({
        bridge: {
          statusV1: async () => 'missing',
          replaceV1: async () => {
            calls += 1
            return await new Promise<SupabaseDatabaseReadCredentialMutationReceiptV1>((resolve) => {
              resolveReplace = resolve
            })
          },
          clearV1: async () => receipt({ configured: false, connectionProfileDigest: null })
        }
      })
    )
    const input = {
      projectRef: 'abcdefghijklmnopqrst',
      accountId: 'postgres.admin',
      mode: 'direct' as const
    }

    const first = controller.replace(input, 'password')
    await Promise.resolve()
    const duplicate = await controller.replace(input, 'password')
    resolveReplace(receipt())
    await first

    expect(calls).toBe(1)
    expect(duplicate.pendingOperation).toBe('replace')
  })
})
