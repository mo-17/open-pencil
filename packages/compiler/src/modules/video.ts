import type { IRAttrValue, IRModule, IRWarning } from '#compiler/ir/types'

import { VIDEO_MODULE_TYPE, VIDEO_PLUGIN_ID, resolveVideoModule } from '@open-pencil/core/plugins'
import type { ExprAst } from '@open-pencil/lowcode'
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

/** Bind only the reviewed video identity; invalid authored reads never fall back. */
export function collectVideoModuleBindings(
  node: SceneNode,
  module: IRModule | null,
  attrs: Record<string, IRAttrValue>,
  warnings: IRWarning[],
  resolve: (source: string) => ExprAst | undefined
): void {
  if (module?.pluginId !== VIDEO_PLUGIN_ID || module.moduleType !== VIDEO_MODULE_TYPE) return
  const lang = node.interactiveProps?.lang
  if (lang === 'en' || lang === 'zh-CN') attrs.lang = lang
  for (const key of ['src', 'poster'] as const) {
    if (!node.bindings || !Object.hasOwn(node.bindings, key)) continue
    const field = key === 'src' ? 'videoSrcExpr' : 'videoPosterExpr'
    module[field] = { kind: 'ident', name: 'undefined' }
    const binding: unknown = node.bindings[key]
    if (
      binding === null ||
      typeof binding !== 'object' ||
      !('kind' in binding) ||
      binding.kind !== 'expr' ||
      !('expr' in binding) ||
      typeof binding.expr !== 'string'
    ) {
      warnings.push({
        code: 'video-binding-invalid',
        message: `Video ${key} requires a read expression binding`,
        nodeId: node.id
      })
      continue
    }
    const ast = resolve(binding.expr)
    if (ast) module[field] = ast
  }
}
