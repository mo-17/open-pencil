import type { ModuleInstanceV1, SceneNode } from '@open-pencil/scene-graph'

import * as moduleContract from '#core/plugins/module-contract'
import { createModuleFrameOverrides } from '#core/plugins/module-frame'
import type { ModulePropertyField, ModuleResolution } from '#core/plugins/types'

import {
  VR_TOUR_MODULE_CONFIG_VERSION,
  VR_TOUR_MODULE_DEFAULT_CONFIG,
  VR_TOUR_MODULE_DEFAULT_SIZE,
  VR_TOUR_MODULE_LIMITS,
  VR_TOUR_MODULE_TYPE,
  VR_TOUR_PLUGIN_ID
} from './defaults'
import { parseVRTourConfig } from './parse'
import type { VRTourModuleConfigV1 } from './types'

export * from './defaults'
export * from './sample-assets'
export type * from './types'
export { parseVRTourPanoramaURL } from './parse'

const CONTRACT: moduleContract.ModuleContract<VRTourModuleConfigV1> = {
  pluginId: VR_TOUR_PLUGIN_ID,
  moduleType: VR_TOUR_MODULE_TYPE,
  configVersion: VR_TOUR_MODULE_CONFIG_VERSION,
  displayName: 'VR tour',
  defaultConfig: VR_TOUR_MODULE_DEFAULT_CONFIG,
  parseConfig: parseVRTourConfig
}

export function createVRTourModuleInstance(config?: unknown): ModuleInstanceV1 {
  return moduleContract.createContractModuleInstance(CONTRACT, config)
}

export function createVRTourModuleFrameOverrides(config?: unknown): Partial<SceneNode> {
  return createModuleFrameOverrides({
    name: 'VR Tour',
    defaultSize: VR_TOUR_MODULE_DEFAULT_SIZE,
    fillColor: { r: 0.06, g: 0.09, b: 0.16, a: 1 },
    strokeColor: { r: 0.2, g: 0.3, b: 0.4, a: 1 },
    module: createVRTourModuleInstance(config)
  })
}

export function resolveVRTourModule(value: unknown): ModuleResolution<VRTourModuleConfigV1> {
  return moduleContract.resolveContractModule(value, CONTRACT)
}

const FIELDS: readonly ModulePropertyField[] = Object.freeze([
  {
    path: ['locale'],
    i18nLabelKey: 'lowcodeModuleFieldVRTourLocale',
    kind: 'select',
    label: 'Interface language',
    options: ['en', 'zh-CN']
  },
  {
    path: ['label'],
    i18nLabelKey: 'lowcodeModuleFieldVRTourLabel',
    kind: 'text',
    label: 'Tour label'
  },
  {
    path: ['scenes'],
    i18nLabelKey: 'lowcodeModuleFieldVRTourScenes',
    kind: 'json',
    label: 'Rooms and hotspots'
  },
  {
    path: ['initialSceneId'],
    i18nLabelKey: 'lowcodeModuleFieldVRTourInitialSceneId',
    kind: 'text',
    label: 'Initial room'
  },
  {
    path: ['initialYaw'],
    i18nLabelKey: 'lowcodeModuleFieldVRTourInitialYaw',
    kind: 'number',
    label: 'Initial horizontal angle',
    min: VR_TOUR_MODULE_LIMITS.yawMin,
    max: VR_TOUR_MODULE_LIMITS.yawMax,
    step: 1
  },
  {
    path: ['initialPitch'],
    i18nLabelKey: 'lowcodeModuleFieldVRTourInitialPitch',
    kind: 'number',
    label: 'Initial vertical angle',
    min: VR_TOUR_MODULE_LIMITS.pitchMin,
    max: VR_TOUR_MODULE_LIMITS.pitchMax,
    step: 1
  },
  {
    path: ['initialFov'],
    i18nLabelKey: 'lowcodeModuleFieldVRTourInitialFov',
    kind: 'number',
    label: 'Field of view',
    min: VR_TOUR_MODULE_LIMITS.fovMin,
    max: VR_TOUR_MODULE_LIMITS.fovMax,
    step: 1
  },
  {
    path: ['showControls'],
    i18nLabelKey: 'lowcodeModuleFieldVRTourShowControls',
    kind: 'boolean',
    label: 'Show view controls'
  },
  {
    path: ['showSceneList'],
    i18nLabelKey: 'lowcodeModuleFieldVRTourShowSceneList',
    kind: 'boolean',
    label: 'Show room list'
  },
  {
    path: ['accentColor'],
    i18nLabelKey: 'lowcodeModuleFieldVRTourAccentColor',
    kind: 'color',
    label: 'Accent color'
  },
  {
    path: ['backgroundColor'],
    i18nLabelKey: 'lowcodeModuleFieldVRTourBackgroundColor',
    kind: 'color',
    label: 'Background color'
  },
  {
    path: ['textColor'],
    i18nLabelKey: 'lowcodeModuleFieldVRTourTextColor',
    kind: 'color',
    label: 'Text color'
  }
])

export const VR_TOUR_MODULE_DEFINITION = moduleContract.createContractModuleDefinition(CONTRACT, {
  name: 'VR Tour',
  description:
    'A 360-degree panorama room tour with bounded scene links and an offline canvas diagram.',
  i18nNameKey: 'lowcodeModuleVRTourName',
  i18nDescriptionKey: 'lowcodeModuleVRTourDescription',
  defaultSize: VR_TOUR_MODULE_DEFAULT_SIZE,
  fields: FIELDS,
  createInstance: createVRTourModuleInstance,
  createFrameOverrides: createVRTourModuleFrameOverrides,
  resolve: resolveVRTourModule
})

export const VR_TOUR_PLUGIN = moduleContract.createSingleModulePlugin(
  VR_TOUR_PLUGIN_ID,
  'OpenPencil VR Tour',
  VR_TOUR_MODULE_DEFINITION
)
