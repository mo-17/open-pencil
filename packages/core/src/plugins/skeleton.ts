import * as values from '@open-pencil/plugin-contracts/adapter-helpers'
import type { ModuleInstanceV1, SceneNode } from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import { TRANSPARENT } from '#core/constants'

import * as contract from './module-contract'
import { createModuleFrameOverrides } from './module-frame'
import { SKELETON_FIELDS } from './skeleton/fields'
import type { ModuleResolution } from './types'

export const SKELETON_PLUGIN_ID = 'open-pencil.skeleton'
export const SKELETON_MODULE_TYPE = 'skeleton'
export const SKELETON_MODULE_CONFIG_VERSION = 1
export const SKELETON_MODULE_DEFAULT_SIZE = Object.freeze({ width: 320, height: 128 })
export interface SkeletonModuleConfigV1 extends JSONObject {
  variant: 'text' | 'rectangle' | 'circle'
  rows: number
  lineHeight: number
  gap: number
  lastLineWidth: number
  color: string
  backgroundColor: string
  textColor: string
  borderRadius: number
  animation: 'none' | 'pulse'
  label: string
  showLabel: boolean
  fontSize: number
}
export type SkeletonModuleConfig = SkeletonModuleConfigV1
export const SKELETON_MODULE_DEFAULT_CONFIG: Readonly<SkeletonModuleConfigV1> = Object.freeze({
  variant: 'text',
  rows: 3,
  lineHeight: 16,
  gap: 12,
  lastLineWidth: 60,
  color: '#E2E8F0',
  backgroundColor: '#FFFFFF',
  textColor: '#64748B',
  borderRadius: 6,
  animation: 'pulse',
  label: 'Loading content',
  showLabel: false,
  fontSize: 14
})
const KEYS = new Set(Object.keys(SKELETON_MODULE_DEFAULT_CONFIG))
const CONTRACT: contract.ModuleContract<SkeletonModuleConfigV1> = {
  pluginId: SKELETON_PLUGIN_ID,
  moduleType: SKELETON_MODULE_TYPE,
  configVersion: SKELETON_MODULE_CONFIG_VERSION,
  displayName: 'skeleton',
  defaultConfig: SKELETON_MODULE_DEFAULT_CONFIG,
  parseConfig: (value) =>
    contract.parseExactModuleConfig(
      value,
      KEYS,
      'skeleton config must contain exactly the declared fields',
      (source): SkeletonModuleConfigV1 => {
        const rows = values.parseBoundedPluginNumber(source.rows, 'skeleton rows', 1, 12)
        if (!Number.isInteger(rows)) throw new TypeError('skeleton rows must be a whole number')
        const config: SkeletonModuleConfigV1 = {
          variant: values.parsePluginStringEnum(
            source.variant,
            'skeleton variant',
            new Set(['text', 'rectangle', 'circle'] as const),
            'text, rectangle, or circle'
          ),
          rows,
          lineHeight: values.parseBoundedPluginNumber(
            source.lineHeight,
            'skeleton lineHeight',
            4,
            48
          ),
          gap: values.parseBoundedPluginNumber(source.gap, 'skeleton gap', 0, 32),
          lastLineWidth: values.parseBoundedPluginNumber(
            source.lastLineWidth,
            'skeleton lastLineWidth',
            10,
            100
          ),
          color: values.parseCanonicalPluginColor(source.color, 'skeleton color'),
          backgroundColor: values.parseCanonicalPluginColor(
            source.backgroundColor,
            'skeleton backgroundColor'
          ),
          textColor: values.parseCanonicalPluginColor(source.textColor, 'skeleton textColor'),
          borderRadius: values.parseBoundedPluginNumber(
            source.borderRadius,
            'skeleton borderRadius',
            0,
            48
          ),
          animation: values.parsePluginStringEnum(
            source.animation,
            'skeleton animation',
            new Set(['none', 'pulse'] as const),
            'none or pulse'
          ),
          label: values.parseBoundedPluginText(source.label, 'skeleton label', 1, 160),
          showLabel: values.parsePluginBoolean(source.showLabel, 'skeleton showLabel'),
          fontSize: values.parseBoundedPluginNumber(source.fontSize, 'skeleton fontSize', 10, 32)
        }
        values.assertBoundedPluginConfigBytes(config, 'skeleton config', 4096)
        return config
      }
    )
}
export function createSkeletonModuleInstance(config?: unknown): ModuleInstanceV1 {
  return contract.createContractModuleInstance(CONTRACT, config)
}
export function resolveSkeletonModule(value: unknown): ModuleResolution<SkeletonModuleConfigV1> {
  return contract.resolveContractModule(value, CONTRACT)
}
export function createSkeletonModuleFrameOverrides(config?: unknown): Partial<SceneNode> {
  return {
    ...createModuleFrameOverrides({
      name: 'Skeleton',
      defaultSize: SKELETON_MODULE_DEFAULT_SIZE,
      fillColor: TRANSPARENT,
      strokeColor: TRANSPARENT,
      module: createSkeletonModuleInstance(config)
    }),
    fills: [],
    strokes: [],
    cornerRadius: 0
  }
}
export const SKELETON_MODULE_DEFINITION = contract.createContractModuleDefinition(CONTRACT, {
  name: 'Skeleton',
  description: 'Authored loading placeholders; visibility is controlled by the application.',
  i18nNameKey: 'lowcodeModuleSkeletonName',
  i18nDescriptionKey: 'lowcodeModuleSkeletonDescription',
  defaultSize: SKELETON_MODULE_DEFAULT_SIZE,
  fields: SKELETON_FIELDS,
  createInstance: createSkeletonModuleInstance,
  createFrameOverrides: createSkeletonModuleFrameOverrides,
  resolve: resolveSkeletonModule
})
export const SKELETON_PLUGIN = contract.createSingleModulePlugin(
  SKELETON_PLUGIN_ID,
  'OpenPencil Skeleton',
  SKELETON_MODULE_DEFINITION
)
