import * as emptyValues from '@open-pencil/plugin-contracts/adapter-helpers'
import type { ModuleInstanceV1, SceneNode } from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import { TRANSPARENT } from '#core/constants'

import { EMPTY_STATE_FIELDS } from './empty-state/fields'
import * as emptyContract from './module-contract'
import { createModuleFrameOverrides } from './module-frame'
import type { ModuleResolution } from './types'

export {
  EMPTY_STATE_LAYOUT,
  EMPTY_STATE_ILLUSTRATION_PATHS,
  emptyStateGeometry
} from './empty-state/layout'

export const EMPTY_STATE_PLUGIN_ID = 'open-pencil.empty-state'
export const EMPTY_STATE_MODULE_TYPE = 'empty-state'
export const EMPTY_STATE_MODULE_CONFIG_VERSION = 1
export const EMPTY_STATE_MODULE_DEFAULT_SIZE = Object.freeze({ width: 360, height: 240 })

export interface EmptyStateModuleConfigV1 extends JSONObject {
  title: string
  description: string
  illustration: 'box' | 'search' | 'none'
  alignment: 'center' | 'left'
  iconSize: number
  fontSize: number
  gap: number
  padding: number
  borderRadius: number
  backgroundColor: string
  textColor: string
  descriptionColor: string
  illustrationColor: string
}
export type EmptyStateModuleConfig = EmptyStateModuleConfigV1

export const EMPTY_STATE_MODULE_DEFAULT_CONFIG: Readonly<EmptyStateModuleConfigV1> = Object.freeze({
  title: 'Nothing here yet',
  description: 'Add a clear explanation and a useful next step.',
  illustration: 'box',
  alignment: 'center',
  iconSize: 64,
  fontSize: 14,
  gap: 12,
  padding: 24,
  borderRadius: 12,
  backgroundColor: '#FFFFFF',
  textColor: '#172554',
  descriptionColor: '#64748B',
  illustrationColor: '#64748B'
})

const CONFIG_KEYS = new Set(Object.keys(EMPTY_STATE_MODULE_DEFAULT_CONFIG))
const ILLUSTRATIONS = new Set<EmptyStateModuleConfigV1['illustration']>(['box', 'search', 'none'])
const ALIGNMENTS = new Set<EmptyStateModuleConfigV1['alignment']>(['center', 'left'])

function parseConfig(value: unknown) {
  return emptyContract.parseExactModuleConfig(
    value,
    CONFIG_KEYS,
    'empty state config must contain exactly the declared fields',
    (source): EmptyStateModuleConfigV1 => {
      const config: EmptyStateModuleConfigV1 = {
        title: emptyValues.parseBoundedPluginText(source.title, 'empty state title', 1, 160),
        description: emptyValues.parseBoundedPluginText(
          source.description,
          'empty state description',
          0,
          1200
        ),
        illustration: emptyValues.parsePluginStringEnum(
          source.illustration,
          'empty state illustration',
          ILLUSTRATIONS,
          'box, search, or none'
        ),
        alignment: emptyValues.parsePluginStringEnum(
          source.alignment,
          'empty state alignment',
          ALIGNMENTS,
          'center or left'
        ),
        iconSize: emptyValues.parseBoundedPluginNumber(
          source.iconSize,
          'empty state icon size',
          24,
          128
        ),
        fontSize: emptyValues.parseBoundedPluginNumber(
          source.fontSize,
          'empty state font size',
          10,
          24
        ),
        gap: emptyValues.parseBoundedPluginNumber(source.gap, 'empty state gap', 4, 32),
        padding: emptyValues.parseBoundedPluginNumber(source.padding, 'empty state padding', 8, 64),
        borderRadius: emptyValues.parseBoundedPluginNumber(
          source.borderRadius,
          'empty state radius',
          0,
          32
        ),
        backgroundColor: emptyValues.parseCanonicalPluginColor(
          source.backgroundColor,
          'empty state background'
        ),
        textColor: emptyValues.parseCanonicalPluginColor(
          source.textColor,
          'empty state title color'
        ),
        descriptionColor: emptyValues.parseCanonicalPluginColor(
          source.descriptionColor,
          'empty state description color'
        ),
        illustrationColor: emptyValues.parseCanonicalPluginColor(
          source.illustrationColor,
          'empty state illustration color'
        )
      }
      if (!config.title.trim()) throw new TypeError('Empty state needs a readable title')
      emptyValues.assertBoundedPluginConfigBytes(config, 'empty state config', 8192)
      return config
    }
  )
}

const EMPTY_STATE_CONTRACT: emptyContract.ModuleContract<EmptyStateModuleConfigV1> = {
  pluginId: EMPTY_STATE_PLUGIN_ID,
  moduleType: EMPTY_STATE_MODULE_TYPE,
  configVersion: EMPTY_STATE_MODULE_CONFIG_VERSION,
  displayName: 'empty state',
  defaultConfig: EMPTY_STATE_MODULE_DEFAULT_CONFIG,
  parseConfig
}

export function createEmptyStateModuleInstance(config?: unknown): ModuleInstanceV1 {
  return emptyContract.createContractModuleInstance(EMPTY_STATE_CONTRACT, config)
}

export function createEmptyStateModuleFrameOverrides(config?: unknown): Partial<SceneNode> {
  return {
    ...createModuleFrameOverrides({
      name: 'Empty State',
      defaultSize: EMPTY_STATE_MODULE_DEFAULT_SIZE,
      fillColor: TRANSPARENT,
      strokeColor: TRANSPARENT,
      module: createEmptyStateModuleInstance(config)
    }),
    fills: [],
    strokes: [],
    cornerRadius: 0
  }
}

export function resolveEmptyStateModule(
  value: unknown
): ModuleResolution<EmptyStateModuleConfigV1> {
  return emptyContract.resolveContractModule(value, EMPTY_STATE_CONTRACT)
}

export const EMPTY_STATE_MODULE_DEFINITION = emptyContract.createContractModuleDefinition(
  EMPTY_STATE_CONTRACT,
  {
    name: 'Empty State',
    description:
      'Authored empty-state copy with an optional built-in illustration; no data detection or actions.',
    i18nNameKey: 'lowcodeModuleEmptyStateName',
    i18nDescriptionKey: 'lowcodeModuleEmptyStateDescription',
    defaultSize: EMPTY_STATE_MODULE_DEFAULT_SIZE,
    fields: EMPTY_STATE_FIELDS,
    createInstance: createEmptyStateModuleInstance,
    createFrameOverrides: createEmptyStateModuleFrameOverrides,
    resolve: resolveEmptyStateModule
  }
)
export const EMPTY_STATE_PLUGIN = emptyContract.createSingleModulePlugin(
  EMPTY_STATE_PLUGIN_ID,
  'Empty State',
  EMPTY_STATE_MODULE_DEFINITION
)
