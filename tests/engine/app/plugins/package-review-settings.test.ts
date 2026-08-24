import { describe, expect, test } from 'bun:test'

import zhDialogs from '#vue/i18n/locales/zh-cn/dialogs.json'
import { dialogMessageDefaults } from '#vue/i18n/messages/dialogs'

describe('third-party plugin package review settings', () => {
  test('gates publisher installation and update while preserving app-bundle direct actions', async () => {
    const panel = await Bun.file('src/components/settings/plugins/PluginsPanel.vue').text()

    expect(panel).toContain(
      "import PluginPackageReviewDialog from './PluginPackageReviewDialog.vue'"
    )
    expect(panel).toContain("catalogItem?.package.trustSource === 'publisher-signature'")
    expect(panel).toContain("plugin.package.trustSource !== 'publisher-signature'")
    expect(panel).toContain("action: 'install'")
    expect(panel).toContain("action: 'update'")
    expect(panel).toContain(
      'await appPluginStore.installReviewed(review.pluginId, review.pluginPackage)'
    )
    expect(panel).toContain('await appPluginStore.acceptUpdateReviewed(')
    expect(panel).toContain('void mutate(pluginIdValue, async () => {')
    expect(panel).toContain('await appPluginStore.install(pluginIdValue)')
  })

  test('rechecks the exact package and catalog authority before dispatch', async () => {
    const panel = await Bun.file('src/components/settings/plugins/PluginsPanel.vue').text()
    const authoritySource = await Bun.file('src/app/plugins/review-authority.ts').text()

    for (const field of [
      'manifest.plugin.id',
      'manifest.plugin.version',
      'manifest.publisher.id',
      'manifest.publisher.keyId',
      'verifiedPackage.verifiedKeyId',
      'catalogId',
      'catalogVersion',
      'catalogDigest',
      'catalogExpiresAt',
      'source'
    ]) {
      expect(authoritySource).toContain(field)
    }
    expect(authoritySource).toContain('sameAppPluginMarketplaceAuthority')
    expect(panel).toContain('packageReviewAuthorityCurrent(review)')
    expect(panel).toContain('pluginPackageReviewAuthorityChanged')
  })

  test('shows exact authority, V2 contracts, busy feedback, inline errors, and focus recovery', async () => {
    const source = await Bun.file(
      'src/components/settings/plugins/PluginPackageReviewDialog.vue'
    ).text()

    expect(source).toContain('<AppAlertDialogRoot')
    expect(source).toContain('<PluginV2ContractSummary')
    expect(source).toContain('pluginPackage.manifest.publisher.id')
    expect(source).toContain('pluginPackage.verifiedPackage?.verifiedKeyId')
    expect(source).toContain('pluginPackage.remoteCatalog.catalogExpiresAt')
    expect(source).toContain(':aria-busy="busy"')
    expect(source).toContain('aria-live="assertive"')
    expect(source).toContain('data-test-id="plugin-package-review-cancel"')
    expect(source).toContain('data-test-id="plugin-package-review-confirm"')
    expect(source).toContain('!catalogAuthorizationCurrent()')
    expect(source).not.toContain('<AlertDialogAction')

    const panel = await Bun.file('src/components/settings/plugins/PluginsPanel.vue').text()
    expect(panel).toContain('returnFocus?.isConnected')
    expect(panel).toContain('returnFocus.focus()')
    expect(panel).toContain('return reason')
  })

  test('keeps English and Chinese safety copy explicit', () => {
    expect(dialogMessageDefaults.pluginPackageReviewInstallDescription).toContain(
      'catalog provenance'
    )
    expect(dialogMessageDefaults.pluginPackageReviewLegacyContract).toContain('network')
    expect(dialogMessageDefaults.pluginPackageReviewAuthorityChanged).toContain('changed')
    expect(zhDialogs.pluginPackageReviewInstallDescription).toContain('目录来源')
    expect(zhDialogs.pluginPackageReviewLegacyContract).toContain('网络')
    expect(zhDialogs.pluginPackageReviewAuthorityChanged).toContain('已变化')
  })
})
