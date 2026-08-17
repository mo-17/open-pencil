export type BrowserPreviewTarget = 'react' | 'vue'

export type BrowserPreviewDiagnosticSeverity = 'warning' | 'error'

export interface BrowserPreviewDiagnostic {
  code: string
  severity: BrowserPreviewDiagnosticSeverity
  message: string
  path?: string
  line?: number
  column?: number
}

export interface BrowserPreviewMetrics {
  durationMs: number
  inputBytes: number
  outputBytes: number
  fileCount: number
  dependencyCount: number
  assetCount: number
}

export interface BrowserPreviewUnsupportedReason {
  code: string
  message: string
}

export interface BrowserPreviewEsbuildLocation {
  file?: string
  line?: number
  column?: number
}

export interface BrowserPreviewEsbuildMessage {
  text: string
  location?: BrowserPreviewEsbuildLocation | null
}

export interface BrowserPreviewEsbuildOutputFile {
  path: string
  contents?: Uint8Array
  text?: string
}

export interface BrowserPreviewEsbuildBuildResult {
  errors?: readonly BrowserPreviewEsbuildMessage[]
  warnings?: readonly BrowserPreviewEsbuildMessage[]
  outputFiles?: readonly BrowserPreviewEsbuildOutputFile[]
}

export interface BrowserPreviewEsbuildResolveArgs {
  path: string
  importer: string
  namespace: string
  kind: string
}

export interface BrowserPreviewEsbuildLoadArgs {
  path: string
  namespace: string
}

export interface BrowserPreviewEsbuildResolveResult {
  path?: string
  namespace?: string
  external?: boolean
}

export interface BrowserPreviewEsbuildLoadResult {
  contents: string
  loader: 'js' | 'jsx' | 'ts' | 'tsx' | 'json'
}

export interface BrowserPreviewEsbuildPluginBuilder {
  onResolve(
    options: Readonly<{ filter: RegExp; namespace?: string }>,
    callback: (
      args: BrowserPreviewEsbuildResolveArgs
    ) =>
      | BrowserPreviewEsbuildResolveResult
      | undefined
      | Promise<BrowserPreviewEsbuildResolveResult | undefined>
  ): void
  onLoad(
    options: Readonly<{ filter: RegExp; namespace?: string }>,
    callback: (
      args: BrowserPreviewEsbuildLoadArgs
    ) =>
      | BrowserPreviewEsbuildLoadResult
      | undefined
      | Promise<BrowserPreviewEsbuildLoadResult | undefined>
  ): void
}

export interface BrowserPreviewEsbuildPlugin {
  name: string
  setup(builder: BrowserPreviewEsbuildPluginBuilder): void
}

export interface BrowserPreviewEsbuildBuildOptions {
  entryPoints: readonly string[]
  bundle: true
  write: false
  format: 'esm'
  platform: 'browser'
  target: readonly string[]
  jsx: 'automatic'
  jsxImportSource: 'react'
  outfile: string
  logLevel: 'silent'
  minify: true
  sourcemap: false
  treeShaking: true
  packages: 'external'
  define: Readonly<Record<string, string>>
  plugins: readonly BrowserPreviewEsbuildPlugin[]
}

export interface BrowserPreviewEsbuild {
  initialize?(options: Readonly<{ wasmURL: string; worker: boolean }>): Promise<void>
  build(options: BrowserPreviewEsbuildBuildOptions): Promise<BrowserPreviewEsbuildBuildResult>
}

export interface BrowserPreviewTailwindCompiler {
  build(candidates: readonly string[]): string
}

export type BrowserPreviewTailwindCompile = (
  source: string,
  options: Readonly<{
    loadStylesheet: (
      id: string,
      base: string
    ) => Promise<Readonly<{ path: string; base: string; content: string }>>
  }>
) => Promise<BrowserPreviewTailwindCompiler>

export type BrowserPreviewBuildStage =
  | 'bundle-validate'
  | 'bundle-load'
  | 'bundle-initialize'
  | 'bundle-javascript'
  | 'bundle-css'
  | 'bundle-html'

export interface BrowserPreviewBuildInput {
  files: ReadonlyMap<string, string | Uint8Array>
  target: BrowserPreviewTarget
  wasmURL: string
  channel: string
  /** Test seam. Production callers should use the default `esbuild-wasm` implementation. */
  esbuild?: BrowserPreviewEsbuild
  /** Test seam for Bun, whose module loader does not implement Vite's `?raw` CSS query. */
  tailwindStylesheet?: string
  /** Test seam; production uses Tailwind 4's browser-safe compiler core. */
  tailwindCompile?: BrowserPreviewTailwindCompile
  /** Host-only progress hook. Generated project code never receives this callback. */
  onStage?: (stage: BrowserPreviewBuildStage) => void
}

export type BrowserPreviewBuildResult =
  | Readonly<{
      status: 'ready'
      target: 'react'
      html: string
      diagnostics: readonly BrowserPreviewDiagnostic[]
      metrics: BrowserPreviewMetrics
    }>
  | Readonly<{
      status: 'unsupported'
      target: BrowserPreviewTarget
      reason: BrowserPreviewUnsupportedReason
      diagnostics: readonly BrowserPreviewDiagnostic[]
      metrics: BrowserPreviewMetrics
    }>
  | Readonly<{
      status: 'error'
      target: BrowserPreviewTarget
      diagnostics: readonly BrowserPreviewDiagnostic[]
      metrics: BrowserPreviewMetrics
    }>
