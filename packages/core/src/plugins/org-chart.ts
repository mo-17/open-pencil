import type { ModuleInstanceV1, SceneNode } from '@open-pencil/scene-graph'

import { TRANSPARENT } from '#core/constants'

import * as contract from './module-contract'
import { createModuleFrameOverrides } from './module-frame'
import { ORG_CHART_FIELDS } from './org-chart/fields'
import { parseOrgChartConfig } from './org-chart/parse'
import type { OrgChartModuleConfigV1 } from './org-chart/types'
import type { ModuleResolution } from './types'

export { parseOrgChartItems } from './org-chart/parse'
export { ORG_CHART_MODULE_LIMITS } from './org-chart/types'
export { orgChartLayout, ORG_CHART_LAYOUT } from './org-chart/layout'
export type {
  OrgChartItem,
  OrgChartModuleConfigV1,
  OrgChartCard,
  OrgChartConnector,
  OrgChartLayout
} from './org-chart/types'
export const ORG_CHART_PLUGIN_ID = 'open-pencil.org-chart'
export const ORG_CHART_MODULE_TYPE = 'org-chart'
export const ORG_CHART_MODULE_CONFIG_VERSION = 1
export const ORG_CHART_MODULE_DEFAULT_SIZE = Object.freeze({ width: 640, height: 400 })
export const ORG_CHART_MODULE_DEFAULT_CONFIG: Readonly<OrgChartModuleConfigV1> = Object.freeze({
  label: 'Organization chart',
  items: [
    { id: 'root', parentId: '', label: 'Organization', description: 'Our team' },
    { id: 'design', parentId: 'root', label: 'Design', description: 'Product experience' },
    {
      id: 'engineering',
      parentId: 'root',
      label: 'Engineering',
      description: 'Product development'
    },
    { id: 'designer', parentId: 'design', label: 'Designer', description: 'Design team' },
    {
      id: 'developer',
      parentId: 'engineering',
      label: 'Developer',
      description: 'Engineering team'
    }
  ],
  direction: 'vertical',
  collapsible: true,
  initialCollapsedIds: [],
  backgroundColor: '#F8FAFC',
  cardColor: '#FFFFFF',
  textColor: '#172B4D',
  mutedColor: '#64748B',
  accentColor: '#2563EB',
  borderColor: '#E2E8F0',
  connectorColor: '#94A3B8',
  fontSize: 14,
  borderRadius: 8
})
for (const item of ORG_CHART_MODULE_DEFAULT_CONFIG.items) Object.freeze(item)
Object.freeze(ORG_CHART_MODULE_DEFAULT_CONFIG.items)
Object.freeze(ORG_CHART_MODULE_DEFAULT_CONFIG.initialCollapsedIds)
const CONFIG_KEYS = new Set(Object.keys(ORG_CHART_MODULE_DEFAULT_CONFIG))
const CONTRACT: contract.ModuleContract<OrgChartModuleConfigV1> = {
  pluginId: ORG_CHART_PLUGIN_ID,
  moduleType: ORG_CHART_MODULE_TYPE,
  configVersion: ORG_CHART_MODULE_CONFIG_VERSION,
  displayName: 'org chart',
  defaultConfig: ORG_CHART_MODULE_DEFAULT_CONFIG,
  parseConfig: (value) => parseOrgChartConfig(value, CONFIG_KEYS)
}
export function createOrgChartModuleInstance(config?: unknown): ModuleInstanceV1 {
  return contract.createContractModuleInstance(CONTRACT, config)
}
export function resolveOrgChartModule(value: unknown): ModuleResolution<OrgChartModuleConfigV1> {
  return contract.resolveContractModule(value, CONTRACT)
}
export function createOrgChartModuleFrameOverrides(config?: unknown): Partial<SceneNode> {
  return {
    ...createModuleFrameOverrides({
      name: 'Org Chart',
      defaultSize: ORG_CHART_MODULE_DEFAULT_SIZE,
      fillColor: TRANSPARENT,
      strokeColor: TRANSPARENT,
      module: createOrgChartModuleInstance(config)
    }),
    fills: [],
    strokes: [],
    cornerRadius: 0
  }
}
export const ORG_CHART_MODULE_DEFINITION = contract.createContractModuleDefinition(CONTRACT, {
  name: 'Organization Chart',
  description: 'Bounded local organization hierarchy with readable cards and collapsible branches.',
  i18nNameKey: 'lowcodeModuleOrgChartName',
  i18nDescriptionKey: 'lowcodeModuleOrgChartDescription',
  defaultSize: ORG_CHART_MODULE_DEFAULT_SIZE,
  fields: ORG_CHART_FIELDS,
  createInstance: createOrgChartModuleInstance,
  createFrameOverrides: createOrgChartModuleFrameOverrides,
  resolve: resolveOrgChartModule
})
export const ORG_CHART_PLUGIN = contract.createSingleModulePlugin(
  ORG_CHART_PLUGIN_ID,
  'OpenPencil Organization Chart',
  ORG_CHART_MODULE_DEFINITION
)
