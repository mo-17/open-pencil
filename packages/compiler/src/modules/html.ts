import { HTML_MODULE_TYPE, HTML_PLUGIN_ID, resolveHtmlModule } from '@open-pencil/core/plugins'
import type { SceneNode } from '@open-pencil/scene-graph'

import type { CompilerModuleLowerer } from './types'

export const HTML_COMPILER_MODULE_LOWERER: CompilerModuleLowerer = Object.freeze({
  pluginId: HTML_PLUGIN_ID,
  moduleType: HTML_MODULE_TYPE,
  warningCodePrefix: 'html-module',
  displayName: 'HTML',
  hostTypes: Object.freeze(['FRAME'] as const),
  lower(value: unknown, _node: SceneNode) {
    const resolved = resolveHtmlModule(value)
    if (!resolved?.ok) {
      return { ok: false as const, reason: resolved?.reason ?? 'module identity does not match' }
    }
    return {
      ok: true as const,
      payload: { html: resolved.config.html }
    }
  }
})
