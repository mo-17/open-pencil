import { moduleDefinitionKey, validateModuleIdentity } from '@open-pencil/scene-graph'

import type { CompilerModuleBundle, CompilerModuleLowerer } from './types'

function assertIdentity(value: string, path: string): void {
  const reason = validateModuleIdentity(value, path)
  if (reason) throw new TypeError(reason)
}

/** Frozen trusted-module registry shared by IR collection and framework
 * adapters. Adding a module changes only the bundle manifest, not either
 * pipeline's dispatch code. */
export class CompilerModuleRegistry {
  private readonly bundles = new Map<string, CompilerModuleBundle>()
  private frozen = false

  register(bundle: CompilerModuleBundle): this {
    if (this.frozen) throw new Error('Compiler module registry is frozen')
    const { pluginId, moduleType } = bundle.lowerer
    assertIdentity(pluginId, 'compiler module pluginId')
    assertIdentity(moduleType, 'compiler module moduleType')
    const key = moduleDefinitionKey(pluginId, moduleType)
    if (this.bundles.has(key)) throw new Error(`Duplicate compiler module: ${key}`)
    this.bundles.set(
      key,
      Object.freeze({
        lowerer: Object.freeze({
          ...bundle.lowerer,
          hostTypes: Object.freeze([...bundle.lowerer.hostTypes])
        }),
        targets: Object.freeze({ ...bundle.targets })
      })
    )
    return this
  }

  freeze(): this {
    this.frozen = true
    return this
  }

  getLowerer(pluginId: string, moduleType: string): CompilerModuleLowerer | undefined {
    return this.bundles.get(moduleDefinitionKey(pluginId, moduleType))?.lowerer
  }

  getTarget(target: string, pluginId: string, moduleType: string): unknown {
    return this.bundles.get(moduleDefinitionKey(pluginId, moduleType))?.targets[target]
  }

  listBundles(): readonly CompilerModuleBundle[] {
    return Object.freeze([...this.bundles.values()])
  }
}
