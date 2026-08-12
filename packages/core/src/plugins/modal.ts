import type { ModuleInstanceV1, SceneNode } from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import * as moduleContract from './module-contract'
import { createModuleFrameOverrides } from './module-frame'
import {
  assertBoundedPluginConfigBytes,
  parseBoundedPluginNumber,
  parseBoundedPluginText,
  parseCanonicalPluginColor,
  parsePluginBoolean,
  parsePluginStringEnum
} from './parse-helpers'
import type { ModulePropertyField, ModuleResolution } from './types'

export const MODAL_PLUGIN_ID = 'open-pencil.modal'
export const MODAL_MODULE_TYPE = 'modal'
export const MODAL_MODULE_CONFIG_VERSION = 1
export const MODAL_MODULE_DEFAULT_SIZE = Object.freeze({ width: 180, height: 48 })
export const MODAL_MODULE_LIMITS = Object.freeze({
  triggerLabel: 80,
  title: 120,
  content: 4_000,
  actionLabel: 40,
  panelWidthMin: 280,
  panelWidthMax: 720,
  overlayOpacityMin: 0,
  overlayOpacityMax: 0.9,
  configBytes: 32_768
})

export type ModalFooterAlignV1 = 'left' | 'center' | 'right'

export interface ModalModuleConfigV1 extends JSONObject {
  triggerLabel: string
  showTriggerIcon: boolean
  showTriggerLabel: boolean
  title: string
  content: string
  showCloseButton: boolean
  closeOnBackdrop: boolean
  closeOnEscape: boolean
  showCancelButton: boolean
  cancelLabel: string
  showConfirmButton: boolean
  confirmLabel: string
  panelWidth: number
  footerAlign: ModalFooterAlignV1
  panelBackground: string
  textColor: string
  accentColor: string
  overlayOpacity: number
}

export type ModalModuleConfig = ModalModuleConfigV1

export const MODAL_MODULE_DEFAULT_CONFIG: Readonly<ModalModuleConfigV1> = Object.freeze({
  triggerLabel: 'Open modal',
  showTriggerIcon: true,
  showTriggerLabel: true,
  title: 'Modal title',
  content: 'Add supporting content for this dialog.',
  showCloseButton: true,
  closeOnBackdrop: true,
  closeOnEscape: true,
  showCancelButton: true,
  cancelLabel: 'Cancel',
  showConfirmButton: true,
  confirmLabel: 'Confirm',
  panelWidth: 520,
  footerAlign: 'right',
  panelBackground: '#FFFFFF',
  textColor: '#111827',
  accentColor: '#2563EB',
  overlayOpacity: 0.45
})

const CONFIG_KEYS = new Set([
  'triggerLabel',
  'showTriggerIcon',
  'showTriggerLabel',
  'title',
  'content',
  'showCloseButton',
  'closeOnBackdrop',
  'closeOnEscape',
  'showCancelButton',
  'cancelLabel',
  'showConfirmButton',
  'confirmLabel',
  'panelWidth',
  'footerAlign',
  'panelBackground',
  'textColor',
  'accentColor',
  'overlayOpacity'
])
const FOOTER_ALIGNMENTS = new Set<ModalFooterAlignV1>(['left', 'center', 'right'])

