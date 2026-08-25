import { describe, expect, test } from 'bun:test'

import {
  getBaiduNetdiskRuntimeServices,
  resetBaiduNetdiskRuntimeServicesForTests
} from '@/app/integrations/storage/baidu-netdisk/runtime'
import { MemoryCredentialStore } from '@/app/settings/credentials/memory'
import { createCredentialServices } from '@/app/settings/credentials/services'
import type { BaiduNetdiskNativeBridge } from '@/app/tauri/baidu-netdisk'

const native: BaiduNetdiskNativeBridge = {
  authorize: () => Promise.reject(new Error('not used')),
  refresh: () => Promise.reject(new Error('not used'))
}

describe('Baidu Netdisk runtime', () => {
  test('creates one cached oauth/client/adapter graph per manager and profile', () => {
    resetBaiduNetdiskRuntimeServicesForTests()
    const credentials = createCredentialServices(new MemoryCredentialStore())
    const runtime = {
      preferences: { appKey: 'renderer-must-be-ignored' },
      profileId: 'default',
      credentialManager: credentials.manager,
      credentialResolver: credentials.resolver,
      resolveCredential: () => Promise.resolve(null)
    }
    const transport = () => Promise.resolve(new Response('{}'))
    const first = getBaiduNetdiskRuntimeServices(runtime, { native, transport })
    const second = getBaiduNetdiskRuntimeServices(runtime, { native, transport })

    expect(second).toBe(first)
    expect(first.profileId).toBe('default')
    expect(first.oauth).toHaveProperty('accessToken')
    expect(first.oauth).toHaveProperty('status')
    expect(first.client).toBeDefined()
    expect(first.adapter).toBeDefined()
    resetBaiduNetdiskRuntimeServicesForTests()
  })

  test('rejects invalid profile identities before constructing services', () => {
    const credentials = createCredentialServices(new MemoryCredentialStore())
    expect(() =>
      getBaiduNetdiskRuntimeServices(
        {
          preferences: {},
          profileId: '../escape',
          credentialManager: credentials.manager,
          credentialResolver: credentials.resolver,
          resolveCredential: () => Promise.resolve(null)
        },
        { native }
      )
    ).toThrow('Storage profile ID')
  })
})
