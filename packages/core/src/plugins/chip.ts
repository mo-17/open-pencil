import * as configParser from '@open-pencil/plugin-contracts/adapter-helpers'
import type { ModuleInstanceV1, SceneNode } from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import * as contract from './module-contract'
import { createModuleFrameOverrides } from './module-frame'
import type { ModulePropertyField, ModuleResolution } from './types'

export const CHIP_PLUGIN_ID = 'open-pencil.chip'
export const CHIP_MODULE_TYPE = 'chip'
export const CHIP_MODULE_CONFIG_VERSION = 1
export const CHIP_MODULE_DEFAULT_SIZE = Object.freeze({ width: 176, height: 44 })
export const CHIP_LAYOUT = Object.freeze({
  actionSize: 44,
  inset: 12,
  selectedInset: 36,
  lineHeight: 1.2
})
export const CHIP_CHECK_PATH = 'M3 8 6.5 11.5 13 4.5'
export const CHIP_DELETE_PATH = 'M4 4 12 12 M12 4 4 12'

export interface ChipModuleConfigV1 extends JSONObject {
  label: string
  variant: 'soft' | 'outlined' | 'filled'
  color: string
  filledTextColor: string
  borderRadius: number
  fontSize: number
  selectable: boolean
  initialSelected: boolean
  deletable: boolean
  deleteLabel: string
  removedLabel: string
  disabled: boolean
}
export type ChipModuleConfig = ChipModuleConfigV1
export const CHIP_MODULE_DEFAULT_CONFIG: Readonly<ChipModuleConfigV1> = Object.freeze({
  label: 'Status label',
  variant: 'soft',
  color: '#2563EB',
  filledTextColor: '#FFFFFF',
  borderRadius: 16,
  fontSize: 14,
  selectable: false,
  initialSelected: false,
  deletable: false,
  deleteLabel: 'Remove label',
  removedLabel: 'Label removed',
  disabled: false
})
const KEYS = new Set(Object.keys(CHIP_MODULE_DEFAULT_CONFIG))
const CHIP_CONTRACT: contract.ModuleContract<ChipModuleConfigV1> = {
  pluginId: CHIP_PLUGIN_ID,
  moduleType: CHIP_MODULE_TYPE,
  configVersion: CHIP_MODULE_CONFIG_VERSION,
  displayName: 'chip',
  defaultConfig: CHIP_MODULE_DEFAULT_CONFIG,
  parseConfig: (value) =>
    contract.parseExactModuleConfig(
      value,
      KEYS,
      'chip config must contain exactly the declared fields',
      (source): ChipModuleConfigV1 => {
        const config: ChipModuleConfigV1 = {
          label: configParser.parseBoundedPluginText(source.label, 'chip label', 1, 120),
          variant: configParser.parsePluginStringEnum(
            source.variant,
            'chip variant',
            new Set(['soft', 'outlined', 'filled'] as const),
            'soft, outlined, or filled'
          ),
          color: configParser.parseCanonicalPluginColor(source.color, 'chip color'),
          filledTextColor: configParser.parseCanonicalPluginColor(
            source.filledTextColor,
            'chip filledTextColor'
          ),
          borderRadius: configParser.parseBoundedPluginNumber(
            source.borderRadius,
            'chip borderRadius',
            0,
            32
          ),
          fontSize: configParser.parseBoundedPluginNumber(source.fontSize, 'chip fontSize', 10, 32),
          selectable: configParser.parsePluginBoolean(source.selectable, 'chip selectable'),
          initialSelected: configParser.parsePluginBoolean(
            source.initialSelected,
            'chip initialSelected'
          ),
          deletable: configParser.parsePluginBoolean(source.deletable, 'chip deletable'),
          deleteLabel: configParser.parseBoundedPluginText(
            source.deleteLabel,
            'chip deleteLabel',
            1,
            80
          ),
          removedLabel: configParser.parseBoundedPluginText(
            source.removedLabel,
            'chip removedLabel',
            1,
            120
          ),
          disabled: configParser.parsePluginBoolean(source.disabled, 'chip disabled')
        }
        configParser.assertBoundedPluginConfigBytes(config, 'chip config', 4096)
        return config
      }
    )
}
export function createChipModuleInstance(config?: unknown): ModuleInstanceV1 {
  return contract.createContractModuleInstance(CHIP_CONTRACT, config)
}
export function resolveChipModule(value: unknown): ModuleResolution<ChipModuleConfigV1> {
  return contract.resolveContractModule(value, CHIP_CONTRACT)
}
export function createChipModuleFrameOverrides(config?: unknown): Partial<SceneNode> {
  return {
    ...createModuleFrameOverrides({
      name: 'Chip',
      defaultSize: CHIP_MODULE_DEFAULT_SIZE,
      fillColor: { r: 1, g: 1, b: 1, a: 0 },
      strokeColor: { r: 1, g: 1, b: 1, a: 0 },
      module: createChipModuleInstance(config)
    }),
    cornerRadius: 0,
    fills: [],
    strokes: []
  }
}
const FIELDS: readonly ModulePropertyField[] = [
  { path: ['label'], kind: 'text', label: 'Label', i18nLabelKey: 'lowcodeModuleFieldChipLabel' },
  {
    path: ['variant'],
    kind: 'select',
    label: 'Appearance',
    options: ['soft', 'outlined', 'filled'],
    i18nLabelKey: 'lowcodeModuleFieldChipVariant'
  },
  {
    path: ['color'],
    kind: 'color',
    label: 'Theme color',
    i18nLabelKey: 'lowcodeModuleFieldChipColor'
  },
  {
    path: ['filledTextColor'],
    kind: 'color',
    label: 'Filled text color',
    i18nLabelKey: 'lowcodeModuleFieldChipFilledTextColor'
  },
  {
    path: ['borderRadius'],
    kind: 'number',
    label: 'Corner radius',
    min: 0,
    max: 32,
    step: 1,
    i18nLabelKey: 'lowcodeModuleFieldChipBorderRadius'
  },
  {
    path: ['fontSize'],
    kind: 'number',
    label: 'Font size',
    min: 10,
    max: 32,
    step: 1,
    i18nLabelKey: 'lowcodeModuleFieldChipFontSize'
  },
  {
    path: ['selectable'],
    kind: 'boolean',
    label: 'Allow selection',
    i18nLabelKey: 'lowcodeModuleFieldChipSelectable'
  },
  {
    path: ['initialSelected'],
    kind: 'boolean',
    label: 'Initially selected',
    i18nLabelKey: 'lowcodeModuleFieldChipInitialSelected'
  },
  {
    path: ['deletable'],
    kind: 'boolean',
    label: 'Allow removal',
    i18nLabelKey: 'lowcodeModuleFieldChipDeletable'
  },
  {
    path: ['deleteLabel'],
    kind: 'text',
    label: 'Remove button label',
    i18nLabelKey: 'lowcodeModuleFieldChipDeleteLabel'
  },
  {
    path: ['removedLabel'],
    kind: 'text',
    label: 'Removal announcement',
    i18nLabelKey: 'lowcodeModuleFieldChipRemovedLabel'
  },
  {
    path: ['disabled'],
    kind: 'boolean',
    label: 'Disabled',
    i18nLabelKey: 'lowcodeModuleFieldChipDisabled'
  }
]
export const CHIP_MODULE_DEFINITION = contract.createContractModuleDefinition(CHIP_CONTRACT, {
  name: 'Chip',
  description: 'Compact status label with optional instance-local selection and removal.',
  i18nNameKey: 'lowcodeModuleChipName',
  i18nDescriptionKey: 'lowcodeModuleChipDescription',
  defaultSize: CHIP_MODULE_DEFAULT_SIZE,
  fields: FIELDS,
  createInstance: createChipModuleInstance,
  createFrameOverrides: createChipModuleFrameOverrides,
  resolve: resolveChipModule
})
export const CHIP_PLUGIN = contract.createSingleModulePlugin(
  CHIP_PLUGIN_ID,
  'OpenPencil Chip',
  CHIP_MODULE_DEFINITION
)
