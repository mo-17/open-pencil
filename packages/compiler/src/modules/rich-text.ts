import {
  RICH_TEXT_MODULE_TYPE,
  RICH_TEXT_PLUGIN_ID,
  resolveRichTextModule
} from '@open-pencil/core/plugins'
import type { SceneNode } from '@open-pencil/scene-graph'

import type { CompilerModuleLowerer } from './types'

export const RICH_TEXT_COMPILER_MODULE_LOWERER: CompilerModuleLowerer = Object.freeze({
  pluginId: RICH_TEXT_PLUGIN_ID,
  moduleType: RICH_TEXT_MODULE_TYPE,
  warningCodePrefix: 'rich-text-module',
  displayName: 'rich text',
  hostTypes: Object.freeze(['FRAME'] as const),
  lower(value: unknown, _node: SceneNode) {
    const resolved = resolveRichTextModule(value)
    if (!resolved?.ok) {
      return { ok: false as const, reason: resolved?.reason ?? 'module identity does not match' }
    }
    const { config } = resolved
    return {
      ok: true as const,
      payload: {
        content: structuredClone(config.content),
        textColor: config.textColor,
        linkColor: config.linkColor,
        fontSize: config.fontSize,
        lineHeight: config.lineHeight
      }
    }
  }
})
