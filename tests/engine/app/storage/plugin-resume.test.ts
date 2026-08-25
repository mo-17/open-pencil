import { expect, test } from 'bun:test'

import { repoPath } from '#tests/helpers/paths'

test('startup and OAuth storage plugin re-enable wake durable storage work', async () => {
  const source = await Bun.file(repoPath('src/App.vue')).text()

  expect(source).toContain('storageProviderPluginState(GOOGLE_DRIVE_STORAGE_PROVIDER_ID)')
  expect(source).toContain('storageProviderPluginState(ONEDRIVE_STORAGE_PROVIDER_ID)')
  expect(source).toContain('storageProviderPluginState(ALIYUN_DRIVE_STORAGE_PROVIDER_ID)')
  expect(source).toContain('storageProviderPluginState(BAIDU_NETDISK_STORAGE_PROVIDER_ID)')
  expect(source).toContain("state === 'enabled' && previousStates?.[index] !== 'enabled'")
  expect(source).toContain('void resumeStorageSync()')
  expect(source).toContain('{ immediate: true }')
})
