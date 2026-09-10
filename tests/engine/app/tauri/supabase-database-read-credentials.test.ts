import { describe, expect, test } from 'bun:test'

import { createSupabaseDatabaseReadConnectionProfileV1 } from '@/app/lowcode/supabase/database-read-connection-profile'
import {
  SUPABASE_DATABASE_READ_CREDENTIAL_MUTATION_RECEIPT_FORMAT,
  SupabaseDatabaseReadCredentialNativeError,
  createSupabaseDatabaseReadCredentialNativeBridge,
  nativeSupabaseDatabaseReadCredentialError,
  type SupabaseDatabaseReadCredentialNativeInvoke,
  type SupabaseDatabaseReadCredentialMutationReceiptV1
} from '@/app/tauri/supabase-database-read-credentials'

const GENERATION = '123e4567-e89b-42d3-a456-426614174000'
const NEXT_GENERATION = '223e4567-e89b-42d3-a456-426614174000'
const INCARNATION = 'E'.repeat(43)
const PROFILE_DIGEST = `${'F'.repeat(42)}E`
const PASSWORD = '  database pass\tword\n '
const decoder = new TextDecoder()

function rawBody(value: Record<string, unknown> | Uint8Array | undefined): Uint8Array {
  if (!(value instanceof Uint8Array)) throw new TypeError('expected raw native request body')
  return value
}

function generationBody(
  value: Record<string, unknown> | Uint8Array | undefined,
  expectedMagic: string
): string {
  const body = rawBody(value)
  expect(decoder.decode(body.subarray(0, 8))).toBe(expectedMagic)
  expect(body.byteLength).toBe(44)
  return decoder.decode(body.subarray(8))
}

function replaceBody(value: Record<string, unknown> | Uint8Array | undefined): {
  generation: string
  password: string
  connectionProfileJSON: string
} {
  const body = rawBody(value)
  expect(decoder.decode(body.subarray(0, 8))).toBe('OPDBRR01')
  const lengths = new DataView(body.buffer, body.byteOffset, 20)
  const generationLength = lengths.getUint32(8, true)
  const passwordLength = lengths.getUint32(12, true)
  const profileLength = lengths.getUint32(16, true)
  expect(20 + generationLength + passwordLength + profileLength).toBe(body.byteLength)
  const generationEnd = 20 + generationLength
  const passwordEnd = generationEnd + passwordLength
  return {
    generation: decoder.decode(body.subarray(20, generationEnd)),
    password: decoder.decode(body.subarray(generationEnd, passwordEnd)),
    connectionProfileJSON: decoder.decode(body.subarray(passwordEnd))
  }
}

function configuredReceipt(): SupabaseDatabaseReadCredentialMutationReceiptV1 {
  return {
    format: SUPABASE_DATABASE_READ_CREDENTIAL_MUTATION_RECEIPT_FORMAT,
    version: 1,
    configured: true,
    commitDurability: 'confirmed',
    grantGeneration: NEXT_GENERATION,
    credentialIncarnation: INCARNATION,
    connectionProfileDigest: PROFILE_DIGEST
  }
}

