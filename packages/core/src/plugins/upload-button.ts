import type { ModuleInstanceV1, SceneNode } from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import * as moduleContract from './module-contract'
import { createModuleFrameOverrides } from './module-frame'
import {
  assertBoundedPluginConfigBytes,
  hasDensePluginArrayKeys,
  parseBoundedPluginInteger,
  parseBoundedPluginText,
  parseCanonicalPluginColor,
  parsePluginBoolean
} from './parse-helpers'
import type { ModulePropertyField, ModuleResolution } from './types'

export const UPLOAD_BUTTON_PLUGIN_ID = 'open-pencil.upload-button'
export const UPLOAD_BUTTON_MODULE_TYPE = 'upload-button'
export const UPLOAD_BUTTON_MODULE_CONFIG_VERSION = 1
export const UPLOAD_BUTTON_MODULE_DEFAULT_SIZE = Object.freeze({ width: 200, height: 48 })
export const UPLOAD_BUTTON_MODULE_LIMITS = Object.freeze({
  triggerLabel: 80,
  acceptMax: 20,
  acceptToken: 127,
  maxFilesMin: 1,
  maxFilesMax: 100,
  maxFileBytesMin: 1,
  maxFileBytesMax: 2_147_483_648,
  helperText: 160,
  configBytes: 8_192
})

export interface UploadButtonModuleConfigV1 extends JSONObject {
  triggerLabel: string
  showTriggerIcon: boolean
  showTriggerLabel: boolean
  accept: string[]
  multiple: boolean
  maxFiles: number
  maxFileBytes: number
  allowDrop: boolean
  showFileList: boolean
  helperText: string
  buttonBackground: string
  buttonTextColor: string
  accentColor: string
  errorColor: string
}

export type UploadButtonModuleConfig = UploadButtonModuleConfigV1

const DEFAULT_ACCEPT: string[] = []
Object.freeze(DEFAULT_ACCEPT)

export const UPLOAD_BUTTON_MODULE_DEFAULT_CONFIG: Readonly<UploadButtonModuleConfigV1> =
  Object.freeze({
    triggerLabel: 'Choose file',
    showTriggerIcon: true,
    showTriggerLabel: true,
    accept: DEFAULT_ACCEPT,
    multiple: false,
    maxFiles: 1,
    maxFileBytes: 10_485_760,
    allowDrop: true,
    showFileList: true,
    helperText: '',
    buttonBackground: '#2563EB',
    buttonTextColor: '#FFFFFF',
    accentColor: '#2563EB',
    errorColor: '#DC2626'
  })

const CONFIG_KEYS = new Set([
  'triggerLabel',
  'showTriggerIcon',
  'showTriggerLabel',
  'accept',
  'multiple',
  'maxFiles',
  'maxFileBytes',
  'allowDrop',
  'showFileList',
  'helperText',
  'buttonBackground',
  'buttonTextColor',
  'accentColor',
  'errorColor'
])
const ACCEPT_EXTENSION = /^\.[a-z0-9][a-z0-9._+-]*$/i
const ACCEPT_MIME = /^[a-z0-9][a-z0-9._+-]*\/(?:\*|[a-z0-9][a-z0-9._+-]*)$/i

/** Accept tokens are intentionally narrower than arbitrary HTML accept attributes. */
export function isUploadAcceptToken(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 1 &&
    value.length <= UPLOAD_BUTTON_MODULE_LIMITS.acceptToken &&
    (ACCEPT_EXTENSION.test(value) || ACCEPT_MIME.test(value))
  )
}

function parseUploadAccept(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > UPLOAD_BUTTON_MODULE_LIMITS.acceptMax) {
    throw new TypeError(
      `upload button config accept must contain 0 to ${UPLOAD_BUTTON_MODULE_LIMITS.acceptMax} tokens`
    )
  }
  if (!hasDensePluginArrayKeys(value)) {
    throw new TypeError('upload button config accept must be a dense array without custom keys')
  }
  const seen = new Set<string>()
  const parsed = Array.from({ length: value.length }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (
      !descriptor?.enumerable ||
      !('value' in descriptor) ||
      !isUploadAcceptToken(descriptor.value)
    ) {
      throw new TypeError(
        `upload button config accept[${index}] must be a file extension or MIME token up to ${UPLOAD_BUTTON_MODULE_LIMITS.acceptToken} characters`
      )
    }
    const token = descriptor.value.toLowerCase()
    if (seen.has(token)) {
      throw new TypeError('upload button config accept must not contain duplicate tokens')
    }
    seen.add(token)
    return token
  })
  return Object.freeze(parsed) as string[]
}

