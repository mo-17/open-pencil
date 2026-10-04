import {
  assertBoundedPluginConfigBytes,
  hasExactPluginKeys,
  parseBoundedPluginInteger,
  parseBoundedPluginText,
  parseCanonicalPluginColor,
  parsePluginBoolean,
  parsePluginStringEnum
} from '@open-pencil/plugin-contracts/adapter-helpers'
import type { ModuleInstanceV1, SceneNode } from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import * as moduleContract from './module-contract'
import { createModuleFrameOverrides } from './module-frame'
import {
  NAVIGATION_APPEARANCE_FIELDS,
  parseNavigationAppearance,
  type NavigationAppearance
} from './navigation/shared'
import type { ModulePropertyField, ModuleResolution } from './types'

export const STEPPER_PLUGIN_ID = 'open-pencil.stepper'
export const STEPPER_MODULE_TYPE = 'stepper'
export const STEPPER_MODULE_CONFIG_VERSION = 1
export const STEPPER_MODULE_DEFAULT_SIZE = Object.freeze({ width: 520, height: 124 })
/** A title and two description lines remain separate from the next vertical step at every size. */
export const STEPPER_LAYOUT = Object.freeze({
  horizontalMinWidth: 80,
  verticalMinHeight: 92,
  titleLineHeight: 1.5,
  descriptionTextScale: 0.9,
  descriptionLineHeight: 1.5,
  descriptionLines: 2,
  verticalGap: 12
})
export const STEPPER_MODULE_LIMITS = Object.freeze({
  itemsMin: 1,
  itemsMax: 12,
  title: 120,
  description: 240,
  configBytes: 16_384
})
export interface StepperItemV1 extends JSONObject {
  title: string
  description: string
  status: 'auto' | 'completed' | 'error'
  disabled: boolean
}
export interface StepperModuleConfigV1 extends NavigationAppearance {
  items: StepperItemV1[]
  currentIndex: number
  orientation: 'horizontal' | 'vertical'
  allowStepClick: boolean
  showNumbers: boolean
  errorColor: string
}
export type StepperModuleConfig = StepperModuleConfigV1

/** Project a current step without clamping, repairing state, or entering disabled steps. */
export function stepperCurrentIndex(
  config: StepperModuleConfigV1,
  value: unknown,
  bound: boolean
): number | null {
  const index = bound ? value : config.currentIndex
  return typeof index === 'number' &&
    Number.isInteger(index) &&
    index >= 0 &&
    index < config.items.length &&
    !config.items[index]?.disabled
    ? index
    : null
}

const items: StepperItemV1[] = [
  { title: 'Details', description: 'Add your information', status: 'auto', disabled: false },
  { title: 'Review', description: 'Check the details', status: 'auto', disabled: false },
  { title: 'Complete', description: 'Finish the process', status: 'auto', disabled: false }
]
items.forEach(Object.freeze)
Object.freeze(items)
export const STEPPER_MODULE_DEFAULT_CONFIG: Readonly<StepperModuleConfigV1> = Object.freeze({
  label: 'Progress',
  items,
  currentIndex: 1,
  orientation: 'horizontal',
  allowStepClick: false,
  showNumbers: true,
  backgroundColor: '#FFFFFF',
  textColor: '#172B4D',
  accentColor: '#2563EB',
  errorColor: '#DC2626',
  fontSize: 14
})

