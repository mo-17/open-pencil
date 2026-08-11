import { describe, expect, test } from 'bun:test'

import { REVIEWED_EXTERNAL_SERVICE_CATALOG } from '@/app/plugins/connectors/services'
import {
  localizedAppPluginContributionText,
  localizedAppPluginText,
  type AppPluginLocalizedContributionText
} from '@/app/plugins/localization'

const SIMPLIFIED_CHINESE = /[\u3400-\u9fff]/

function expectSimplifiedChinese(
  text: AppPluginLocalizedContributionText | undefined,
  identity: string
): asserts text is AppPluginLocalizedContributionText {
  expect(text, `${identity} should have Simplified Chinese copy`).toBeDefined()
  expect(text?.name, `${identity} name should be localized`).toMatch(SIMPLIFIED_CHINESE)
  expect(text?.description, `${identity} description should be localized`).toMatch(
    SIMPLIFIED_CHINESE
  )
}

describe('reviewed external service localization', () => {
  test('localizes every plugin, connector, operation, and credential slot in zh-CN', () => {
    expect(REVIEWED_EXTERNAL_SERVICE_CATALOG).toHaveLength(17)

    for (const descriptor of REVIEWED_EXTERNAL_SERVICE_CATALOG) {
      const contract = descriptor.connector.contract
      const pluginText = localizedAppPluginText(contract.pluginId, 'zh-CN')
      expectSimplifiedChinese(pluginText, contract.pluginId)

      const connectorText = localizedAppPluginContributionText(
        contract.pluginId,
        contract.connectorId,
        'zh-CN'
      )
      expectSimplifiedChinese(connectorText, `${contract.pluginId}/${contract.connectorId}`)

      expect(contract.operations).toHaveLength(1)
      for (const operation of contract.operations) {
        expectSimplifiedChinese(
          localizedAppPluginContributionText(contract.pluginId, operation.operationId, 'zh-CN'),
          `${contract.pluginId}/${operation.operationId}`
        )
      }

      for (const slot of contract.credentialSlots) {
        const credentialText = localizedAppPluginContributionText(
          contract.pluginId,
          slot.slotId,
          'zh-CN'
        )
        expectSimplifiedChinese(credentialText, `${contract.pluginId}/${slot.slotId}`)
        expect(credentialText.description).toContain('请')
        for (const scope of descriptor.manualSetup.scopes) {
          expect(credentialText.description).toContain(scope)
        }
      }
    }
  })

  test('keeps en-US on signed manifest copy', () => {
    for (const descriptor of REVIEWED_EXTERNAL_SERVICE_CATALOG) {
      const contract = descriptor.connector.contract
      const pluginText = localizedAppPluginText(contract.pluginId, 'en-US')
      expect(pluginText).toBeUndefined()
      expect(pluginText?.name ?? contract.name).toBe(contract.name)
      expect(pluginText?.description ?? contract.description).toBe(contract.description)

      const connectorText = localizedAppPluginContributionText(
        contract.pluginId,
        contract.connectorId,
        'en-US'
      )
      expect(connectorText).toBeUndefined()
      expect(connectorText?.name ?? contract.name).toBe(contract.name)
      expect(connectorText?.description ?? contract.description).toBe(contract.description)

      for (const operation of contract.operations) {
        const operationText = localizedAppPluginContributionText(
          contract.pluginId,
          operation.operationId,
          'en-US'
        )
        expect(operationText).toBeUndefined()
        expect(operationText?.name ?? operation.name).toBe(operation.name)
        expect(operationText?.description ?? operation.description).toBe(operation.description)
      }

      for (const slot of contract.credentialSlots) {
        const credentialText = localizedAppPluginContributionText(
          contract.pluginId,
          slot.slotId,
          'en-US'
        )
        expect(credentialText).toBeUndefined()
        expect(credentialText?.name ?? slot.label).toBe(slot.label)
      }
    }
  })
})
