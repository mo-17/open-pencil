import { moduleDefinitionKey, validateModuleIdentity } from '@open-pencil/scene-graph'

import type { ModuleDefinition, PluginDefinition } from './types'

function assertIdentity(value: string, path: string): void {
  const reason = validateModuleIdentity(value, path)
  if (reason) throw new TypeError(reason)
}

function deepFreezeJson<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value
  seen.add(value)
  if (Array.isArray(value)) {
    value.forEach((entry) => deepFreezeJson(entry, seen))
  } else {
    Object.values(value).forEach((entry) => deepFreezeJson(entry, seen))
  }
  Object.freeze(value)
  return value
}

function freezeModuleDefinition(definition: ModuleDefinition): ModuleDefinition {
  const defaultConfig = structuredClone(definition.defaultConfig)
  deepFreezeJson(defaultConfig)
  return Object.freeze({
    ...definition,
    defaultSize: Object.freeze({ ...definition.defaultSize }),
    defaultConfig,
    fields: Object.freeze(
      definition.fields.map((field) =>
        Object.freeze({
          ...field,
          path: Object.freeze([...field.path]),
          ...(field.options ? { options: Object.freeze([...field.options]) } : {})
        })
      )
    )
  })
}

export class PluginRegistry {
  private readonly plugins = new Map<string, PluginDefinition>()
  private readonly modules = new Map<string, ModuleDefinition>()
  private frozen = false

  register(plugin: PluginDefinition): this {
    if (this.frozen) throw new Error('Plugin registry is frozen')
    assertIdentity(plugin.id, 'plugin.id')
    if (this.plugins.has(plugin.id)) throw new Error(`Duplicate plugin id: ${plugin.id}`)

    const moduleKeys = new Set<string>()
    for (const definition of plugin.modules) {
      assertIdentity(definition.pluginId, 'module.pluginId')
      assertIdentity(definition.moduleType, 'module.moduleType')
      if (definition.pluginId !== plugin.id) {
        throw new Error(
          `Module ${definition.moduleType} belongs to ${definition.pluginId}, expected ${plugin.id}`
        )
      }
      const key = moduleDefinitionKey(definition.pluginId, definition.moduleType)
      if (moduleKeys.has(key) || this.modules.has(key)) throw new Error(`Duplicate module: ${key}`)
      moduleKeys.add(key)
    }

    const modules = plugin.modules.map(freezeModuleDefinition)
    const stored = Object.freeze({ ...plugin, modules: Object.freeze(modules) })
    this.plugins.set(stored.id, stored)
    modules.forEach((definition) => {
      this.modules.set(moduleDefinitionKey(definition.pluginId, definition.moduleType), definition)
    })
    return this
  }

  freeze(): this {
    this.frozen = true
    return this
  }

  get isFrozen(): boolean {
    return this.frozen
  }

  getPlugin(pluginId: string): PluginDefinition | undefined {
    return this.plugins.get(pluginId)
  }

  getModule(pluginId: string, moduleType: string): ModuleDefinition | undefined {
    return this.modules.get(moduleDefinitionKey(pluginId, moduleType))
  }

  listPlugins(): readonly PluginDefinition[] {
    return Object.freeze([...this.plugins.values()])
  }

  listModules(): readonly ModuleDefinition[] {
    return Object.freeze([...this.modules.values()])
  }
}
