import { describe, expect, test } from 'bun:test'

import { VUE_EXPORTER, VUE_EXPORTER_PLUGIN_ID } from '@/app/plugins/host/ids'
import {
  bundledPluginLocalizedSearchText,
  localizedAppPluginContributionText,
  localizedAppPluginText
} from '@/app/plugins/localization'

describe('Vue exporter localization', () => {
  test('uses reviewed Simplified Chinese copy without mutating the bundled manifest', () => {
    const plugin = localizedAppPluginText(VUE_EXPORTER_PLUGIN_ID, 'zh-CN')
    const contribution = localizedAppPluginContributionText(
      VUE_EXPORTER_PLUGIN_ID,
      VUE_EXPORTER.exporterId,
      'zh-CN'
    )
    expect(plugin?.name).toBe('Vue 导出器')
    expect(plugin?.description).toContain('Vue 3')
    expect(contribution?.name).toBe('导出 Vue 源码')
    expect(contribution?.description).toContain('ZIP')
    expect(localizedAppPluginText(VUE_EXPORTER_PLUGIN_ID, 'en-US')).toBeUndefined()
    expect(bundledPluginLocalizedSearchText(VUE_EXPORTER_PLUGIN_ID)).toContain('降级项')
  })
})
