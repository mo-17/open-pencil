export interface ReactModuleRuntimeOptions {
  devMode: boolean
  microfrontend?: boolean
}

export interface ReactModuleAdapter {
  pluginId: string
  moduleType: string
  componentName: string
  runtimePath: string
  rootImportPath: string
  nestedImportPath: string
  dependencies?: Readonly<Record<string, string>>
  optimizeDeps?: readonly string[]
  buildRuntime(options: ReactModuleRuntimeOptions): string
}

export interface ReactModuleProjectContribution {
  adapters: readonly ReactModuleAdapter[]
  dependencies: Record<string, string>
}
