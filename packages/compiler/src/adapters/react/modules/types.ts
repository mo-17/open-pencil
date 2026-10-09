import type { EffectPickCatalogEntry } from '@open-pencil/core/plugins'

export interface ReactModuleRuntimeOptions {
  devMode: boolean
  /** Paths emitted from graph-owned bytes before module runtime generation. */
  bundledAssetPaths?: readonly string[]
  effectPickArtifacts?: readonly EffectPickCatalogEntry[]
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
  effectPickArtifacts?: readonly EffectPickCatalogEntry[]
  adapters: readonly ReactModuleAdapter[]
  dependencies: Record<string, string>
}
