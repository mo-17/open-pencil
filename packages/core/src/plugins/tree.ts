import type { ModuleInstanceV1, SceneNode } from '@open-pencil/scene-graph'

import { TRANSPARENT } from '#core/constants'

import * as contract from './module-contract'
import { createModuleFrameOverrides } from './module-frame'
import { TREE_MODULE_FIELDS } from './tree/fields'
import { parseTreeConfig } from './tree/parse'
import type { TreeModuleConfigV1 } from './tree/types'
import type { ModuleResolution } from './types'
export { parseTreeItems } from './tree/parse'
export { TREE_MODULE_LIMITS, treeVisibleRows, treeItemDisabled } from './tree/types'
export type { TreeItem, TreeModuleConfigV1, TreeRow } from './tree/types'
export const TREE_PLUGIN_ID = 'open-pencil.tree'
export const TREE_MODULE_TYPE = 'tree'
export const TREE_MODULE_CONFIG_VERSION = 1
export const TREE_MODULE_DEFAULT_SIZE = Object.freeze({ width: 320, height: 360 })
export const TREE_MODULE_DEFAULT_CONFIG: Readonly<TreeModuleConfigV1> = Object.freeze({
  presentation: 'tree',
  label: 'Project files',
  placeholder: 'Choose an item',
  items: [
    { id: 'project', label: 'Project', parentId: '', disabled: false },
    { id: 'design', label: 'Design', parentId: 'project', disabled: false },
    { id: 'development', label: 'Development', parentId: 'project', disabled: false },
    { id: 'archive', label: 'Archive', parentId: '', disabled: true }
  ],
  selectionMode: 'single',
  initialSelectedIds: [],
  initialExpandedIds: ['project'],
  searchable: true,
  disabled: false,
  showValue: true,
  backgroundColor: '#FFFFFF',
  textColor: '#111827',
  accentColor: '#2563EB',
  borderColor: '#CBD5E1',
  fontSize: 14,
  rowHeight: 40
})
const CONTRACT: contract.ModuleContract<TreeModuleConfigV1> = {
  pluginId: TREE_PLUGIN_ID,
  moduleType: TREE_MODULE_TYPE,
  configVersion: 1,
  displayName: 'tree',
  defaultConfig: TREE_MODULE_DEFAULT_CONFIG,
  parseConfig: (value) => parseTreeConfig(value, new Set(Object.keys(TREE_MODULE_DEFAULT_CONFIG)))
}
export function createTreeModuleInstance(config?: unknown): ModuleInstanceV1 {
  return contract.createContractModuleInstance(CONTRACT, config)
}
export function resolveTreeModule(value: unknown): ModuleResolution<TreeModuleConfigV1> {
  return contract.resolveContractModule(value, CONTRACT)
}
export function createTreeModuleFrameOverrides(config?: unknown): Partial<SceneNode> {
  return {
    ...createModuleFrameOverrides({
      name: 'Tree',
      defaultSize: TREE_MODULE_DEFAULT_SIZE,
      fillColor: TRANSPARENT,
      strokeColor: TRANSPARENT,
      module: createTreeModuleInstance(config)
    }),
    fills: [],
    strokes: [],
    cornerRadius: 0
  }
}
export const TREE_MODULE_DEFINITION = contract.createContractModuleDefinition(CONTRACT, {
  name: 'Tree / TreeSelect',
  description:
    'Bounded local tree search, independent selection, and expandable branches. No form or remote binding.',
  i18nNameKey: 'lowcodeModuleTreeName',
  i18nDescriptionKey: 'lowcodeModuleTreeDescription',
  defaultSize: TREE_MODULE_DEFAULT_SIZE,
  fields: TREE_MODULE_FIELDS,
  createInstance: createTreeModuleInstance,
  createFrameOverrides: createTreeModuleFrameOverrides,
  resolve: resolveTreeModule
})
export const TREE_PLUGIN = contract.createSingleModulePlugin(
  TREE_PLUGIN_ID,
  'OpenPencil Tree',
  TREE_MODULE_DEFINITION
)
