import * as config from '@open-pencil/plugin-contracts/adapter-helpers'
import type { ModuleInstanceV1, SceneNode } from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import { TRANSPARENT } from '#core/constants'

import * as contract from './module-contract'
import { createModuleFrameOverrides } from './module-frame'
import { popoverFields } from './popover/fields'
import type { ModuleResolution } from './types'

export const POPOVER_PLUGIN_ID = 'open-pencil.popover'
export const POPOVER_MODULE_TYPE = 'popover'
export const POPOVER_MODULE_CONFIG_VERSION = 1
export const POPOVER_MODULE_DEFAULT_SIZE = Object.freeze({ width: 200, height: 44 })
export interface PopoverModuleConfigV1 extends JSONObject {
  mode: 'popover' | 'confirm'
  triggerLabel: string
  title: string
  content: string
  contentChildName: string
  placement: 'top' | 'right' | 'bottom' | 'left'
  gap: number
  panelWidth: number
  disabled: boolean
  confirmLabel: string
  cancelLabel: string
  panelBackground: string
  textColor: string
  accentColor: string
  triggerBackground: string
  triggerTextColor: string
  borderRadius: number
  fontSize: number
}
export const POPOVER_MODULE_DEFAULT_CONFIG: Readonly<PopoverModuleConfigV1> = Object.freeze({
  mode: 'popover',
  triggerLabel: 'Show details',
  title: 'Details',
  content: 'Add supporting information, or map an editable content layer.',
  contentChildName: '',
  placement: 'bottom',
  gap: 8,
  panelWidth: 320,
  disabled: false,
  confirmLabel: 'Confirm',
  cancelLabel: 'Cancel',
  panelBackground: '#FFFFFF',
  textColor: '#1F2937',
  accentColor: '#2563EB',
  triggerBackground: '#EFF6FF',
  triggerTextColor: '#1D4ED8',
  borderRadius: 8,
  fontSize: 14
})
const MODES = new Set<PopoverModuleConfigV1['mode']>(['popover', 'confirm'])
const PLACEMENTS = new Set<PopoverModuleConfigV1['placement']>(['top', 'right', 'bottom', 'left'])
const KEYS = new Set(Object.keys(POPOVER_MODULE_DEFAULT_CONFIG))
export function parsePopoverConfig(value: unknown) {
  return contract.parseExactModuleConfig(
    value,
    KEYS,
    'popover config requires exactly its declared fields',
    (source) => {
      const text = (key: string, min: number, max: number) =>
        config.parseBoundedPluginText(source[key], 'popover ' + key, min, max)
      const integer = (key: string, min: number, max: number) =>
        config.parseBoundedPluginInteger(source[key], 'popover ' + key, min, max)
      const color = (key: string) => config.parseCanonicalPluginColor(source[key], 'popover ' + key)
      const result: PopoverModuleConfigV1 = {
        mode: config.parsePluginStringEnum(
          source.mode,
          'popover mode',
          MODES,
          'popover or confirm'
        ),
        triggerLabel: text('triggerLabel', 1, 120),
        title: text('title', 0, 160),
        content: text('content', 0, 4000),
        contentChildName: text('contentChildName', 0, 120),
        placement: config.parsePluginStringEnum(
          source.placement,
          'popover placement',
          PLACEMENTS,
          'top, right, bottom, or left'
        ),
        gap: integer('gap', 0, 32),
        panelWidth: integer('panelWidth', 160, 720),
        disabled: config.parsePluginBoolean(source.disabled, 'popover disabled'),
        confirmLabel: text('confirmLabel', 1, 40),
        cancelLabel: text('cancelLabel', 1, 40),
        panelBackground: color('panelBackground'),
        textColor: color('textColor'),
        accentColor: color('accentColor'),
        triggerBackground: color('triggerBackground'),
        triggerTextColor: color('triggerTextColor'),
        borderRadius: integer('borderRadius', 0, 32),
        fontSize: integer('fontSize', 10, 32)
      }
      config.assertBoundedPluginConfigBytes(result, 'popover config', 24_576)
      return result
    }
  )
}
const CONTRACT: contract.ModuleContract<PopoverModuleConfigV1> = {
  pluginId: POPOVER_PLUGIN_ID,
  moduleType: POPOVER_MODULE_TYPE,
  configVersion: POPOVER_MODULE_CONFIG_VERSION,
  displayName: 'popover',
  defaultConfig: POPOVER_MODULE_DEFAULT_CONFIG,
  parseConfig: parsePopoverConfig
}
export function createPopoverModuleInstance(config?: unknown): ModuleInstanceV1 {
  return contract.createContractModuleInstance(CONTRACT, config)
}
export function resolvePopoverModule(value: unknown): ModuleResolution<PopoverModuleConfigV1> {
  return contract.resolveContractModule(value, CONTRACT)
}
export function createPopoverModuleFrameOverrides(config?: unknown): Partial<SceneNode> {
  return {
    ...createModuleFrameOverrides({
      name: 'Popover',
      defaultSize: POPOVER_MODULE_DEFAULT_SIZE,
      fillColor: TRANSPARENT,
      strokeColor: TRANSPARENT,
      module: createPopoverModuleInstance(config)
    }),
    fills: [],
    strokes: [],
    cornerRadius: 0,
    clipsContent: false
  }
}
export const POPOVER_MODULE_DEFINITION = contract.createContractModuleDefinition(CONTRACT, {
  name: 'Popover / Confirmation',
  description:
    'Click to open supporting content or a local confirmation. No business action is performed.',
  i18nNameKey: 'lowcodeModulePopoverName',
  i18nDescriptionKey: 'lowcodeModulePopoverDescription',
  defaultSize: POPOVER_MODULE_DEFAULT_SIZE,
  fields: popoverFields(),
  createInstance: createPopoverModuleInstance,
  createFrameOverrides: createPopoverModuleFrameOverrides,
  resolve: resolvePopoverModule
})
export const POPOVER_PLUGIN = contract.createSingleModulePlugin(
  POPOVER_PLUGIN_ID,
  'Popover',
  POPOVER_MODULE_DEFINITION
)
