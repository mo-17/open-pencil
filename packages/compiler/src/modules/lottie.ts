import {
  LOTTIE_MODULE_TYPE,
  LOTTIE_PLUGIN_ID,
  resolveLottieModule
} from '@open-pencil/core/plugins'
import type { SceneNode } from '@open-pencil/scene-graph'

import type { CompilerModuleLowerer } from './types'

export const LOTTIE_COMPILER_MODULE_LOWERER: CompilerModuleLowerer = Object.freeze({
  pluginId: LOTTIE_PLUGIN_ID,
  moduleType: LOTTIE_MODULE_TYPE,
  warningCodePrefix: 'lottie-module',
  displayName: 'Lottie animation',
  hostTypes: Object.freeze(['FRAME'] as const),
  lower(value: unknown, _node: SceneNode) {
    const resolved = resolveLottieModule(value)
    if (!resolved?.ok) {
      return { ok: false as const, reason: resolved?.reason ?? 'module identity does not match' }
    }
    const { config } = resolved
    return {
      ok: true as const,
      payload: {
        source: config.source,
        url: config.url,
        data: structuredClone(config.data),
        autoplay: config.autoplay,
        loop: config.loop,
        speed: config.speed,
        direction: config.direction,
        fit: config.fit
      }
    }
  }
})
