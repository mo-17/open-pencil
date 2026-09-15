export interface VueModuleRuntimeOptions {
  devMode?: boolean
  microfrontend?: boolean
}

export interface VueModuleAdapter {
  readonly pluginId: string
  readonly moduleType: string
  readonly componentName: string
  readonly runtimePath: string
  readonly importPath: string
  readonly usesLayerRuntime?: boolean
  readonly dependencies?: Readonly<Record<string, string>>
  readonly optimizeDeps?: readonly string[]
  buildRuntime(options?: VueModuleRuntimeOptions): string
}

export interface VueModuleProjectContribution {
  readonly adapters: readonly VueModuleAdapter[]
  readonly usesLayerRuntime: boolean
  readonly dependencies: Readonly<Record<string, string>>
}
