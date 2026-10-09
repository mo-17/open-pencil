import {
  isPlainJSONObject,
  validateModuleInstance,
  type ModuleInstanceV1,
  type SceneNode
} from '@open-pencil/scene-graph'

import { createModuleFrameOverrides } from '#core/plugins/module-frame'
import type { ModuleDefinition, ModulePropertyField, ModuleResolution } from '#core/plugins/types'

import { getEffectPickCatalogEntry } from './catalog'
import { createEffectPickConfig, parseEffectPickConfig } from './config'
import type { EffectPickConfigV1 } from './types'

export const EFFECT_PICK_PLUGIN_ID = 'open-pencil.effect-pick'
export const EFFECT_PICK_MODULE_TYPE = 'effect-pick'
export const EFFECT_PICK_MODULE_CONFIG_VERSION = 1
export const EFFECT_PICK_MODULE_DEFAULT_CONFIG = Object.freeze(createEffectPickConfig())
export const EFFECT_PICK_MODULE_DEFAULT_SIZE = Object.freeze({ width: 320, height: 120 })

export function createEffectPickModuleInstance(config?: unknown): ModuleInstanceV1 {
  if (config !== undefined && !isPlainJSONObject(config))
    throw new TypeError('EffectPick config must be a plain JSON object')
  const effectId =
    isPlainJSONObject(config) && typeof config.effectId === 'string'
      ? config.effectId
      : 'diagonal-fill'
  return {
    version: 1,
    pluginId: EFFECT_PICK_PLUGIN_ID,
    moduleType: EFFECT_PICK_MODULE_TYPE,
    configVersion: EFFECT_PICK_MODULE_CONFIG_VERSION,
    config: createEffectPickConfig(effectId, config)
  }
}

export function createEffectPickModuleFrameOverrides(config?: unknown): Partial<SceneNode> {
  const module = createEffectPickModuleInstance(config)
  const entry = getEffectPickCatalogEntry(String(module.config.effectId))
  return {
    ...createModuleFrameOverrides({
      name: `EffectPick · ${entry?.title ?? 'Effect'} · Static`,
      defaultSize: entry?.defaultSize ?? EFFECT_PICK_MODULE_DEFAULT_SIZE,
      fillColor: { r: 0.06, g: 0.09, b: 0.13, a: 1 },
      strokeColor: { r: 0.33, g: 0.56, b: 0.51, a: 1 },
      module
    }),
    fills: [],
    strokes: []
  }
}

export function resolveEffectPickModule(value: unknown): ModuleResolution<EffectPickConfigV1> {
  if (value === null || value === undefined) return null
  const instance = validateModuleInstance(value)
  if (!instance.ok) return { ok: false, reason: instance.reason }
  if (
    instance.value.pluginId !== EFFECT_PICK_PLUGIN_ID ||
    instance.value.moduleType !== EFFECT_PICK_MODULE_TYPE
  )
    return null
  if (instance.value.configVersion !== EFFECT_PICK_MODULE_CONFIG_VERSION) {
    return {
      ok: false,
      reason: `Unsupported EffectPick config version ${instance.value.configVersion}`
    }
  }
  const parsed = parseEffectPickConfig(instance.value.config)
  return parsed.ok
    ? { ok: true, instance: { ...instance.value, config: parsed.config }, config: parsed.config }
    : parsed
}

const fields: readonly ModulePropertyField[] = Object.freeze([
  { path: ['text'], kind: 'text', label: 'Text', i18nLabelKey: 'effectPickFieldText' },
  { path: ['color'], kind: 'text', label: 'Color', i18nLabelKey: 'effectPickFieldColor' },
  {
    path: ['secondaryColor'],
    kind: 'text',
    label: 'Secondary color',
    i18nLabelKey: 'effectPickFieldSecondaryColor'
  },
  {
    path: ['speed'],
    kind: 'number',
    label: 'Speed',
    i18nLabelKey: 'effectPickFieldSpeed',
    min: 0.1,
    max: 4,
    step: 0.1
  }
])

export const EFFECT_PICK_MODULE_DEFINITION: ModuleDefinition<EffectPickConfigV1> = Object.freeze({
  pluginId: EFFECT_PICK_PLUGIN_ID,
  moduleType: EFFECT_PICK_MODULE_TYPE,
  name: 'EffectPick',
  description:
    'A reviewed local CSS/SVG effect with a static canvas placeholder and isolated playback.',
  i18nNameKey: 'effectPickModuleName',
  i18nDescriptionKey: 'effectPickModuleDescription',
  configVersion: EFFECT_PICK_MODULE_CONFIG_VERSION,
  defaultSize: EFFECT_PICK_MODULE_DEFAULT_SIZE,
  defaultConfig: structuredClone(EFFECT_PICK_MODULE_DEFAULT_CONFIG),
  fields,
  createInstance: createEffectPickModuleInstance,
  createFrameOverrides: createEffectPickModuleFrameOverrides,
  resolve: resolveEffectPickModule
})

export const EFFECT_PICK_MODULE = EFFECT_PICK_MODULE_DEFINITION
export const EFFECT_PICK_PLUGIN = Object.freeze({
  id: EFFECT_PICK_PLUGIN_ID,
  name: 'EffectPick',
  version: '1.0.0',
  modules: Object.freeze([EFFECT_PICK_MODULE_DEFINITION])
})