function parseUploadButtonConfig(value: unknown) {
  return moduleContract.parseExactModuleConfig(
    value,
    CONFIG_KEYS,
    'upload button config must contain exactly triggerLabel, showTriggerIcon, showTriggerLabel, accept, multiple, maxFiles, maxFileBytes, allowDrop, showFileList, helperText, buttonBackground, buttonTextColor, accentColor, and errorColor',
    (source): UploadButtonModuleConfigV1 => {
      const config: UploadButtonModuleConfigV1 = {
        triggerLabel: parseBoundedPluginText(
          source.triggerLabel,
          'upload button config triggerLabel',
          1,
          UPLOAD_BUTTON_MODULE_LIMITS.triggerLabel
        ),
        showTriggerIcon: parsePluginBoolean(
          source.showTriggerIcon,
          'upload button config showTriggerIcon'
        ),
        showTriggerLabel: parsePluginBoolean(
          source.showTriggerLabel,
          'upload button config showTriggerLabel'
        ),
        accept: parseUploadAccept(source.accept),
        multiple: parsePluginBoolean(source.multiple, 'upload button config multiple'),
        maxFiles: parseBoundedPluginInteger(
          source.maxFiles,
          'upload button config maxFiles',
          UPLOAD_BUTTON_MODULE_LIMITS.maxFilesMin,
          UPLOAD_BUTTON_MODULE_LIMITS.maxFilesMax
        ),
        maxFileBytes: parseBoundedPluginInteger(
          source.maxFileBytes,
          'upload button config maxFileBytes',
          UPLOAD_BUTTON_MODULE_LIMITS.maxFileBytesMin,
          UPLOAD_BUTTON_MODULE_LIMITS.maxFileBytesMax
        ),
        allowDrop: parsePluginBoolean(source.allowDrop, 'upload button config allowDrop'),
        showFileList: parsePluginBoolean(source.showFileList, 'upload button config showFileList'),
        helperText: parseBoundedPluginText(
          source.helperText,
          'upload button config helperText',
          0,
          UPLOAD_BUTTON_MODULE_LIMITS.helperText
        ),
        buttonBackground: parseCanonicalPluginColor(
          source.buttonBackground,
          'upload button config buttonBackground'
        ),
        buttonTextColor: parseCanonicalPluginColor(
          source.buttonTextColor,
          'upload button config buttonTextColor'
        ),
        accentColor: parseCanonicalPluginColor(
          source.accentColor,
          'upload button config accentColor'
        ),
        errorColor: parseCanonicalPluginColor(source.errorColor, 'upload button config errorColor')
      }
      if (!config.showTriggerIcon && !config.showTriggerLabel) {
        throw new TypeError('upload button config must show a trigger icon or label')
      }
      if (config.multiple !== config.maxFiles > 1) {
        throw new TypeError(
          'upload button config multiple must be false exactly when maxFiles is 1'
        )
      }
      assertBoundedPluginConfigBytes(
        config,
        'upload button config',
        UPLOAD_BUTTON_MODULE_LIMITS.configBytes
      )
      return Object.freeze(config)
    }
  )
}

const UPLOAD_BUTTON_MODULE_CONTRACT: moduleContract.ModuleContract<UploadButtonModuleConfigV1> = {
  pluginId: UPLOAD_BUTTON_PLUGIN_ID,
  moduleType: UPLOAD_BUTTON_MODULE_TYPE,
  configVersion: UPLOAD_BUTTON_MODULE_CONFIG_VERSION,
  displayName: 'upload button',
  defaultConfig: UPLOAD_BUTTON_MODULE_DEFAULT_CONFIG,
  parseConfig: parseUploadButtonConfig
}

export function createUploadButtonModuleInstance(config?: unknown): ModuleInstanceV1 {
  return moduleContract.createContractModuleInstance(UPLOAD_BUTTON_MODULE_CONTRACT, config)
}

export function createUploadButtonModuleFrameOverrides(config?: unknown): Partial<SceneNode> {
  return createModuleFrameOverrides({
    name: 'Upload Button',
    defaultSize: UPLOAD_BUTTON_MODULE_DEFAULT_SIZE,
    fillColor: { r: 0.15, g: 0.39, b: 0.92, a: 1 },
    strokeColor: { r: 0.11, g: 0.31, b: 0.85, a: 1 },
    module: createUploadButtonModuleInstance(config)
  })
}