function parseModalConfig(value: unknown) {
  return moduleContract.parseExactModuleConfig(
    value,
    CONFIG_KEYS,
    'modal config must contain exactly triggerLabel, showTriggerIcon, showTriggerLabel, title, content, showCloseButton, closeOnBackdrop, closeOnEscape, showCancelButton, cancelLabel, showConfirmButton, confirmLabel, panelWidth, footerAlign, panelBackground, textColor, accentColor, and overlayOpacity',
    (source): ModalModuleConfigV1 => {
      const config: ModalModuleConfigV1 = {
        triggerLabel: parseBoundedPluginText(
          source.triggerLabel,
          'modal config triggerLabel',
          1,
          MODAL_MODULE_LIMITS.triggerLabel
        ),
        showTriggerIcon: parsePluginBoolean(source.showTriggerIcon, 'modal config showTriggerIcon'),
        showTriggerLabel: parsePluginBoolean(
          source.showTriggerLabel,
          'modal config showTriggerLabel'
        ),
        title: parseBoundedPluginText(
          source.title,
          'modal config title',
          0,
          MODAL_MODULE_LIMITS.title
        ),
        content: parseBoundedPluginText(
          source.content,
          'modal config content',
          0,
          MODAL_MODULE_LIMITS.content
        ),
        showCloseButton: parsePluginBoolean(source.showCloseButton, 'modal config showCloseButton'),
        closeOnBackdrop: parsePluginBoolean(source.closeOnBackdrop, 'modal config closeOnBackdrop'),
        closeOnEscape: parsePluginBoolean(source.closeOnEscape, 'modal config closeOnEscape'),
        showCancelButton: parsePluginBoolean(
          source.showCancelButton,
          'modal config showCancelButton'
        ),
        cancelLabel: parseBoundedPluginText(
          source.cancelLabel,
          'modal config cancelLabel',
          1,
          MODAL_MODULE_LIMITS.actionLabel
        ),
        showConfirmButton: parsePluginBoolean(
          source.showConfirmButton,
          'modal config showConfirmButton'
        ),
        confirmLabel: parseBoundedPluginText(
          source.confirmLabel,
          'modal config confirmLabel',
          1,
          MODAL_MODULE_LIMITS.actionLabel
        ),
        panelWidth: parseBoundedPluginNumber(
          source.panelWidth,
          'modal config panelWidth',
          MODAL_MODULE_LIMITS.panelWidthMin,
          MODAL_MODULE_LIMITS.panelWidthMax
        ),
        footerAlign: parsePluginStringEnum(
          source.footerAlign,
          'modal config footerAlign',
          FOOTER_ALIGNMENTS,
          'left, center, or right'
        ),
        panelBackground: parseCanonicalPluginColor(
          source.panelBackground,
          'modal config panelBackground'
        ),
        textColor: parseCanonicalPluginColor(source.textColor, 'modal config textColor'),
        accentColor: parseCanonicalPluginColor(source.accentColor, 'modal config accentColor'),
        overlayOpacity: parseBoundedPluginNumber(
          source.overlayOpacity,
          'modal config overlayOpacity',
          MODAL_MODULE_LIMITS.overlayOpacityMin,
          MODAL_MODULE_LIMITS.overlayOpacityMax
        )
      }
      if (
        !config.showCloseButton &&
        !config.closeOnBackdrop &&
        !config.closeOnEscape &&
        !config.showCancelButton &&
        !config.showConfirmButton
      ) {
        throw new TypeError('modal config must provide at least one dismissal control')
      }
      assertBoundedPluginConfigBytes(config, 'modal config', MODAL_MODULE_LIMITS.configBytes)
      return config
    }
  )
}

const MODAL_MODULE_CONTRACT: moduleContract.ModuleContract<ModalModuleConfigV1> = {
  pluginId: MODAL_PLUGIN_ID,
  moduleType: MODAL_MODULE_TYPE,
  configVersion: MODAL_MODULE_CONFIG_VERSION,
  displayName: 'modal',
  defaultConfig: MODAL_MODULE_DEFAULT_CONFIG,
  parseConfig: parseModalConfig
}

export function createModalModuleInstance(config?: unknown): ModuleInstanceV1 {
  return moduleContract.createContractModuleInstance(MODAL_MODULE_CONTRACT, config)
}

export function createModalModuleFrameOverrides(config?: unknown): Partial<SceneNode> {
  return createModuleFrameOverrides({
    name: 'Modal',
    defaultSize: MODAL_MODULE_DEFAULT_SIZE,
    fillColor: { r: 0.15, g: 0.39, b: 0.92, a: 1 },
    strokeColor: { r: 0.11, g: 0.31, b: 0.85, a: 1 },
    module: createModalModuleInstance(config)
  })
}

export function resolveModalModule(value: unknown): ModuleResolution<ModalModuleConfigV1> {
  return moduleContract.resolveContractModule(value, MODAL_MODULE_CONTRACT)
}

