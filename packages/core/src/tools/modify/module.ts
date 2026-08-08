import type { SceneNode } from '@open-pencil/scene-graph'

import { resolveToolModule } from '#core/tools/module-registry'
import { defineTool } from '#core/tools/schema'

export const updateModule = defineTool({
  name: 'update_module',
  mutates: true,
  description:
    'Update a module config with an identity guard. plugin_id and module_type must match the existing FRAME module. Config values are shallow-merged, validated, and committed in one node mutation.',
  params: {
    id: { type: 'string', description: 'FRAME node id', required: true },
    plugin_id: { type: 'string', description: 'Expected existing plugin id', required: true },
    module_type: { type: 'string', description: 'Expected existing module type', required: true },
    config: {
      type: 'object',
      description: 'Config values to shallow-merge over the current validated config',
      required: true,
      additionalProperties: true
    }
  },
  execute: (figma, args, ctx) => {
    const node = figma.graph.getNode(args.id)
    if (!node) return { ok: false, error: `Node "${args.id}" not found` }
    if (node.type !== 'FRAME') return { ok: false, error: `Node "${args.id}" is not a FRAME` }
    const resolved = resolveToolModule(ctx, args.plugin_id, args.module_type)
    if (!resolved.ok) return resolved
    const definition = resolved.definition
    const current = definition.resolve(node.interactiveProps?.module)
    if (!current?.ok) {
      return {
        ok: false,
        error:
          current === null
            ? `Node "${args.id}" does not contain module ${args.plugin_id}/${args.module_type}`
            : current.reason
      }
    }
    if (
      current.instance.pluginId !== args.plugin_id ||
      current.instance.moduleType !== args.module_type
    ) {
      return {
        ok: false,
        error: 'Existing module identity does not match the requested identity guard'
      }
    }
    try {
      const module = definition.createInstance({ ...current.config, ...args.config })
      const changes: Partial<SceneNode> = {
        interactiveProps: { ...node.interactiveProps, module }
      }
      if (ctx?.editor) {
        ctx.editor.updateNodeWithUndo(args.id, changes, 'AI: update_module')
      } else {
        figma.graph.updateNode(args.id, changes)
      }
      return { ok: true, data: { id: args.id, module, config: module.config } }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Invalid module config' }
    }
  }
})
