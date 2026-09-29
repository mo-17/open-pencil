import {
  parseBoundedPluginInteger,
  parseBoundedPluginText,
  parseCanonicalPluginColor
} from '@open-pencil/plugin-contracts/adapter-helpers'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import type { ModulePropertyField } from '#core/plugins/types'

export interface NavigationAppearance extends JSONObject {
  label: string
  backgroundColor: string
  textColor: string
  accentColor: string
  fontSize: number
}

export function parseNavigationAppearance(
  source: Readonly<Record<string, unknown>>
): NavigationAppearance {
  return {
    label: parseBoundedPluginText(source.label, 'navigation label', 1, 120),
    backgroundColor: parseCanonicalPluginColor(source.backgroundColor, 'navigation background'),
    textColor: parseCanonicalPluginColor(source.textColor, 'navigation text'),
    accentColor: parseCanonicalPluginColor(source.accentColor, 'navigation accent'),
    fontSize: parseBoundedPluginInteger(source.fontSize, 'navigation fontSize', 10, 32)
  }
}

export const NAVIGATION_APPEARANCE_FIELDS: readonly ModulePropertyField[] = Object.freeze([
  {
    path: ['label'],
    kind: 'text',
    label: 'Accessible label',
    i18nLabelKey: 'lowcodeModuleFieldNavigationLabel'
  },
  {
    path: ['backgroundColor'],
    kind: 'color',
    label: 'Background',
    i18nLabelKey: 'lowcodeModuleFieldNavigationBackground'
  },
  {
    path: ['textColor'],
    kind: 'color',
    label: 'Text color',
    i18nLabelKey: 'lowcodeModuleFieldNavigationTextColor'
  },
  {
    path: ['accentColor'],
    kind: 'color',
    label: 'Accent color',
    i18nLabelKey: 'lowcodeModuleFieldNavigationAccentColor'
  },
  {
    path: ['fontSize'],
    kind: 'number',
    label: 'Font size',
    min: 10,
    max: 32,
    step: 1,
    i18nLabelKey: 'lowcodeModuleFieldNavigationFontSize'
  }
])
