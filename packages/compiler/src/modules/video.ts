import { VIDEO_MODULE_TYPE, VIDEO_PLUGIN_ID, resolveVideoModule } from '@open-pencil/core/plugins'
import type { SceneNode } from '@open-pencil/scene-graph'

import type { CompilerModuleLowerer } from './types'

export const VIDEO_COMPILER_MODULE_LOWERER: CompilerModuleLowerer = Object.freeze({
  pluginId: VIDEO_PLUGIN_ID,
  moduleType: VIDEO_MODULE_TYPE,
  warningCodePrefix: 'video-module',
  displayName: 'Video',
  hostTypes: Object.freeze(['FRAME'] as const),
  lower(value: unknown, _node: SceneNode) {
    const resolved = resolveVideoModule(value)
    if (!resolved?.ok) {
      return { ok: false as const, reason: resolved?.reason ?? 'module identity does not match' }
    }
    const { config } = resolved
    return {
      ok: true as const,
      payload: {
        src: config.src,
        poster: config.poster,
        controls: config.controls,
        autoplay: config.autoplay,
        muted: config.muted,
        loop: config.loop,
        fit: config.fit
      }
    }
  }
})
