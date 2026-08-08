import type { ComponentDef, IRModule, IRNode } from '#compiler/ir/types'
import type { CompilerModuleRegistry } from '#compiler/modules/registry'

import { referencedModules } from '../ir-walk'
import { BUILTIN_REACT_MODULE_REGISTRY } from './builtin'
import type {
  ReactModuleAdapter,
  ReactModuleProjectContribution,
  ReactModuleRuntimeOptions
} from './types'

function isReactModuleAdapter(value: unknown): value is ReactModuleAdapter {
  if (value === null || typeof value !== 'object') return false
  const candidate = value as Partial<ReactModuleAdapter>
  return (
    typeof candidate.pluginId === 'string' &&
    typeof candidate.moduleType === 'string' &&
    typeof candidate.componentName === 'string' &&
    typeof candidate.runtimePath === 'string' &&
    typeof candidate.rootImportPath === 'string' &&
    typeof candidate.nestedImportPath === 'string' &&
    typeof candidate.buildRuntime === 'function'
  )
}

export function requireReactModuleAdapter(
  module: Pick<IRModule, 'pluginId' | 'moduleType'>,
  registry: CompilerModuleRegistry = BUILTIN_REACT_MODULE_REGISTRY
): ReactModuleAdapter {
  const candidate = registry.getTarget('react', module.pluginId, module.moduleType)
  if (!isReactModuleAdapter(candidate)) {
    throw new Error(`Missing React module adapter for ${module.pluginId}/${module.moduleType}`)
  }
  if (candidate.pluginId !== module.pluginId || candidate.moduleType !== module.moduleType) {
    throw new Error(
      `React module adapter identity mismatch for ${module.pluginId}/${module.moduleType}`
    )
  }
  return candidate
}

export function buildReactModuleImports(
  nodes: readonly IRNode[],
  nested: boolean,
  registry: CompilerModuleRegistry = BUILTIN_REACT_MODULE_REGISTRY
): string {
  return referencedModules(nodes)
    .map((module) => requireReactModuleAdapter(module, registry))
    .map(
      (adapter) =>
        `import ${adapter.componentName} from '${nested ? adapter.nestedImportPath : adapter.rootImportPath}'`
    )
    .join('\n')
}

function componentBodyNodes(def: ComponentDef): readonly IRNode[] {
  return def.variants
    ? [...def.children, ...def.variants.flatMap((variant) => variant.children)]
    : def.children
}

export function collectReactModuleProject(
  irNodes: readonly (readonly IRNode[])[],
  components: readonly ComponentDef[],
  registry: CompilerModuleRegistry = BUILTIN_REACT_MODULE_REGISTRY
): ReactModuleProjectContribution {
  const modules = [
    ...irNodes.flatMap((nodes) => referencedModules(nodes)),
    ...components.flatMap((definition) => referencedModules(componentBodyNodes(definition)))
  ]
  const adaptersByIdentity = new Map<string, ReactModuleAdapter>()
  for (const module of modules) {
    const adapter = requireReactModuleAdapter(module, registry)
    adaptersByIdentity.set(`${adapter.pluginId}/${adapter.moduleType}`, adapter)
  }

  const adapters = [...adaptersByIdentity.values()].sort((a, b) =>
    `${a.pluginId}/${a.moduleType}`.localeCompare(`${b.pluginId}/${b.moduleType}`)
  )
  const dependencies = new Map<string, string>()
  const runtimePaths = new Set<string>()
  const componentNames = new Set<string>()
  for (const adapter of adapters) {
    if (runtimePaths.has(adapter.runtimePath)) {
      throw new Error(`Duplicate React module runtime path: ${adapter.runtimePath}`)
    }
    if (componentNames.has(adapter.componentName)) {
      throw new Error(`Duplicate React module component name: ${adapter.componentName}`)
    }
    runtimePaths.add(adapter.runtimePath)
    componentNames.add(adapter.componentName)
    for (const [name, version] of Object.entries(adapter.dependencies ?? {})) {
      const previous = dependencies.get(name)
      if (previous !== undefined && previous !== version) {
        throw new Error(`Conflicting React module dependency ${name}: ${previous} vs ${version}`)
      }
      dependencies.set(name, version)
    }
  }
  return { adapters, dependencies: Object.fromEntries(dependencies) }
}

export function emitReactModuleRuntimes(
  files: Map<string, string | Uint8Array>,
  contribution: ReactModuleProjectContribution,
  options: ReactModuleRuntimeOptions
): void {
  for (const adapter of contribution.adapters) {
    if (files.has(adapter.runtimePath)) {
      throw new Error(`React module runtime would overwrite generated file: ${adapter.runtimePath}`)
    }
    files.set(adapter.runtimePath, adapter.buildRuntime(options))
  }
}

export function reactModuleOptimizeDepsForFiles(
  files: ReadonlyMap<string, string | Uint8Array>,
  registry: CompilerModuleRegistry = BUILTIN_REACT_MODULE_REGISTRY
): string[] {
  const dependencies = new Set<string>()
  for (const bundle of registry.listBundles()) {
    const adapter = requireReactModuleAdapter(
      {
        pluginId: bundle.lowerer.pluginId,
        moduleType: bundle.lowerer.moduleType
      },
      registry
    )
    if (!files.has(adapter.runtimePath)) continue
    for (const dependency of adapter.optimizeDeps ?? []) dependencies.add(dependency)
  }
  return [...dependencies].sort()
}
