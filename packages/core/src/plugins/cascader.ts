import type { ModuleInstanceV1, SceneNode } from '@open-pencil/scene-graph'

import { TRANSPARENT } from '#core/constants'

import { CASCADER_MODULE_FIELDS } from './cascader/fields'
import { parseCascaderConfig } from './cascader/parse'
import type { CascaderModuleConfigV1 } from './cascader/types'
import * as contract from './module-contract'
import { createModuleFrameOverrides } from './module-frame'
import type { ModuleResolution } from './types'

export { parseCascaderItems } from './cascader/parse'
export { CASCADER_MODULE_LIMITS, parseCascaderPath, cascaderPathLabels } from './cascader/types'
export type { CascaderModuleConfigV1 } from './cascader/types'
export const CASCADER_PLUGIN_ID = 'open-pencil.cascader'
export const CASCADER_MODULE_TYPE = 'cascader'
export const CASCADER_MODULE_CONFIG_VERSION = 1
export const CASCADER_MODULE_DEFAULT_SIZE = Object.freeze({ width: 320, height: 44 })
export const CASCADER_MODULE_DEFAULT_CONFIG: Readonly<CascaderModuleConfigV1> = Object.freeze({
  label: 'Location',
  placeholder: 'Choose a location',
  items: [
    { id: 'asia', label: 'Asia', parentId: '', disabled: false },
    { id: 'china', label: 'China', parentId: 'asia', disabled: false },
    { id: 'xiamen', label: 'Xiamen', parentId: 'china', disabled: false },
    { id: 'shanghai', label: 'Shanghai', parentId: 'china', disabled: false },
    { id: 'europe', label: 'Europe', parentId: '', disabled: false },
    { id: 'france', label: 'France', parentId: 'europe', disabled: false }
  ],
  initialPath: [],
  searchable: true,
  clearable: true,
  disabled: false,
  backgroundColor: '#FFFFFF',
  textColor: '#111827',
  accentColor: '#2563EB',
  borderColor: '#CBD5E1',
  fontSize: 14,
  rowHeight: 40,
  borderRadius: 8
})
for (const item of CASCADER_MODULE_DEFAULT_CONFIG.items) Object.freeze(item)
Object.freeze(CASCADER_MODULE_DEFAULT_CONFIG.items)
Object.freeze(CASCADER_MODULE_DEFAULT_CONFIG.initialPath)
const CONTRACT: contract.ModuleContract<CascaderModuleConfigV1> = {
  pluginId: CASCADER_PLUGIN_ID,
  moduleType: CASCADER_MODULE_TYPE,
  configVersion: 1,
  displayName: 'cascader',
  defaultConfig: CASCADER_MODULE_DEFAULT_CONFIG,
  parseConfig: (value) =>
    parseCascaderConfig(value, new Set(Object.keys(CASCADER_MODULE_DEFAULT_CONFIG)))
}
export function createCascaderModuleInstance(config?: unknown): ModuleInstanceV1 {
  return contract.createContractModuleInstance(CONTRACT, config)
}
export function resolveCascaderModule(value: unknown): ModuleResolution<CascaderModuleConfigV1> {
  return contract.resolveContractModule(value, CONTRACT)
}
export function createCascaderModuleFrameOverrides(config?: unknown): Partial<SceneNode> {
  return {
    ...createModuleFrameOverrides({
      name: 'Cascader',
      defaultSize: CASCADER_MODULE_DEFAULT_SIZE,
      fillColor: TRANSPARENT,
      strokeColor: TRANSPARENT,
      module: createCascaderModuleInstance(config)
    }),
    fills: [],
    strokes: [],
    cornerRadius: 0,
    layoutMode: 'NONE'
  }
}
export const CASCADER_MODULE_DEFINITION = contract.createContractModuleDefinition(CONTRACT, {
  name: 'Cascader',
  description:
    'Choose an enabled leaf through a bounded local hierarchy. Supports complete path values, search and clearing.',
  i18nNameKey: 'lowcodeModuleCascaderName',
  i18nDescriptionKey: 'lowcodeModuleCascaderDescription',
  defaultSize: CASCADER_MODULE_DEFAULT_SIZE,
  fields: CASCADER_MODULE_FIELDS,
  createInstance: createCascaderModuleInstance,
  createFrameOverrides: createCascaderModuleFrameOverrides,
  resolve: resolveCascaderModule
})
export const CASCADER_PLUGIN = contract.createSingleModulePlugin(
  CASCADER_PLUGIN_ID,
  'OpenPencil Cascader',
  CASCADER_MODULE_DEFINITION
)
