import * as values from '@open-pencil/plugin-contracts/adapter-helpers'
import type { ModuleInstanceV1, SceneNode } from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import { TRANSPARENT } from '#core/constants'

import * as contract from './module-contract'
import { createModuleFrameOverrides } from './module-frame'
import type { ModulePropertyField, ModuleResolution } from './types'

export const AVATAR_PLUGIN_ID = 'open-pencil.avatar'
export const AVATAR_MODULE_TYPE = 'avatar'
export const AVATAR_MODULE_CONFIG_VERSION = 1
export const AVATAR_MODULE_DEFAULT_SIZE = Object.freeze({ width: 64, height: 64 })
export interface AvatarModuleConfigV1 extends JSONObject {
  name: string
  fallbackText: string
  shape: 'circle' | 'rounded' | 'square'
  backgroundColor: string
  textColor: string
  borderColor: string
  borderWidth: number
  borderRadius: number
  size: number
  fontSize: number
  imageFit: 'cover' | 'contain'
}
export type AvatarModuleConfig = AvatarModuleConfigV1
export const AVATAR_MODULE_DEFAULT_CONFIG: Readonly<AvatarModuleConfigV1> = Object.freeze({
  name: 'Alex Morgan',
  fallbackText: '',
  shape: 'circle',
  backgroundColor: '#DBEAFE',
  textColor: '#1D4ED8',
  borderColor: '#BFDBFE',
  borderWidth: 0,
  borderRadius: 12,
  size: 64,
  fontSize: 24,
  imageFit: 'cover'
})
const KEYS = new Set(Object.keys(AVATAR_MODULE_DEFAULT_CONFIG))
const CONTRACT: contract.ModuleContract<AvatarModuleConfigV1> = {
  pluginId: AVATAR_PLUGIN_ID,
  moduleType: AVATAR_MODULE_TYPE,
  configVersion: AVATAR_MODULE_CONFIG_VERSION,
  displayName: 'avatar',
  defaultConfig: AVATAR_MODULE_DEFAULT_CONFIG,
  parseConfig: (value) =>
    contract.parseExactModuleConfig(
      value,
      KEYS,
      'avatar config must contain exactly the declared fields',
      (source): AvatarModuleConfigV1 => {
        const result: AvatarModuleConfigV1 = {
          name: values.parseBoundedPluginText(source.name, 'avatar name', 1, 120),
          fallbackText: values.parseBoundedPluginText(
            source.fallbackText,
            'avatar fallbackText',
            0,
            8
          ),
          shape: values.parsePluginStringEnum(
            source.shape,
            'avatar shape',
            new Set(['circle', 'rounded', 'square'] as const),
            'circle, rounded, or square'
          ),
          backgroundColor: values.parseCanonicalPluginColor(
            source.backgroundColor,
            'avatar backgroundColor'
          ),
          textColor: values.parseCanonicalPluginColor(source.textColor, 'avatar textColor'),
          borderColor: values.parseCanonicalPluginColor(source.borderColor, 'avatar borderColor'),
          borderWidth: values.parseBoundedPluginNumber(
            source.borderWidth,
            'avatar borderWidth',
            0,
            8
          ),
          borderRadius: values.parseBoundedPluginNumber(
            source.borderRadius,
            'avatar borderRadius',
            0,
            64
          ),
          size: values.parseBoundedPluginNumber(source.size, 'avatar size', 24, 256),
          fontSize: values.parseBoundedPluginNumber(source.fontSize, 'avatar fontSize', 10, 96),
          imageFit: values.parsePluginStringEnum(
            source.imageFit,
            'avatar imageFit',
            new Set(['cover', 'contain'] as const),
            'cover or contain'
          )
        }
        values.assertBoundedPluginConfigBytes(result, 'avatar config', 4096)
        return result
      }
    )
}
export function createAvatarModuleInstance(config?: unknown): ModuleInstanceV1 {
  return contract.createContractModuleInstance(CONTRACT, config)
}
export function resolveAvatarModule(value: unknown): ModuleResolution<AvatarModuleConfigV1> {
  return contract.resolveContractModule(value, CONTRACT)
}
export function createAvatarModuleFrameOverrides(config?: unknown): Partial<SceneNode> {
  return {
    ...createModuleFrameOverrides({
      name: 'Avatar',
      defaultSize: AVATAR_MODULE_DEFAULT_SIZE,
      fillColor: TRANSPARENT,
      strokeColor: TRANSPARENT,
      module: createAvatarModuleInstance(config)
    }),
    fills: [],
    strokes: [],
    cornerRadius: 0
  }
}
/** Plain Unicode initials; explicit fallback copy takes priority and never contains markup. */
export function avatarFallbackText(
  config: Pick<AvatarModuleConfigV1, 'name' | 'fallbackText'>
): string {
  if (config.fallbackText.trim()) return config.fallbackText.trim()
  const words = config.name.trim().split(/\s+/)
  if (words.length > 1)
    return (Array.from(words[0])[0] + Array.from(words.at(-1) ?? '')[0]).toUpperCase()
  return Array.from(words[0]).slice(0, 2).join('').toUpperCase()
}
const FIELDS: readonly ModulePropertyField[] = [
  { path: ['name'], kind: 'text', label: 'Name', i18nLabelKey: 'lowcodeModuleFieldAvatarName' },
  {
    path: ['fallbackText'],
    kind: 'text',
    label: 'Fallback text',
    i18nLabelKey: 'lowcodeModuleFieldAvatarFallbackText'
  },
  {
    path: ['shape'],
    kind: 'select',
    label: 'Shape',
    options: ['circle', 'rounded', 'square'],
    i18nLabelKey: 'lowcodeModuleFieldAvatarShape'
  },
  {
    path: ['size'],
    kind: 'number',
    label: 'Size',
    min: 24,
    max: 256,
    step: 1,
    i18nLabelKey: 'lowcodeModuleFieldAvatarSize'
  },
  {
    path: ['fontSize'],
    kind: 'number',
    label: 'Font size',
    min: 10,
    max: 96,
    step: 1,
    i18nLabelKey: 'lowcodeModuleFieldAvatarFontSize'
  },
  {
    path: ['backgroundColor'],
    kind: 'color',
    label: 'Background color',
    i18nLabelKey: 'lowcodeModuleFieldAvatarBackgroundColor'
  },
  {
    path: ['textColor'],
    kind: 'color',
    label: 'Text color',
    i18nLabelKey: 'lowcodeModuleFieldAvatarTextColor'
  },
  {
    path: ['borderColor'],
    kind: 'color',
    label: 'Border color',
    i18nLabelKey: 'lowcodeModuleFieldAvatarBorderColor'
  },
  {
    path: ['borderWidth'],
    kind: 'number',
    label: 'Border width',
    min: 0,
    max: 8,
    step: 1,
    i18nLabelKey: 'lowcodeModuleFieldAvatarBorderWidth'
  },
  {
    path: ['borderRadius'],
    kind: 'number',
    label: 'Corner radius',
    min: 0,
    max: 64,
    step: 1,
    i18nLabelKey: 'lowcodeModuleFieldAvatarBorderRadius'
  },
  {
    path: ['imageFit'],
    kind: 'select',
    label: 'Image fit',
    options: ['cover', 'contain'],
    i18nLabelKey: 'lowcodeModuleFieldAvatarImageFit'
  }
]
export const AVATAR_MODULE_DEFINITION = contract.createContractModuleDefinition(CONTRACT, {
  name: 'Avatar',
  description: 'Local image avatar with accessible name and initials fallback.',
  i18nNameKey: 'lowcodeModuleAvatarName',
  i18nDescriptionKey: 'lowcodeModuleAvatarDescription',
  defaultSize: AVATAR_MODULE_DEFAULT_SIZE,
  fields: FIELDS,
  createInstance: createAvatarModuleInstance,
  createFrameOverrides: createAvatarModuleFrameOverrides,
  resolve: resolveAvatarModule
})
export const AVATAR_PLUGIN = contract.createSingleModulePlugin(
  AVATAR_PLUGIN_ID,
  'OpenPencil Avatar',
  AVATAR_MODULE_DEFINITION
)

/** Limit avatar media to offline raster formats shared by browser and CanvasKit decoding. */
export function avatarSupportsImageBytes(bytes: Uint8Array): boolean {
  const starts = (prefix: readonly number[]) =>
    prefix.every((value, index) => bytes[index] === value)
  return (
    starts([0x89, 0x50, 0x4e, 0x47]) ||
    starts([0xff, 0xd8, 0xff]) ||
    (starts([0x52, 0x49, 0x46, 0x46]) &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50)
  )
}
