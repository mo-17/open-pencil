import type { EffectPickCatalogEntry } from '@open-pencil/core/plugins'

export interface VueModuleRuntimeOptions {
  devMode?: boolean
  /** Paths emitted from graph-owned bytes before module runtime generation. */
  bundledAssetPaths?: readonly string[]
  effectPickArtifacts?: readonly EffectPickCatalogEntry[]
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
  effectPickArtifacts?: readonly EffectPickCatalogEntry[]
  readonly adapters: readonly VueModuleAdapter[]
  readonly usesLayerRuntime: boolean
  readonly dependencies: Readonly<Record<string, string>>
}
