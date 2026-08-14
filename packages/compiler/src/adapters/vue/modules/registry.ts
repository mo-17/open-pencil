import type { ComponentDef, IRModule, IRNode } from '#compiler/ir/types'
import type { CompilerModuleRegistry } from '#compiler/modules/registry'

import { BUILTIN_VUE_MODULE_REGISTRY } from './builtin'
import { buildVueLayerRuntime, VUE_LAYER_RUNTIME_PATH } from './layer-runtime'
import type { VueModuleAdapter, VueModuleProjectContribution } from './types'

function isVueModuleAdapter(value: unknown): value is VueModuleAdapter {
  if (value === null || typeof value !== 'object') return false
  const candidate = value as Partial<VueModuleAdapter>
  return (
    typeof candidate.pluginId === 'string' &&
    typeof candidate.moduleType === 'string' &&
    typeof candidate.componentName === 'string' &&
    typeof candidate.runtimePath === 'string' &&
    typeof candidate.importPath === 'string' &&
    typeof candidate.buildRuntime === 'function'
  )
}

export function findVueModuleAdapter(
  module: Pick<IRModule, 'pluginId' | 'moduleType'>,
  registry: CompilerModuleRegistry = BUILTIN_VUE_MODULE_REGISTRY
): VueModuleAdapter | null {
  const candidate = registry.getTarget('vue', module.pluginId, module.moduleType)
  if (!isVueModuleAdapter(candidate)) return null
  if (candidate.pluginId !== module.pluginId || candidate.moduleType !== module.moduleType) {
    throw new Error(
      `Vue module adapter identity mismatch for ${module.pluginId}/${module.moduleType}`
    )
  }
  return candidate
}

export function supportsVueModule(module: Pick<IRModule, 'pluginId' | 'moduleType'>): boolean {
  return findVueModuleAdapter(module) !== null
}

function referencedModules(nodes: readonly IRNode[]): IRModule[] {
  const result = new Map<string, IRModule>()
  const visit = (node: IRNode): void => {
    if (node.kind === 'conditional') return visit(node.consequent)
    if (node.kind === 'list') return visit(node.template)
    if (node.kind === 'text' || node.kind === 'expression' || node.kind === 'componentRef') return
    if (node.module) result.set(`${node.module.pluginId}/${node.module.moduleType}`, node.module)
    node.children.forEach(visit)
  }
  nodes.forEach(visit)
  return [...result.values()].sort((left, right) =>
    `${left.pluginId}/${left.moduleType}`.localeCompare(`${right.pluginId}/${right.moduleType}`)
  )
}

function componentBodyNodes(definition: ComponentDef): readonly IRNode[] {
  return definition.variants
    ? [...definition.children, ...definition.variants.flatMap((variant) => variant.children)]
    : definition.children
}

function adaptersForNodes(nodes: readonly IRNode[]): VueModuleAdapter[] {
  return referencedModules(nodes).flatMap((module) => findVueModuleAdapter(module) ?? [])
}

export function buildVueModuleImports(nodes: readonly IRNode[]): string {
  return adaptersForNodes(nodes)
    .map((adapter) => `import ${adapter.componentName} from '${adapter.importPath}'`)
    .join('\n')
}

export function collectVueModuleProject(
  irNodes: readonly (readonly IRNode[])[],
  components: readonly ComponentDef[]
): VueModuleProjectContribution {
  const adapters = [
    ...irNodes.flatMap((nodes) => adaptersForNodes(nodes)),
    ...components.flatMap((definition) => adaptersForNodes(componentBodyNodes(definition)))
  ]
  const unique = new Map(
    adapters.map((adapter) => [`${adapter.pluginId}/${adapter.moduleType}`, adapter])
  )
  const ordered = [...unique.values()].sort((left, right) =>
    `${left.pluginId}/${left.moduleType}`.localeCompare(`${right.pluginId}/${right.moduleType}`)
  )
  const runtimePaths = new Set<string>()
  const componentNames = new Set<string>()
  for (const adapter of ordered) {
    if (runtimePaths.has(adapter.runtimePath)) {
      throw new Error(`Duplicate Vue module runtime path: ${adapter.runtimePath}`)
    }
    if (componentNames.has(adapter.componentName)) {
      throw new Error(`Duplicate Vue module component name: ${adapter.componentName}`)
    }
    runtimePaths.add(adapter.runtimePath)
    componentNames.add(adapter.componentName)
  }
  return {
    adapters: ordered,
    usesLayerRuntime: ordered.some((adapter) => adapter.usesLayerRuntime === true)
  }
}

export function emitVueModuleRuntimes(
  files: Map<string, string | Uint8Array>,
  contribution: VueModuleProjectContribution,
  options: { microfrontend?: boolean } = {}
): void {
  if (contribution.usesLayerRuntime) {
    if (files.has(VUE_LAYER_RUNTIME_PATH)) {
      throw new Error(
        `Vue module runtime would overwrite generated file: ${VUE_LAYER_RUNTIME_PATH}`
      )
    }
    files.set(VUE_LAYER_RUNTIME_PATH, buildVueLayerRuntime())
  }
  for (const adapter of contribution.adapters) {
    if (files.has(adapter.runtimePath)) {
      throw new Error(`Vue module runtime would overwrite generated file: ${adapter.runtimePath}`)
    }
    files.set(adapter.runtimePath, adapter.buildRuntime(options))
  }
}
