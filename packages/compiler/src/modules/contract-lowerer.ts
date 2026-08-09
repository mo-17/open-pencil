import type { ModuleResolution } from '@open-pencil/core/plugins'
import type { NodeType } from '@open-pencil/scene-graph'
import type { JsonObject } from '@open-pencil/scene-graph/primitives'

import type { CompilerModuleLowerer, CompilerModulePayload } from './types'

interface ContractModuleLowererOptions<TConfig extends JsonObject> {
  readonly pluginId: string
  readonly moduleType: string
  readonly warningCodePrefix: string
  readonly displayName: string
  readonly hostTypes?: readonly NodeType[]
  readonly resolve: (value: unknown) => ModuleResolution<TConfig>
  readonly payload: (config: TConfig) => CompilerModulePayload
}

/** Build a defensive compiler lowerer around a Core-owned strict module resolver. */
export function createContractModuleLowerer<TConfig extends JsonObject>(
  options: ContractModuleLowererOptions<TConfig>
): CompilerModuleLowerer {
  return Object.freeze({
    pluginId: options.pluginId,
    moduleType: options.moduleType,
    warningCodePrefix: options.warningCodePrefix,
    displayName: options.displayName,
    hostTypes: Object.freeze([...(options.hostTypes ?? ['FRAME'])]),
    lower(value: unknown) {
      const resolved = options.resolve(value)
      if (!resolved?.ok) {
        return { ok: false as const, reason: resolved?.reason ?? 'module identity does not match' }
      }
      return { ok: true as const, payload: options.payload(resolved.config) }
    }
  })
}
