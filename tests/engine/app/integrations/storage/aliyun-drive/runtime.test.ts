import { describe, expect, test } from 'bun:test'

import { MemoryAliyunDriveOAuthMetadataStore } from '@/app/integrations/storage/aliyun-drive/oauth/metadata'
import {
  getAliyunDriveRuntimeServices,
  resetAliyunDriveRuntimeServicesForTests
} from '@/app/integrations/storage/aliyun-drive/runtime'
import { MemoryCredentialStore } from '@/app/settings/credentials/memory'
import { createCredentialServices } from '@/app/settings/credentials/services'
import type { AliyunDriveNativeBridge } from '@/app/tauri/aliyun-drive'

const native: AliyunDriveNativeBridge = {
  authorize: () => Promise.reject(new Error('not used')),
  refresh: () => Promise.reject(new Error('not used'))
}

describe('Aliyun Drive runtime', () => {
  test('creates one cached oauth/client/adapter graph per manager and profile', () => {
    resetAliyunDriveRuntimeServicesForTests()
    const credentials = createCredentialServices(new MemoryCredentialStore())
    const runtime = {
      preferences: { clientId: 'renderer-must-be-ignored' },
      profileId: 'default',
      credentialManager: credentials.manager,
      credentialResolver: credentials.resolver,
      resolveCredential: () => Promise.resolve(null)
    }
    const transport = () => Promise.resolve(new Response('{}'))
    const metadataStore = new MemoryAliyunDriveOAuthMetadataStore()
    const first = getAliyunDriveRuntimeServices(runtime, {
      native,
      transport,
      metadataStore
    })
    const second = getAliyunDriveRuntimeServices(runtime, {
      native,
      transport,
      metadataStore
    })

    expect(second).toBe(first)
    expect(first.profileId).toBe('default')
    expect(first.oauth).toHaveProperty('getAccessToken')
    expect(first.oauth).toHaveProperty('status')
    expect(first.client).toBeDefined()
    expect(first.adapter).toBeDefined()
    resetAliyunDriveRuntimeServicesForTests()
  })

  test('rebuilds and disposes a graph when its metadata authority store changes', async () => {
    resetAliyunDriveRuntimeServicesForTests()
    const credentials = createCredentialServices(new MemoryCredentialStore())
    const runtime = {
      preferences: {},
      profileId: 'default',
      credentialManager: credentials.manager,
      credentialResolver: credentials.resolver,
      resolveCredential: () => Promise.resolve(null)
    }
    const transport = () => Promise.resolve(new Response('{}'))
    const first = getAliyunDriveRuntimeServices(runtime, {
      native,
      transport,
      metadataStore: new MemoryAliyunDriveOAuthMetadataStore()
    })
    const second = getAliyunDriveRuntimeServices(runtime, {
      native,
      transport,
      metadataStore: new MemoryAliyunDriveOAuthMetadataStore()
    })

    expect(second).not.toBe(first)
    await expect(first.oauth.getAccessToken()).rejects.toMatchObject({ code: 'busy' })
    resetAliyunDriveRuntimeServicesForTests()
  })

  test('rejects invalid profile identities before constructing services', () => {
    const credentials = createCredentialServices(new MemoryCredentialStore())
    expect(() =>
      getAliyunDriveRuntimeServices(
        {
          preferences: {},
          profileId: '../escape',
          credentialManager: credentials.manager,
          credentialResolver: credentials.resolver,
          resolveCredential: () => Promise.resolve(null)
        },
        { native, metadataStore: new MemoryAliyunDriveOAuthMetadataStore() }
      )
    ).toThrow('Storage profile ID')
  })
})
