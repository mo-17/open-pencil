import { MAP_MODULE_TYPE, MAP_PLUGIN_ID, resolveMapModule } from '@open-pencil/core/plugins'
import type { SceneNode } from '@open-pencil/scene-graph'

import type { CompilerModuleLowerer } from './types'

export const MAP_COMPILER_MODULE_LOWERER: CompilerModuleLowerer = Object.freeze({
  pluginId: MAP_PLUGIN_ID,
  moduleType: MAP_MODULE_TYPE,
  warningCodePrefix: 'map-module',
  displayName: 'map',
  hostTypes: Object.freeze(['FRAME'] as const),
  lower(value: unknown, _node: SceneNode) {
    const resolved = resolveMapModule(value)
    if (!resolved?.ok) {
      return { ok: false as const, reason: resolved?.reason ?? 'module identity does not match' }
    }
    const { config } = resolved
    return {
      ok: true as const,
      payload: {
        provider: config.provider,
        style: config.style,
        center: [config.center[0], config.center[1]],
        zoom: config.zoom,
        interactive: config.interactive,
        markers: config.markers.map((marker) => ({
          id: marker.id,
          lng: marker.lng,
          lat: marker.lat,
          ...(marker.label === undefined ? {} : { label: marker.label })
        })),
        layers: [],
        attribution: config.attribution
      }
    }
  }
})
