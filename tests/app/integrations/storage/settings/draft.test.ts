import { expect, spyOn, test } from 'bun:test'

import { storageProviderRegistry } from '@/app/integrations/storage/providers'
import { testStorageDraft } from '@/app/integrations/storage/settings/draft'
import type {
  StorageAdapterContext,
  StorageConnectionResult
} from '@/app/integrations/storage/types'
import { appCredentialServices } from '@/app/settings/credentials/app'
import { credentialRef } from '@/app/settings/credentials/reference'

function fixture(
  run: (context: StorageAdapterContext, signal?: AbortSignal) => Promise<StorageConnectionResult>
) {
  const createAdapter = storageProviderRegistry.createAdapter.bind(storageProviderRegistry)
  const create = spyOn(storageProviderRegistry, 'createAdapter').mockImplementation(
    (id, context) => {
      const adapter = createAdapter(id, context)
      adapter.testConnection = (options) => run(context, options?.signal)
      return adapter
    }
  )
  const set = spyOn(appCredentialServices.manager, 'set').mockImplementation(async () => {
    throw new Error('Testing a draft must not persist credentials')
  })
  const clear = spyOn(appCredentialServices.manager, 'clear').mockImplementation(async () => {
    throw new Error('Testing a draft must not clear credentials')
  })
  return {
    set,
    clear,
    dispose() {
      create.mockRestore()
      set.mockRestore()
      clear.mockRestore()
    }
  }
}

test('draft tests resolve only the captured profile replacement without saving it', async () => {
  const f = fixture(async (context) => {
    expect(context.profileId).toBe('draft-profile')
    expect(context.preferences).toEqual({
      endpoint: 'https://draft.example',
      bucket: 'draft-bucket'
    })
    expect(
      await context.credentials.resolve(
        credentialRef('s3-compatible', 'secret-access-key', 'draft-profile')
      )
    ).toBe('draft-only-secret')
    return { ok: true, message: 'Fixture connected' }
  })
  try {
    expect(
      await testStorageDraft(
        's3-compatible',
        { endpoint: 'https://draft.example', bucket: 'draft-bucket' },
        { 'secret-access-key': 'draft-only-secret' },
        [],
        { profileId: 'draft-profile' }
      )
    ).toEqual({ ok: true, message: 'Fixture connected' })
    expect(f.set).not.toHaveBeenCalled()
    expect(f.clear).not.toHaveBeenCalled()
  } finally {
    f.dispose()
  }
})

test('draft preferences and replacement credentials remain the entry snapshot across awaits', async () => {
  const resume = Promise.withResolvers<undefined>()
  const preferences = { endpoint: 'https://captured.example', bucket: 'captured' }
  const credentials = { 'secret-access-key': 'captured-secret' }
  const f = fixture(async (context) => {
    await resume.promise
    expect(context.preferences.endpoint).toBe('https://captured.example')
    expect(
      await context.credentials.resolve(
        credentialRef('s3-compatible', 'secret-access-key', 'snapshot-profile')
      )
    ).toBe('captured-secret')
    return { ok: true, message: 'Fixture connected' }
  })
  try {
    const pending = testStorageDraft('s3-compatible', preferences, credentials, [], {
      profileId: 'snapshot-profile'
    })
    preferences.endpoint = 'https://other.example'
    credentials['secret-access-key'] = 'other-secret'
    resume.resolve(undefined)
    expect((await pending).ok).toBe(true)
  } finally {
    resume.resolve(undefined)
    f.dispose()
  }
})

test('a draft credential resolver refuses another profile and unknown fields', async () => {
  const f = fixture(async (context) => {
    await expect(
      context.credentials.resolve(
        credentialRef('s3-compatible', 'secret-access-key', 'other-profile')
      )
    ).rejects.toThrow('Unexpected storage credential reference')
    await expect(
      context.credentials.resolve(
        credentialRef('s3-compatible', 'unexpected-field', 'owned-profile')
      )
    ).rejects.toThrow('Unexpected storage credential reference')
    return { ok: false, message: 'Rejected invalid credential references' }
  })
  try {
    expect(
      (await testStorageDraft('s3-compatible', {}, {}, [], { profileId: 'owned-profile' })).ok
    ).toBe(false)
    expect(f.set).not.toHaveBeenCalled()
    expect(f.clear).not.toHaveBeenCalled()
  } finally {
    f.dispose()
  }
})

test('an explicitly cleared draft field never falls back to a saved credential', async () => {
  const resolve = spyOn(appCredentialServices.resolver, 'resolve')
  const f = fixture(async (context) => {
    expect(
      await context.credentials.resolve(
        credentialRef('s3-compatible', 'secret-access-key', 'owned-profile')
      )
    ).toBeNull()
    return { ok: false, message: 'No secret supplied' }
  })
  try {
    await testStorageDraft(
      's3-compatible',
      {},
      { 'secret-access-key': 'must-not-override-clear' },
      ['secret-access-key'],
      { profileId: 'owned-profile' }
    )
    expect(resolve).not.toHaveBeenCalled()
  } finally {
    f.dispose()
    resolve.mockRestore()
  }
})

test('aborting while a saved credential resolves prevents its late value reaching the adapter', async () => {
  const started = Promise.withResolvers<undefined>()
  const credential = Promise.withResolvers<string | null>()
  const controller = new AbortController()
  const resolve = spyOn(appCredentialServices.resolver, 'resolve').mockImplementation(async () => {
    started.resolve(undefined)
    return credential.promise
  })
  const f = fixture(async (context, signal) => {
    expect(signal).toBe(controller.signal)
    await context.credentials.resolve(
      credentialRef('s3-compatible', 'secret-access-key', 'owned-profile')
    )
    throw new Error('A cancelled credential must never reach a request')
  })
  try {
    const pending = testStorageDraft('s3-compatible', {}, {}, [], {
      profileId: 'owned-profile',
      signal: controller.signal
    })
    await started.promise
    controller.abort(new DOMException('Profile changed', 'AbortError'))
    credential.resolve('late-saved-secret')
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(f.set).not.toHaveBeenCalled()
    expect(f.clear).not.toHaveBeenCalled()
  } finally {
    credential.resolve(null)
    f.dispose()
    resolve.mockRestore()
  }
})
