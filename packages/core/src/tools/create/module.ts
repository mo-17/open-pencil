import { resolveToolModule } from '#core/tools/module-registry'
import { defineTool } from '#core/tools/schema'

export const createModule = defineTool({
  name: 'create_module',
  mutates: true,
  description:
    'Create a registered declarative module. The document node is always a native FRAME and the versioned module envelope is stored at interactiveProps.module.',
  params: {
    plugin_id: { type: 'string', description: 'Registered plugin id', required: true },
    module_type: { type: 'string', description: 'Registered module type', required: true },
    config: {
      type: 'object',
      description: 'Optional module config values layered over the registered defaults',
      additionalProperties: true
    },
    x: { type: 'number', description: 'X position', default: 0 },
    y: { type: 'number', description: 'Y position', default: 0 },
    width: { type: 'number', description: 'Optional width override', min: 1 },
    height: { type: 'number', description: 'Optional height override', min: 1 },
    name: { type: 'string', description: 'Optional layer name' },
    parent_id: { type: 'string', description: 'Optional container node id' }
  },
  execute: (figma, args, ctx) => {
    const resolved = resolveToolModule(ctx, args.plugin_id, args.module_type, true)
    if (!resolved.ok) return resolved
    const definition = resolved.definition
    const parentId = args.parent_id ?? figma.currentPage.id
    const parent = figma.graph.getNode(parentId)
    if (!parent) return { ok: false, error: `Parent node "${parentId}" not found` }
    if (!figma.graph.isContainer(parentId)) {
      return { ok: false, error: `Parent node "${parentId}" cannot contain children` }
    }
    try {
      const overrides = definition.createFrameOverrides(args.config)
      const node = (() => {
        if (!ctx?.editor) {
          return figma.graph.createNode('FRAME', parentId, {
            ...overrides,
            x: args.x ?? 0,
            y: args.y ?? 0,
            ...(args.width === undefined ? {} : { width: args.width }),
            ...(args.height === undefined ? {} : { height: args.height }),
            ...(args.name === undefined ? {} : { name: args.name })
          })
        }

        const initialOverrides = { ...overrides }
        const defaultName = initialOverrides.name
        const defaultWidth = initialOverrides.width ?? definition.defaultSize.width
        const defaultHeight = initialOverrides.height ?? definition.defaultSize.height
        delete initialOverrides.x
        delete initialOverrides.y
        delete initialOverrides.width
        delete initialOverrides.height
        delete initialOverrides.name

        const id = ctx.editor.createShape(
          'FRAME',
          args.x ?? 0,
          args.y ?? 0,
          args.width ?? defaultWidth,
          args.height ?? defaultHeight,
          parentId,
          args.name ?? defaultName,
          initialOverrides
        )
        const created = figma.graph.getNode(id)
        if (!created) throw new Error(`Created module node "${id}" was not found`)
        return created
      })()
      return {
        ok: true,
        data: {
          id: node.id,
          name: node.name,
          type: node.type,
          parentId,
          module: structuredClone(node.interactiveProps?.module)
        }
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Invalid module config' }
    }
  }
})