describe('Supabase database-read credential native bridge', () => {
  test('uses dedicated status, replacement, and clear commands with canonical profile JSON', async () => {
    const calls: Array<{
      command: string
      args?: Record<string, unknown> | Uint8Array
    }> = []
    const liveRawBodies: Uint8Array[] = []
    const invoke: SupabaseDatabaseReadCredentialNativeInvoke = <T>(
      command: string,
      args?: Record<string, unknown> | Uint8Array
    ) => {
      if (args instanceof Uint8Array) liveRawBodies.push(args)
      calls.push({ command, args: args instanceof Uint8Array ? args.slice() : args })
      let value: unknown = configuredReceipt()
      if (command === 'supabase_database_read_credential_status_v1') value = 'missing'
      if (command === 'supabase_database_read_credential_clear_v1') {
        value = { ...configuredReceipt(), configured: false, connectionProfileDigest: null }
      }
      return Promise.resolve(value as T)
    }
    const bridge = createSupabaseDatabaseReadCredentialNativeBridge(invoke)
    const profile = createSupabaseDatabaseReadConnectionProfileV1({
      projectRef: 'abcdefghijklmnopqrst',
      accountId: 'account.staging_01',
      mode: 'direct'
    })

    await expect(bridge.statusV1(GENERATION)).resolves.toBe('missing')
    await expect(
      bridge.replaceV1({
        expectedGrantGeneration: GENERATION,
        password: PASSWORD,
        connectionProfile: profile
      })
    ).resolves.toEqual(configuredReceipt())
    await expect(bridge.clearV1(GENERATION)).resolves.toMatchObject({
      configured: false,
      connectionProfileDigest: null
    })

    expect(calls).toHaveLength(3)
    expect(calls[0]?.command).toBe('supabase_database_read_credential_status_v1')
    expect(generationBody(calls[0]?.args, 'OPDBRS01')).toBe(GENERATION)
    expect(calls[1]?.command).toBe('supabase_database_read_credential_replace_v1')
    expect(replaceBody(calls[1]?.args)).toEqual({
      generation: GENERATION,
      password: PASSWORD,
      connectionProfileJSON:
        '{"accountId":"account.staging_01","database":"postgres","environment":"staging","format":"openpencil.supabase-database-read-connection-profile.v1","host":"db.abcdefghijklmnopqrst.supabase.co","mode":"direct","port":5432,"projectRef":"abcdefghijklmnopqrst","providerId":"supabase","tlsMode":"verify-full","user":"postgres","version":1}'
    })
    expect(calls[2]?.command).toBe('supabase_database_read_credential_clear_v1')
    expect(generationBody(calls[2]?.args, 'OPDBRC01')).toBe(GENERATION)
    expect(liveRawBodies[1]?.every((byte) => byte === 0)).toBe(true)
  })

  test('rejects invalid local input before invoking native code', async () => {
    let calls = 0
    const bridge = createSupabaseDatabaseReadCredentialNativeBridge(<T>() => {
      calls += 1
      return Promise.resolve(configuredReceipt() as T)
    })
    const profile = createSupabaseDatabaseReadConnectionProfileV1({
      projectRef: 'abcdefghijklmnopqrst',
      accountId: 'account.staging_01',
      mode: 'direct'
    })

    await expect(bridge.statusV1('not-a-generation')).rejects.toMatchObject({
      code: 'invalid-grant-generation'
    })
    await expect(
      bridge.replaceV1({
        expectedGrantGeneration: GENERATION,
        password: '',
        connectionProfile: profile
      })
    ).rejects.toMatchObject({ code: 'invalid-password' })
    await expect(
      bridge.replaceV1({
        expectedGrantGeneration: GENERATION,
        password: 'password',
        connectionProfile: { ...profile, host: 'attacker.invalid' }
      })
    ).rejects.toMatchObject({ code: 'invalid-connection-profile' })
    expect(calls).toBe(0)
  })

  test('strictly validates native status and secret-free receipt responses', async () => {
    for (const result of [
      'configured-by-provider',
      { ...configuredReceipt(), extra: true },
      { ...configuredReceipt(), grantGeneration: 'not-a-generation' },
      { ...configuredReceipt(), grantGeneration: GENERATION },
      { ...configuredReceipt(), commitDurability: 'durable' },
      { ...configuredReceipt(), credentialIncarnation: 'A'.repeat(43) },
      { ...configuredReceipt(), credentialIncarnation: 'F'.repeat(43) },
      { ...configuredReceipt(), configured: false },
      { ...configuredReceipt(), connectionProfileDigest: null }
    ]) {
      const bridge = createSupabaseDatabaseReadCredentialNativeBridge(<T>(command) =>
        Promise.resolve(
          (command === 'supabase_database_read_credential_status_v1' ? result : result) as T
        )
      )
      if (typeof result === 'string') {
        await expect(bridge.statusV1(GENERATION)).rejects.toMatchObject({
          code: 'invalid-response'
        })
      } else {
        await expect(bridge.clearV1(GENERATION)).rejects.toMatchObject({
          code: 'invalid-response'
        })
      }
    }

    let reads = 0
    const changing = Object.defineProperty({}, 'format', {
      enumerable: true,
      get() {
        reads += 1
        return SUPABASE_DATABASE_READ_CREDENTIAL_MUTATION_RECEIPT_FORMAT
      }
    })
    await expect(
      createSupabaseDatabaseReadCredentialNativeBridge(<T>() =>
        Promise.resolve(changing as T)
      ).clearV1(GENERATION)
    ).rejects.toMatchObject({ code: 'invalid-response' })
    expect(reads).toBe(0)
  })

  test('maps native failures to fixed messages without echoing payloads', async () => {
    const error = nativeSupabaseDatabaseReadCredentialError({
      code: 'credential-changed',
      message: `provider controlled ${PASSWORD}`
    })
    expect(error).toBeInstanceOf(SupabaseDatabaseReadCredentialNativeError)
    expect(error).toMatchObject({
      code: 'credential-changed',
      message: 'The Supabase credential grant changed before the operation'
    })
    expect(error.message).not.toContain(PASSWORD)

    expect(nativeSupabaseDatabaseReadCredentialError(`failed ${PASSWORD}`)).toMatchObject({
      code: 'credential-failed',
      message: 'The Supabase database-read credential operation failed'
    })
  })
})
