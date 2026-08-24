import { describe, expect, test } from 'bun:test'

import zhDialogs from '#vue/i18n/locales/zh-cn/dialogs.json'
import { dialogMessageDefaults } from '#vue/i18n/messages/dialogs'

describe('third-party plugin AI authorization settings', () => {
  test('renders only inside publisher-signed installed plugin cards', async () => {
    const panel = await Bun.file('src/components/settings/plugins/PluginsPanel.vue').text()

    expect(panel).toContain("import PluginAIAccessControls from './PluginAIAccessControls.vue'")
    expect(panel).toContain('<PluginAIAccessControls')
    expect(panel).toContain(`v-if="plugin.package.trustSource === 'publisher-signature'"`)
  })

  test('uses the global session grant manager and exact contribution authority', async () => {
    const source = await Bun.file(
      'src/components/settings/plugins/PluginAIAccessControls.vue'
    ).text()

    expect(source).toContain('appPluginAIAuthorizationSnapshot')
    expect(source).toContain('appPluginAIAuthorization.listReviews')
    expect(source).toContain('review: appPluginAIAuthorization.review(review)')
    expect(source).toContain('appPluginAIAuthorization.grant(value.review)')
    expect(source).toContain('appPluginAIAuthorization.revoke(value.review)')
    for (const field of [
      'pluginId',
      'kind',
      'contributionId',
      'adapterId',
      'packageDigest',
      'pluginVersion',
      'publisherId',
      'publisherKeyId',
      'connectorId',
      'operationId'
    ]) {
      expect(source).toContain(`left.${field}`)
    }
    expect(source).not.toContain('appPluginAIAuthorization.revokePlugin')
    expect(source).not.toContain('appPluginAIAuthorization.clear')
    expect(source).not.toContain('localStorage')
    expect(source).not.toContain('indexedDB')
  })

  test('requires an exact alert-dialog review and explains both safety boundaries', async () => {
    const source = await Bun.file(
      'src/components/settings/plugins/PluginAIAccessControls.vue'
    ).text()

    expect(source).toContain('<AppAlertDialogRoot')
    expect(source).toContain('pluginAIAccessPackageAuthority')
    expect(source).toContain('pluginAIAccessPublisherAuthority')
    expect(source).toContain('pluginAIAccessContributionAuthority')
    expect(source).toContain('pluginAIAccessAdapterAuthority')
    expect(source).toContain('pluginAIAccessScopeAuthority')
    expect(source).toContain('pluginAIAccessConnectorAuthority')
    expect(source).toContain('request.origin ?? request.originTemplate')
    expect(source).toContain('request.method')
    expect(source).toContain('request.pathTemplate')
    expect(source).toContain(':aria-label="actionLabel(review)"')
    expect(dialogMessageDefaults.pluginAIAccessApprovalRequired).toContain('Every invocation')
    expect(dialogMessageDefaults.pluginAIAccessSessionOnly).toContain('Restarting OpenPencil')
    expect(zhDialogs.pluginAIAccessApprovalRequired).toContain('每次调用')
    expect(zhDialogs.pluginAIAccessSessionOnly).toContain('重启 OpenPencil')
  })
})
