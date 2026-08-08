import { BUILTIN_PLUGIN_REGISTRY, type ModuleDefinition } from '#core/plugins'
import type { ToolCtx } from '#core/tools/schema'

type ToolModuleResolution =
  | { ok: true; definition: ModuleDefinition }
  | { ok: false; error: string }

export function resolveToolModule(
  ctx: ToolCtx | undefined,
  pluginId: string,
  moduleType: string,
  requireEnabled = false
): ToolModuleResolution {
  const definition = (ctx?.moduleRegistry ?? BUILTIN_PLUGIN_REGISTRY).getModule(
    pluginId,
    moduleType
  )
  if (!definition) {
    return { ok: false, error: `Module ${pluginId}/${moduleType} is not registered` }
  }
  if (requireEnabled && ctx?.canCreateModule && !ctx.canCreateModule(pluginId, moduleType)) {
    return { ok: false, error: `Module ${pluginId}/${moduleType} is not enabled` }
  }
  return { ok: true, definition }
}
