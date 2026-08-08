import {
  CAROUSEL_MODULE_TYPE,
  CAROUSEL_PLUGIN_ID,
  resolveCarouselModule
} from '@open-pencil/core/plugins'
import type { SceneNode } from '@open-pencil/scene-graph'

import type { CompilerModuleLowerer } from './types'

export const CAROUSEL_COMPILER_MODULE_LOWERER: CompilerModuleLowerer = Object.freeze({
  pluginId: CAROUSEL_PLUGIN_ID,
  moduleType: CAROUSEL_MODULE_TYPE,
  warningCodePrefix: 'carousel-module',
  displayName: 'Carousel',
  hostTypes: Object.freeze(['FRAME'] as const),
  lower(value: unknown, _node: SceneNode) {
    const resolved = resolveCarouselModule(value)
    if (!resolved?.ok) {
      return { ok: false as const, reason: resolved?.reason ?? 'module identity does not match' }
    }
    const { config } = resolved
    return {
      ok: true as const,
      payload: {
        label: config.label,
        slides: config.slides.map((slide) => ({ ...slide })),
        initialIndex: config.initialIndex,
        transition: config.transition,
        autoplay: config.autoplay,
        intervalMs: config.intervalMs,
        loop: config.loop,
        showArrows: config.showArrows,
        showDots: config.showDots,
        pauseOnHover: config.pauseOnHover,
        backgroundColor: config.backgroundColor,
        textColor: config.textColor,
        accentColor: config.accentColor
      }
    }
  }
})
