import {
  VR_TOUR_MODULE_TYPE,
  VR_TOUR_PLUGIN_ID,
  resolveVRTourModule
} from '@open-pencil/core/plugins'

import type { CompilerModuleLowerer } from './types'

export const VR_TOUR_COMPILER_MODULE_LOWERER: CompilerModuleLowerer = Object.freeze({
  pluginId: VR_TOUR_PLUGIN_ID,
  moduleType: VR_TOUR_MODULE_TYPE,
  warningCodePrefix: 'vr-tour-module',
  displayName: 'VR tour',
  hostTypes: Object.freeze(['FRAME'] as const),
  lower(value: unknown) {
    const resolved = resolveVRTourModule(value)
    if (!resolved?.ok)
      return { ok: false as const, reason: resolved?.reason ?? 'module identity does not match' }
    return { ok: true as const, payload: structuredClone(resolved.config) }
  }
})
