import { expect, test } from 'bun:test'

import { repoPath } from '#tests/helpers/paths'

test('startup and Google Drive plugin re-enable wake durable storage work', async () => {
  const source = await Bun.file(repoPath('src/App.vue')).text()

  expect(source).toContain('storageProviderPluginState(GOOGLE_DRIVE_STORAGE_PROVIDER_ID)')
  expect(source).toContain("state === 'enabled' && previous !== 'enabled'")
  expect(source).toContain('void resumeStorageSync()')
  expect(source).toContain('{ immediate: true }')
})