export function resolveUploadButtonModule(
  value: unknown
): ModuleResolution<UploadButtonModuleConfigV1> {
  return moduleContract.resolveContractModule(value, UPLOAD_BUTTON_MODULE_CONTRACT)
}

const UPLOAD_BUTTON_MODULE_FIELDS: readonly ModulePropertyField[] = Object.freeze([
  {
    path: ['triggerLabel'],
    kind: 'text',
    label: 'Trigger label',
    i18nLabelKey: 'lowcodeModuleFieldUploadButtonTriggerLabel'
  },
  {
    path: ['showTriggerIcon'],
    kind: 'boolean',
    label: 'Show trigger icon',
    i18nLabelKey: 'lowcodeModuleFieldUploadButtonShowTriggerIcon'
  },
  {
    path: ['showTriggerLabel'],
    kind: 'boolean',
    label: 'Show trigger label',
    i18nLabelKey: 'lowcodeModuleFieldUploadButtonShowTriggerLabel'
  },
  {
    path: ['accept'],
    kind: 'json',
    label: 'Accepted file types',
    i18nLabelKey: 'lowcodeModuleFieldUploadButtonAccept'
  },
  {
    path: ['multiple'],
    kind: 'boolean',
    label: 'Allow multiple files',
    i18nLabelKey: 'lowcodeModuleFieldUploadButtonMultiple'
  },
  {
    path: ['maxFiles'],
    kind: 'number',
    label: 'Maximum files',
    i18nLabelKey: 'lowcodeModuleFieldUploadButtonMaxFiles',
    min: UPLOAD_BUTTON_MODULE_LIMITS.maxFilesMin,
    max: UPLOAD_BUTTON_MODULE_LIMITS.maxFilesMax,
    step: 1
  },
  {
    path: ['maxFileBytes'],
    kind: 'number',
    label: 'Maximum bytes per file',
    i18nLabelKey: 'lowcodeModuleFieldUploadButtonMaxFileBytes',
    min: UPLOAD_BUTTON_MODULE_LIMITS.maxFileBytesMin,
    max: UPLOAD_BUTTON_MODULE_LIMITS.maxFileBytesMax,
    step: 1
  },
  {
    path: ['allowDrop'],
    kind: 'boolean',
    label: 'Allow drag and drop',
    i18nLabelKey: 'lowcodeModuleFieldUploadButtonAllowDrop'
  },
  {
    path: ['showFileList'],
    kind: 'boolean',
    label: 'Show selected files',
    i18nLabelKey: 'lowcodeModuleFieldUploadButtonShowFileList'
  },
  {
    path: ['helperText'],
    kind: 'text',
    label: 'Helper text',
    i18nLabelKey: 'lowcodeModuleFieldUploadButtonHelperText'
  },
  {
    path: ['buttonBackground'],
    kind: 'color',
    label: 'Button background',
    i18nLabelKey: 'lowcodeModuleFieldUploadButtonButtonBackground'
  },
  {
    path: ['buttonTextColor'],
    kind: 'color',
    label: 'Button text color',
    i18nLabelKey: 'lowcodeModuleFieldUploadButtonButtonTextColor'
  },
  {
    path: ['accentColor'],
    kind: 'color',
    label: 'Accent color',
    i18nLabelKey: 'lowcodeModuleFieldUploadButtonAccentColor'
  },
  {
    path: ['errorColor'],
    kind: 'color',
    label: 'Error color',
    i18nLabelKey: 'lowcodeModuleFieldUploadButtonErrorColor'
  }
])

export const UPLOAD_BUTTON_MODULE_DEFINITION = moduleContract.createContractModuleDefinition(
  UPLOAD_BUTTON_MODULE_CONTRACT,
  {
    name: 'Upload Button',
    description:
      'Selects and validates local files without transferring or persisting their contents.',
    i18nNameKey: 'lowcodeModuleUploadButtonName',
    i18nDescriptionKey: 'lowcodeModuleUploadButtonDescription',
    defaultSize: UPLOAD_BUTTON_MODULE_DEFAULT_SIZE,
    fields: UPLOAD_BUTTON_MODULE_FIELDS,
    createInstance: createUploadButtonModuleInstance,
    createFrameOverrides: createUploadButtonModuleFrameOverrides,
    resolve: resolveUploadButtonModule
  }
)

export const UPLOAD_BUTTON_PLUGIN = moduleContract.createSingleModulePlugin(
  UPLOAD_BUTTON_PLUGIN_ID,
  'OpenPencil Upload Button',
  UPLOAD_BUTTON_MODULE_DEFINITION
)
