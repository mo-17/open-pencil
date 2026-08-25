import { describe, expect, test } from 'bun:test'

import { NativeCredentialStore } from '@/app/settings/credentials/native'
import type { CredentialRef } from '@/app/settings/credentials/types'

const REFERENCE: CredentialRef = {
  integrationId: 'google-drive',
  profileId: 'personal',
  field: 'authorization'
}

function nativeFailure(code: string, message = 'Native credential failure'): Error {
  return Object.assign(new Error(message), { code })
}

describe('native credential store bridge', () => {
  test('uses the fixed Tauri credential commands and argument shapes', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = []
    const results: unknown[] = ['available', 'configured', 'secret', undefined, undefined]
    const store = new NativeCredentialStore(
      <T>(command: string, args?: Record<string, unknown>) => {
        calls.push({ command, args })
        return Promise.resolve(results.shift() as T)
      }
    )

    expect(await store.availability()).toBe('available')
    expect(await store.status(REFERENCE)).toBe('configured')
    expect(await store.read(REFERENCE)).toBe('secret')
    await store.write(REFERENCE, 'replacement')
    await store.remove(REFERENCE)

    expect(calls).toEqual([
      { command: 'credential_store_availability', args: undefined },
      { command: 'credential_status', args: { reference: REFERENCE } },
      { command: 'credential_read', args: { reference: REFERENCE } },
      { command: 'credential_write', args: { reference: REFERENCE, value: 'replacement' } },
      { command: 'credential_remove', args: { reference: REFERENCE } }
    ])
  })

  test('maps native failures to static redacted errors', async () => {
    const store = new NativeCredentialStore(() =>
      Promise.reject(nativeFailure('unavailable', 'secret-marker-must-not-cross'))
    )

    const error = await store.read(REFERENCE).catch((cause: unknown) => cause)
    expect(error).toMatchObject({
      code: 'unavailable',
      message: 'The app-local credential store is unavailable'
    })
    expect(String(error)).not.toContain('secret-marker-must-not-cross')
  })

  test('fails closed for unknown native error codes', async () => {
    const store = new NativeCredentialStore(() => Promise.reject(nativeFailure('future-error')))

    await expect(store.status(REFERENCE)).rejects.toMatchObject({
      code: 'failed',
      message: 'Desktop app credential operation failed'
    })
  })

  test('fails closed for native rejections without a code', async () => {
    const store = new NativeCredentialStore(() => Promise.reject(new Error('opaque failure')))

    await expect(store.availability()).rejects.toMatchObject({ code: 'failed' })
  })
})