const ITEM_KEYS = new Set(['title', 'description', 'status', 'disabled'])
const CONFIG_KEYS = new Set(Object.keys(STEPPER_MODULE_DEFAULT_CONFIG))
function parseStepperConfig(value: unknown) {
  return moduleContract.parseExactModuleConfig(
    value,
    CONFIG_KEYS,
    'stepper config must contain exactly its supported fields',
    (source) => {
      const parsedItems = moduleContract.parseBoundedModuleObjectArray(
        source.items,
        1,
        12,
        'stepper items must contain 1 to 12 steps',
        (index) => `stepper items[${index}] must be a plain object`,
        (entry) => {
          if (!hasExactPluginKeys(entry, ITEM_KEYS))
            throw new TypeError(
              'stepper item must contain title, description, status, and disabled'
            )
          return {
            title: parseBoundedPluginText(entry.title, 'step title', 1, 120),
            description: parseBoundedPluginText(entry.description, 'step description', 0, 240),
            status: parsePluginStringEnum(
              entry.status,
              'step status',
              new Set(['auto', 'completed', 'error'] as const),
              'auto, completed, or error'
            ),
            disabled: parsePluginBoolean(entry.disabled, 'step disabled')
          }
        }
      )
      const config: StepperModuleConfigV1 = {
        ...parseNavigationAppearance(source),
        items: parsedItems,
        currentIndex: parseBoundedPluginInteger(
          source.currentIndex,
          'stepper currentIndex',
          0,
          parsedItems.length - 1
        ),
        orientation: parsePluginStringEnum(
          source.orientation,
          'stepper orientation',
          new Set(['horizontal', 'vertical'] as const),
          'horizontal or vertical'
        ),
        allowStepClick: parsePluginBoolean(source.allowStepClick, 'stepper allowStepClick'),
        showNumbers: parsePluginBoolean(source.showNumbers, 'stepper showNumbers'),
        errorColor: parseCanonicalPluginColor(source.errorColor, 'stepper errorColor')
      }
      assertBoundedPluginConfigBytes(config, 'stepper config', STEPPER_MODULE_LIMITS.configBytes)
      return config
    }
  )
}
const CONTRACT: moduleContract.ModuleContract<StepperModuleConfigV1> = {
  pluginId: STEPPER_PLUGIN_ID,
  moduleType: STEPPER_MODULE_TYPE,
  configVersion: STEPPER_MODULE_CONFIG_VERSION,
  displayName: 'stepper',
  defaultConfig: STEPPER_MODULE_DEFAULT_CONFIG,
  parseConfig: parseStepperConfig
}
export function createStepperModuleInstance(config?: unknown): ModuleInstanceV1 {
  return moduleContract.createContractModuleInstance(CONTRACT, config)
}
export function resolveStepperModule(value: unknown): ModuleResolution<StepperModuleConfigV1> {
  return moduleContract.resolveContractModule(value, CONTRACT)
}
export function createStepperModuleFrameOverrides(config?: unknown): Partial<SceneNode> {
  return createModuleFrameOverrides({
    name: 'Stepper',
    defaultSize: STEPPER_MODULE_DEFAULT_SIZE,
    fillColor: { r: 1, g: 1, b: 1, a: 1 },
    strokeColor: { r: 0.82, g: 0.84, b: 0.88, a: 0 },
    module: createStepperModuleInstance(config)
  })
}
const FIELDS: readonly ModulePropertyField[] = Object.freeze([
  { path: ['items'], kind: 'json', label: 'Steps', i18nLabelKey: 'lowcodeModuleFieldStepperItems' },
  {
    path: ['currentIndex'],
    kind: 'number',
    label: 'Current step (from 0)',
    min: 0,
    max: 11,
    step: 1,
    i18nLabelKey: 'lowcodeModuleFieldStepperCurrentIndex'
  },
  {
    path: ['orientation'],
    kind: 'select',
    label: 'Orientation',
    options: ['horizontal', 'vertical'],
    i18nLabelKey: 'lowcodeModuleFieldStepperOrientation'
  },
  {
    path: ['allowStepClick'],
    kind: 'boolean',
    label: 'Allow step clicks',
    i18nLabelKey: 'lowcodeModuleFieldStepperAllowStepClick'
  },
  {
    path: ['showNumbers'],
    kind: 'boolean',
    label: 'Show step numbers',
    i18nLabelKey: 'lowcodeModuleFieldStepperShowNumbers'
  },
  {
    path: ['errorColor'],
    kind: 'color',
    label: 'Error color',
    i18nLabelKey: 'lowcodeModuleFieldStepperErrorColor'
  },
  ...NAVIGATION_APPEARANCE_FIELDS
])
export const STEPPER_MODULE_DEFINITION = moduleContract.createContractModuleDefinition(CONTRACT, {
  name: 'Stepper',
  description:
    'Horizontal or vertical steps with optional local selection, completion, and error states.',
  i18nNameKey: 'lowcodeModuleStepperName',
  i18nDescriptionKey: 'lowcodeModuleStepperDescription',
  defaultSize: STEPPER_MODULE_DEFAULT_SIZE,
  fields: FIELDS,
  createInstance: createStepperModuleInstance,
  createFrameOverrides: createStepperModuleFrameOverrides,
  resolve: resolveStepperModule
})
export const STEPPER_PLUGIN = moduleContract.createSingleModulePlugin(
  STEPPER_PLUGIN_ID,
  'OpenPencil Stepper',
  STEPPER_MODULE_DEFINITION
)
