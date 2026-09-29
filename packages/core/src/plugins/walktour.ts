import type { ModuleInstanceV1, SceneNode } from '@open-pencil/scene-graph'

import { TRANSPARENT } from '#core/constants'

import * as contract from './module-contract'
import { createModuleFrameOverrides } from './module-frame'
import type { ModuleResolution } from './types'
import { WALKTOUR_FIELDS } from './walktour/fields'
import { parseWalktourConfig } from './walktour/parse'
import type { WalktourModuleConfigV1 } from './walktour/types'

export { parseWalktourSteps } from './walktour/parse'
export { WALKTOUR_MODULE_LIMITS } from './walktour/types'
export type { WalktourStep, WalktourModuleConfigV1 } from './walktour/types'
export const WALKTOUR_PLUGIN_ID = 'open-pencil.walktour'
export const WALKTOUR_MODULE_TYPE = 'walktour'
export const WALKTOUR_MODULE_CONFIG_VERSION = 1
export const WALKTOUR_MODULE_TRIGGER_HEIGHT = 44
export const WALKTOUR_MODULE_DEFAULT_SIZE = Object.freeze({
  width: 320,
  height: WALKTOUR_MODULE_TRIGGER_HEIGHT
})
export const WALKTOUR_MODULE_DEFAULT_CONFIG: Readonly<WalktourModuleConfigV1> =
  Object.freeze<WalktourModuleConfigV1>({
    triggerLabel: 'Start tour',
    steps: [
      {
        id: 'welcome',
        title: 'Welcome',
        content: 'Follow this short guide to explore the page.',
        targetChildName: '',
        placement: 'bottom'
      },
      {
        id: 'explore',
        title: 'Explore',
        content: 'Each step can introduce a named child layer.',
        targetChildName: '',
        placement: 'bottom'
      },
      {
        id: 'finish',
        title: 'You are ready',
        content: 'Close this guide and continue at your own pace.',
        targetChildName: '',
        placement: 'bottom'
      }
    ],
    disabled: false,
    showProgress: true,
    showSkip: true,
    panelWidth: 320,
    overlayOpacity: 0.45,
    triggerBackground: '#2563EB',
    triggerTextColor: '#FFFFFF',
    panelBackground: '#FFFFFF',
    textColor: '#172B4D',
    accentColor: '#2563EB',
    borderColor: '#E2E8F0',
    fontSize: 14,
    borderRadius: 8
  })
for (const step of WALKTOUR_MODULE_DEFAULT_CONFIG.steps) Object.freeze(step)
Object.freeze(WALKTOUR_MODULE_DEFAULT_CONFIG.steps)
const KEYS = new Set(Object.keys(WALKTOUR_MODULE_DEFAULT_CONFIG))
const CONTRACT: contract.ModuleContract<WalktourModuleConfigV1> = {
  pluginId: WALKTOUR_PLUGIN_ID,
  moduleType: WALKTOUR_MODULE_TYPE,
  configVersion: WALKTOUR_MODULE_CONFIG_VERSION,
  displayName: 'walktour',
  defaultConfig: WALKTOUR_MODULE_DEFAULT_CONFIG,
  parseConfig: (value) => parseWalktourConfig(value, KEYS)
}
export function createWalktourModuleInstance(config?: unknown): ModuleInstanceV1 {
  return contract.createContractModuleInstance(CONTRACT, config)
}
export function resolveWalktourModule(value: unknown): ModuleResolution<WalktourModuleConfigV1> {
  return contract.resolveContractModule(value, CONTRACT)
}
export function createWalktourModuleFrameOverrides(config?: unknown): Partial<SceneNode> {
  return {
    ...createModuleFrameOverrides({
      name: 'Walktour',
      defaultSize: WALKTOUR_MODULE_DEFAULT_SIZE,
      fillColor: TRANSPARENT,
      strokeColor: TRANSPARENT,
      module: createWalktourModuleInstance(config)
    }),
    fills: [],
    strokes: [],
    cornerRadius: 0,
    layoutMode: 'NONE',
    clipsContent: false
  }
}
export const WALKTOUR_MODULE_DEFINITION = contract.createContractModuleDefinition(CONTRACT, {
  name: 'Guided Tour',
  description:
    'Manually start a local guide to named direct child layers. No automatic launch or business actions.',
  i18nNameKey: 'lowcodeModuleWalktourName',
  i18nDescriptionKey: 'lowcodeModuleWalktourDescription',
  defaultSize: WALKTOUR_MODULE_DEFAULT_SIZE,
  fields: WALKTOUR_FIELDS,
  createInstance: createWalktourModuleInstance,
  createFrameOverrides: createWalktourModuleFrameOverrides,
  resolve: resolveWalktourModule
})
export const WALKTOUR_PLUGIN = contract.createSingleModulePlugin(
  WALKTOUR_PLUGIN_ID,
  'OpenPencil Guided Tour',
  WALKTOUR_MODULE_DEFINITION
)
