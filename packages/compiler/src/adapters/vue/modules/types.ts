export interface VueModuleAdapter {
  readonly pluginId: string
  readonly moduleType: string
  readonly componentName: string
  readonly runtimePath: string
  readonly importPath: string
  readonly usesLayerRuntime?: boolean
  buildRuntime(): string
}

export interface VueModuleProjectContribution {
  readonly adapters: readonly VueModuleAdapter[]
  readonly usesLayerRuntime: boolean
}
