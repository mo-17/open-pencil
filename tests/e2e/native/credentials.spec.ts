import { strict as assert } from 'node:assert'

import { invokeNative } from '#tests/helpers/tauri/invoke'

const reference = { integrationId: 'native-test', profileId: 'isolation', field: 'api-key' }

describe('native test credential isolation', () => {
  it('uses a disposable app-local vault and exposes an access check without Keychain access', async function () {
    this.timeout(180_000)
    await browser.waitUntil(
      async () => browser.execute(() => Boolean(window.openPencil?.getStore?.())),
      { timeout: 30_000 }
    )
    const previousLaunch = await browser.execute(() => {
      // Probe the WebView itself, not an adapter, to verify profile isolation.
      // oxlint-disable-next-line open-pencil/no-direct-storage-access
      const previous = localStorage.getItem('native-test-launch-marker')
      // oxlint-disable-next-line open-pencil/no-direct-storage-access
      localStorage.setItem('native-test-launch-marker', 'present')
      return previous
    })
    assert.equal(previousLaunch, null)
    assert.equal(await $('[role="alertdialog"]').isExisting(), false)
    await invokeNative('credential_retry_access')
    assert.equal(await invokeNative('credential_status', { reference }), 'missing')
    await invokeNative('credential_write', { reference, value: 'disposable-test-value' })
    assert.equal(await invokeNative('credential_status', { reference }), 'configured')
    await invokeNative('credential_remove', { reference })
    assert.equal(await invokeNative('credential_status', { reference }), 'missing')
  })

  it('hides credential controls when native access is healthy', async () => {
    await browser.keys([process.platform === 'darwin' ? 'Meta' : 'Control', ','])
    const section = await $('[data-test-id="settings-general-panel"]')
    await section.waitForDisplayed()
    assert.doesNotMatch(
      await section.getText(),
      /system credential store|Saved passwords and API keys/
    )
    assert.equal(await $('button=Retry access').isExisting(), false)
  })

  it('rejects invalid values without pausing the app-local vault', async function () {
    this.timeout(180_000)
    await assert.rejects(invokeNative('credential_write', { reference, value: '' }))
    assert.equal(await invokeNative('credential_access_paused'), false)
    assert.equal(await $('button=Retry access').isExisting(), false)
    assert.equal(await invokeNative('credential_status', { reference }), 'missing')
    await invokeNative('credential_retry_access')
    await invokeNative('credential_write', { reference, value: 'disposable' })
    assert.equal(await invokeNative('credential_read', { reference }), 'disposable')
    await invokeNative('credential_remove', { reference })
    assert.equal(await invokeNative('credential_status', { reference }), 'missing')
  })
})
