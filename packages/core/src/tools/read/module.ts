import { BUILTIN_PLUGIN_REGISTRY, type ModuleDefinition } from '#core/plugins'
import { defineTool } from '#core/tools/schema'

function moduleSummary(definition: ModuleDefinition): Record<string, unknown> {
  return {
    pluginId: definition.pluginId,
    moduleType: definition.moduleType,
    name: definition.name,
    description: definition.description,
    configVersion: definition.configVersion,
    defaultSize: { ...definition.defaultSize },
    defaultConfig: structuredClone(definition.defaultConfig),
    fields: structuredClone(definition.fields)
  }
}

export const listModules = defineTool({
  name: 'list_modules',
  description: 'List registered declarative modules that can be created as native FRAME nodes.',
  params: {},
  execute: (_figma, _args, ctx) => {
    const registry = ctx?.moduleRegistry ?? BUILTIN_PLUGIN_REGISTRY
    const definitions = ctx?.canCreateModule
      ? registry
          .listModules()
          .filter((definition) => ctx.canCreateModule?.(definition.pluginId, definition.moduleType))
      : registry.listModules()
    return { ok: true, data: { modules: definitions.map(moduleSummary) } }
  }
})

export const readModule = defineTool({
  name: 'read_module',
  description: 'Read and validate the declarative module stored on a FRAME node.',
  params: {
    id: { type: 'string', description: 'FRAME node id', required: true }
  },
  execute: (figma, { id }, ctx) => {
    const node = figma.graph.getNode(id)
    if (!node) return { ok: false, error: `Node "${id}" not found` }
    if (node.type !== 'FRAME') return { ok: false, error: `Node "${id}" is not a FRAME` }
    const value = node.interactiveProps?.module
    if (value === undefined || value === null) {
      return { ok: false, error: `Node "${id}" does not contain a module` }
    }
    const registry = ctx?.moduleRegistry ?? BUILTIN_PLUGIN_REGISTRY
    for (const definition of registry.listModules()) {
      const resolved = definition.resolve(value)
      if (resolved?.ok) {
        return {
          ok: true,
          data: {
            id: node.id,
            name: node.name,
            type: node.type,
            module: resolved.instance,
            config: resolved.config,
            definition: moduleSummary(definition)
          }
        }
      }
    }
    return { ok: false, error: 'Module is invalid or is not registered' }
  }
})
