export interface VueModuleRuntimeOptions {
  microfrontend?: boolean
}

export interface VueModuleAdapter {
  readonly pluginId: string
  readonly moduleType: string
  readonly componentName: string
  readonly runtimePath: string
  readonly importPath: string
  readonly usesLayerRuntime?: boolean
  buildRuntime(options?: VueModuleRuntimeOptions): string
}

export interface VueModuleProjectContribution {
  readonly adapters: readonly VueModuleAdapter[]
  readonly usesLayerRuntime: boolean
}