const MODAL_MODULE_FIELDS: readonly ModulePropertyField[] = Object.freeze([
  {
    path: ['triggerLabel'],
    kind: 'text',
    label: 'Trigger label',
    i18nLabelKey: 'lowcodeModuleFieldModalTriggerLabel'
  },
  {
    path: ['showTriggerIcon'],
    kind: 'boolean',
    label: 'Show trigger icon',
    i18nLabelKey: 'lowcodeModuleFieldModalShowTriggerIcon'
  },
  {
    path: ['showTriggerLabel'],
    kind: 'boolean',
    label: 'Show trigger label',
    i18nLabelKey: 'lowcodeModuleFieldModalShowTriggerLabel'
  },
  {
    path: ['title'],
    kind: 'text',
    label: 'Title',
    i18nLabelKey: 'lowcodeModuleFieldModalTitle'
  },
  {
    path: ['content'],
    kind: 'text',
    label: 'Content',
    i18nLabelKey: 'lowcodeModuleFieldModalContent'
  },
  {
    path: ['showCloseButton'],
    kind: 'boolean',
    label: 'Show close button',
    i18nLabelKey: 'lowcodeModuleFieldModalShowCloseButton'
  },
  {
    path: ['closeOnBackdrop'],
    kind: 'boolean',
    label: 'Close on backdrop',
    i18nLabelKey: 'lowcodeModuleFieldModalCloseOnBackdrop'
  },
  {
    path: ['closeOnEscape'],
    kind: 'boolean',
    label: 'Close on Escape',
    i18nLabelKey: 'lowcodeModuleFieldModalCloseOnEscape'
  },
  {
    path: ['showCancelButton'],
    kind: 'boolean',
    label: 'Show cancel button',
    i18nLabelKey: 'lowcodeModuleFieldModalShowCancelButton'
  },
  {
    path: ['cancelLabel'],
    kind: 'text',
    label: 'Cancel label',
    i18nLabelKey: 'lowcodeModuleFieldModalCancelLabel'
  },
  {
    path: ['showConfirmButton'],
    kind: 'boolean',
    label: 'Show confirm button',
    i18nLabelKey: 'lowcodeModuleFieldModalShowConfirmButton'
  },
  {
    path: ['confirmLabel'],
    kind: 'text',
    label: 'Confirm label',
    i18nLabelKey: 'lowcodeModuleFieldModalConfirmLabel'
  },
  {
    path: ['panelWidth'],
    kind: 'number',
    label: 'Panel width',
    i18nLabelKey: 'lowcodeModuleFieldModalPanelWidth',
    min: MODAL_MODULE_LIMITS.panelWidthMin,
    max: MODAL_MODULE_LIMITS.panelWidthMax,
    step: 1
  },
  {
    path: ['footerAlign'],
    kind: 'select',
    label: 'Footer alignment',
    i18nLabelKey: 'lowcodeModuleFieldModalFooterAlign',
    options: ['left', 'center', 'right']
  },
  {
    path: ['panelBackground'],
    kind: 'color',
    label: 'Panel background',
    i18nLabelKey: 'lowcodeModuleFieldModalPanelBackground'
  },
  {
    path: ['textColor'],
    kind: 'color',
    label: 'Text color',
    i18nLabelKey: 'lowcodeModuleFieldModalTextColor'
  },
  {
    path: ['accentColor'],
    kind: 'color',
    label: 'Accent color',
    i18nLabelKey: 'lowcodeModuleFieldModalAccentColor'
  },
  {
    path: ['overlayOpacity'],
    kind: 'number',
    label: 'Overlay opacity',
    i18nLabelKey: 'lowcodeModuleFieldModalOverlayOpacity',
    min: MODAL_MODULE_LIMITS.overlayOpacityMin,
    max: MODAL_MODULE_LIMITS.overlayOpacityMax,
    step: 0.05
  }
])

export const MODAL_MODULE_DEFINITION = moduleContract.createContractModuleDefinition(
  MODAL_MODULE_CONTRACT,
  {
    name: 'Modal',
    description: 'An accessible bounded modal dialog with configurable dismissal and actions.',
    i18nNameKey: 'lowcodeModuleModalName',
    i18nDescriptionKey: 'lowcodeModuleModalDescription',
    defaultSize: MODAL_MODULE_DEFAULT_SIZE,
    fields: MODAL_MODULE_FIELDS,
    createInstance: createModalModuleInstance,
    createFrameOverrides: createModalModuleFrameOverrides,
    resolve: resolveModalModule
  }
)

export const MODAL_PLUGIN = moduleContract.createSingleModulePlugin(
  MODAL_PLUGIN_ID,
  'OpenPencil Modal',
  MODAL_MODULE_DEFINITION
)
