import * as config from '@open-pencil/plugin-contracts/adapter-helpers'
import type { ModuleInstanceV1, SceneNode } from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import { TRANSPARENT } from '#core/constants'

import * as contract from './module-contract'
import { createModuleFrameOverrides } from './module-frame'
import type { ModulePropertyField, ModuleResolution } from './types'

export const TOOLTIP_PLUGIN_ID = 'open-pencil.tooltip'
export const TOOLTIP_MODULE_TYPE = 'tooltip'
export const TOOLTIP_MODULE_CONFIG_VERSION = 1
export const TOOLTIP_MODULE_DEFAULT_SIZE = Object.freeze({ width: 200, height: 44 })
export interface TooltipModuleConfigV1 extends JSONObject {
  triggerLabel: string
  content: string
  placement: 'top' | 'right' | 'bottom' | 'left'
  gap: number
  maxWidth: number
  backgroundColor: string
  textColor: string
  triggerBackground: string
  triggerTextColor: string
  borderRadius: number
  fontSize: number
  openDelay: number
  closeDelay: number
}
export const TOOLTIP_MODULE_DEFAULT_CONFIG: Readonly<TooltipModuleConfigV1> = Object.freeze({
  triggerLabel: 'More information',
  content: 'Helpful information about this item.',
  placement: 'top',
  gap: 8,
  maxWidth: 280,
  backgroundColor: '#1F2937',
  textColor: '#FFFFFF',
  triggerBackground: '#EFF6FF',
  triggerTextColor: '#1D4ED8',
  borderRadius: 8,
  fontSize: 14,
  openDelay: 300,
  closeDelay: 150
})
const PLACEMENTS = new Set<TooltipModuleConfigV1['placement']>(['top', 'right', 'bottom', 'left'])
const KEYS = new Set(Object.keys(TOOLTIP_MODULE_DEFAULT_CONFIG))
export function parseTooltipConfig(value: unknown) {
  return contract.parseExactModuleConfig(
    value,
    KEYS,
    'tooltip config must contain exactly its declared fields',
    (source) => {
      const integer = (key: string, min: number, max: number) =>
        config.parseBoundedPluginInteger(source[key], 'tooltip ' + key, min, max)
      const color = (key: string) => config.parseCanonicalPluginColor(source[key], 'tooltip ' + key)
      const result: TooltipModuleConfigV1 = {
        triggerLabel: config.parseBoundedPluginText(source.triggerLabel, 'tooltip trigger', 1, 120),
        content: config.parseBoundedPluginText(source.content, 'tooltip content', 1, 1000),
        placement: config.parsePluginStringEnum(
          source.placement,
          'tooltip placement',
          PLACEMENTS,
          'top, right, bottom, or left'
        ),
        gap: integer('gap', 0, 32),
        maxWidth: integer('maxWidth', 80, 600),
        backgroundColor: color('backgroundColor'),
        textColor: color('textColor'),
        triggerBackground: color('triggerBackground'),
        triggerTextColor: color('triggerTextColor'),
        borderRadius: integer('borderRadius', 0, 32),
        fontSize: integer('fontSize', 10, 32),
        openDelay: integer('openDelay', 0, 2000),
        closeDelay: integer('closeDelay', 0, 1000)
      }
      config.assertBoundedPluginConfigBytes(result, 'tooltip config', 8192)
      return result
    }
  )
}
const CONTRACT: contract.ModuleContract<TooltipModuleConfigV1> = {
  pluginId: TOOLTIP_PLUGIN_ID,
  moduleType: TOOLTIP_MODULE_TYPE,
  configVersion: TOOLTIP_MODULE_CONFIG_VERSION,
  displayName: 'tooltip',
  defaultConfig: TOOLTIP_MODULE_DEFAULT_CONFIG,
  parseConfig: parseTooltipConfig
}
export function createTooltipModuleInstance(config?: unknown): ModuleInstanceV1 {
  return contract.createContractModuleInstance(CONTRACT, config)
}
export function resolveTooltipModule(value: unknown): ModuleResolution<TooltipModuleConfigV1> {
  return contract.resolveContractModule(value, CONTRACT)
}
export function createTooltipModuleFrameOverrides(config?: unknown): Partial<SceneNode> {
  return {
    ...createModuleFrameOverrides({
      name: 'Tooltip',
      defaultSize: TOOLTIP_MODULE_DEFAULT_SIZE,
      fillColor: TRANSPARENT,
      strokeColor: TRANSPARENT,
      module: createTooltipModuleInstance(config)
    }),
    fills: [],
    strokes: [],
    cornerRadius: 0,
    clipsContent: false
  }
}
const field = (
  key: string,
  label: string,
  kind: ModulePropertyField['kind'],
  extra: Partial<ModulePropertyField> = {}
): ModulePropertyField => ({
  path: [key],
  kind,
  label,
  i18nLabelKey: 'lowcodeModuleFieldTooltip' + key[0].toUpperCase() + key.slice(1),
  ...extra
})
export const TOOLTIP_MODULE_DEFINITION = contract.createContractModuleDefinition(CONTRACT, {
  name: 'Tooltip',
  description: 'Plain-text help on pointer hover, keyboard focus, or touch. No business action.',
  i18nNameKey: 'lowcodeModuleTooltipName',
  i18nDescriptionKey: 'lowcodeModuleTooltipDescription',
  defaultSize: TOOLTIP_MODULE_DEFAULT_SIZE,
  fields: [
    field('triggerLabel', 'Trigger text', 'text'),
    field('content', 'Help text', 'text'),
    field('placement', 'Preferred placement', 'select', { options: [...PLACEMENTS] }),
    field('gap', 'Distance', 'number', { min: 0, max: 32, step: 1 }),
    field('maxWidth', 'Maximum help width', 'number', { min: 80, max: 600, step: 1 }),
    field('backgroundColor', 'Help background', 'color'),
    field('textColor', 'Help text color', 'color'),
    field('triggerBackground', 'Trigger background', 'color'),
    field('triggerTextColor', 'Trigger text color', 'color'),
    field('borderRadius', 'Corner radius', 'number', { min: 0, max: 32, step: 1 }),
    field('fontSize', 'Font size', 'number', { min: 10, max: 32, step: 1 }),
    field('openDelay', 'Hover delay (ms)', 'number', { min: 0, max: 2000, step: 50 }),
    field('closeDelay', 'Close delay (ms)', 'number', { min: 0, max: 1000, step: 50 })
  ],
  createInstance: createTooltipModuleInstance,
  createFrameOverrides: createTooltipModuleFrameOverrides,
  resolve: resolveTooltipModule
})
export const TOOLTIP_PLUGIN = contract.createSingleModulePlugin(
  TOOLTIP_PLUGIN_ID,
  'Tooltip',
  TOOLTIP_MODULE_DEFINITION
)
