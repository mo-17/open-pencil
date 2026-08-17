import { BrowserPreviewAssetRegistry } from './assets'
import type { BrowserPreviewCSSSource } from './css'
import {
  buildBrowserPreviewImportMap,
  readBrowserPreviewDependencyPolicy,
  type BrowserPreviewDependencyPolicy
} from './dependencies'
import { BrowserPreviewBuildError, failBrowserPreview } from './error'
import { buildBrowserPreviewHTML } from './html'
import { BROWSER_PREVIEW_LIMITS } from './limits'
import { dirname, extension, joinRelativePath } from './path'
import { prepareBrowserPreviewReactFiles } from './routing'
import {
  hasBrowserDynamicImport,
  isSafeBrowserPackageSpecifier,
  validateBrowserPreviewInput
} from './source-security'
import { buildBrowserPreviewCSS } from './tailwind'
import type {
  BrowserPreviewBuildInput,
  BrowserPreviewBuildResult,
  BrowserPreviewDiagnostic,
  BrowserPreviewEsbuild,
  BrowserPreviewEsbuildBuildResult,
  BrowserPreviewEsbuildMessage,
  BrowserPreviewMetrics,
  BrowserPreviewTarget
} from './types'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const ENTRY_PATH = '__openpencil_browser_preview_entry.ts'
const VFS_NAMESPACE = 'openpencil-browser-preview-vfs'
const SOURCE_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js', '.json', '.css'] as const
const REMOTE_RUNTIME_PATHS = Object.freeze([
  'src/_lowcode_supabase.ts',
  'src/_lowcode_server.ts',
  'src/_lowcode_analytics.ts'
])

let defaultEsbuildPromise: Promise<BrowserPreviewEsbuild> | undefined
let initializedEsbuild: BrowserPreviewEsbuild | undefined
let initializedWasmURL: string | undefined
let initializePromise: Promise<void> | undefined

function now(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

function duration(startedAt: number): number {
  return Math.max(0, Math.round((now() - startedAt) * 100) / 100)
}

function baseMetrics(
  startedAt: number,
  inputBytes: number,
  fileCount: number,
  assetCount: number,
  dependencyCount: number,
  outputBytes = 0
): BrowserPreviewMetrics {
  return {
    durationMs: duration(startedAt),
    inputBytes,
    outputBytes,
    fileCount,
    dependencyCount,
    assetCount
  }
}

function isEsbuild(value: unknown): value is BrowserPreviewEsbuild {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Readonly<{ build?: unknown }>).build === 'function'
  )
}

async function loadDefaultEsbuild(): Promise<BrowserPreviewEsbuild> {
  defaultEsbuildPromise ??= import('esbuild-wasm').then((value: unknown) => {
    if (!isEsbuild(value)) {
      failBrowserPreview(
        'browser-preview-esbuild-unavailable',
        'Browser preview could not load the reviewed esbuild-wasm runtime.'
      )
    }
    return value
  })
  return defaultEsbuildPromise
}

async function initializeBrowserEsbuild(
  esbuild: BrowserPreviewEsbuild,
  wasmURL: string
): Promise<void> {
  if (!esbuild.initialize) return
  if (initializedEsbuild && (initializedEsbuild !== esbuild || initializedWasmURL !== wasmURL)) {
    failBrowserPreview(
      'browser-preview-esbuild-initialization-conflict',
      'Browser preview esbuild-wasm was already initialized with a different runtime.'
    )
  }
  initializedEsbuild = esbuild
  initializedWasmURL = wasmURL
  initializePromise ??= esbuild.initialize({ wasmURL, worker: false })
  await initializePromise
}

function lookupFile(files: ReadonlyMap<string, string | Uint8Array>, stem: string): string | null {
  if (files.has(stem)) return stem
  for (const suffix of SOURCE_EXTENSIONS) {
    if (files.has(stem + suffix)) return stem + suffix
  }
  for (const suffix of SOURCE_EXTENSIONS) {
    const candidate = `${stem}/index${suffix}`
    if (files.has(candidate)) return candidate
  }
  return null
}

function assertBrowserRuntimeCapabilities(
  files: ReadonlyMap<string, string | Uint8Array>,
  policy: BrowserPreviewDependencyPolicy
): void {
  const remoteRuntime = REMOTE_RUNTIME_PATHS.find((path) => files.has(path))
  if (remoteRuntime) {
    failBrowserPreview(
      'browser-preview-network-runtime-unsupported',
      'Browser preview blocks generated Supabase, server workflow, and analytics networking.',
      remoteRuntime
    )
  }
  if (policy.declared['lottie-web']) {
    const usesRemoteLottie = [...files.values()].some(
      (value) => typeof value === 'string' && /\bsource\s*:\s*["']url["']/.test(value)
    )
    if (usesRemoteLottie) {
      failBrowserPreview(
        'browser-preview-lottie-network-unsupported',
        'Browser preview supports embedded Lottie JSON but blocks URL-backed animation data.'
      )
    }
  }
}

function assertNoDynamicSourceImports(files: ReadonlyMap<string, string | Uint8Array>): void {
  for (const [path, content] of files) {
    if (
      typeof content === 'string' &&
      ['.tsx', '.ts', '.jsx', '.js'].includes(extension(path)) &&
      hasBrowserDynamicImport(content)
    ) {
      failBrowserPreview(
        'browser-preview-dynamic-import-unsupported',
        'Browser preview blocks dynamic import expressions.',
        path
      )
    }
  }
}

function loader(path: string): 'js' | 'jsx' | 'ts' | 'tsx' | 'json' {
  const ext = extension(path)
  if (ext === '.tsx') return 'tsx'
  if (ext === '.jsx') return 'jsx'
  if (ext === '.ts' || path === ENTRY_PATH) return 'ts'
  if (ext === '.json') return 'json'
  if (ext === '.js') return 'js'
  return failBrowserPreview(
    'browser-preview-source-type-unsupported',
    'Browser preview blocked an unsupported source module type.',
    path
  )
}

async function bundleReactProject(
  esbuild: BrowserPreviewEsbuild,
  files: ReadonlyMap<string, string | Uint8Array>,
  assets: BrowserPreviewAssetRegistry,
  externalSpecifiers: Set<string>,
  cssSources: BrowserPreviewCSSSource[]
): Promise<BrowserPreviewEsbuildBuildResult> {
  return esbuild.build({
    entryPoints: [ENTRY_PATH],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: ['es2022'],
    jsx: 'automatic',
    jsxImportSource: 'react',
    outfile: 'openpencil-browser-preview.js',
    logLevel: 'silent',
    minify: true,
    sourcemap: false,
    treeShaking: true,
    packages: 'external',
    define: {
      'import.meta.env.BASE_URL': JSON.stringify('/'),
      'import.meta.env.VITE_SUPABASE_URL': 'undefined',
      'import.meta.env.VITE_SUPABASE_ANON_KEY': 'undefined',
      'import.meta.env.VITE_SUPABASE_SCHEMA': 'undefined',
      'process.env.NODE_ENV': JSON.stringify('production')
    },
    plugins: [
      {
        name: 'openpencil-browser-preview-vfs',
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, (args) => {
            const source = args.path
            if (!args.importer && source === ENTRY_PATH) {
              return { path: ENTRY_PATH, namespace: VFS_NAMESPACE }
            }
            if (args.namespace !== VFS_NAMESPACE) return undefined
            if (args.kind === 'dynamic-import') {
              failBrowserPreview(
                'browser-preview-dynamic-import-unsupported',
                'Browser preview blocks dynamic import expressions.',
                args.importer
              )
            }
            if (!source.startsWith('.') && !source.startsWith('@/')) {
              if (!isSafeBrowserPackageSpecifier(source)) {
                failBrowserPreview(
                  'browser-preview-import-invalid',
                  'Browser preview blocked an unsafe import specifier.',
                  args.importer
                )
              }
              externalSpecifiers.add(source)
              return { path: source, external: true }
            }
            const unresolved = source.startsWith('@/')
              ? `src/${source.slice(2)}`
              : joinRelativePath(dirname(args.importer), source)
            if (!unresolved) {
              failBrowserPreview(
                'browser-preview-import-invalid',
                'Browser preview blocked an import escaping the virtual project.',
                args.importer
              )
            }
            const resolved = lookupFile(files, unresolved)
            if (!resolved) {
              failBrowserPreview(
                'browser-preview-local-import-missing',
                'Browser preview generated local import is missing.',
                args.importer
              )
            }
            return { path: resolved, namespace: VFS_NAMESPACE }
          })
          builder.onLoad({ filter: /.*/, namespace: VFS_NAMESPACE }, (args) => {
            if (args.path === ENTRY_PATH) {
              return { contents: "import './src/main.tsx'\n", loader: 'ts' }
            }
            const content = files.get(args.path)
            if (content === undefined) {
              failBrowserPreview(
                'browser-preview-source-missing',
                'Browser preview virtual source disappeared during bundling.',
                args.path
              )
            }
            if (content instanceof Uint8Array) {
              const dataURL = assets.dataURL(args.path, content)
              return { contents: `export default ${JSON.stringify(dataURL)}\n`, loader: 'js' }
            }
            if (extension(args.path) === '.css') {
              cssSources.push({ path: args.path, content })
              return { contents: 'export {}\n', loader: 'js' }
            }
            return { contents: content, loader: loader(args.path) }
          })
        }
      }
    ]
  })
}

function esbuildDiagnostic(
  code: string,
  severity: 'warning' | 'error',
  value: BrowserPreviewEsbuildMessage
): BrowserPreviewDiagnostic {
  const location = value.location
  return {
    code,
    severity,
    message: value.text.slice(0, 1_000),
    ...(location?.file ? { path: location.file } : {}),
    ...(location?.line && location.line > 0 ? { line: location.line } : {}),
    ...(location?.column !== undefined && location.column >= 0
      ? { column: location.column + 1 }
      : {})
  }
}

function readJavaScript(result: BrowserPreviewEsbuildBuildResult): string {
  if (result.errors && result.errors.length > 0) {
    throw new BrowserPreviewBuildError(
      result.errors.map((error) =>
        esbuildDiagnostic('browser-preview-bundle-error', 'error', error)
      )
    )
  }
  const outputFiles = result.outputFiles ?? []
  if (outputFiles.length !== 1) {
    failBrowserPreview(
      'browser-preview-bundle-output-invalid',
      'Browser preview bundler returned an unexpected output file set.'
    )
  }
  const output = outputFiles[0]
  const javascript = typeof output.text === 'string' ? output.text : decoder.decode(output.contents)
  if (encoder.encode(javascript).byteLength > BROWSER_PREVIEW_LIMITS.maxJavaScriptBytes) {
    failBrowserPreview(
      'browser-preview-javascript-output-limit',
      'Browser preview JavaScript exceeds the output byte limit.'
    )
  }
  return javascript
}

function diagnosticsFromError(error: unknown): BrowserPreviewDiagnostic[] {
  if (error instanceof BrowserPreviewBuildError) return [...error.diagnostics]
  if (typeof error === 'object' && error !== null) {
    const candidate = error as Readonly<{
      diagnostics?: unknown
      errors?: readonly Readonly<{ text?: unknown; detail?: unknown }>[]
    }>
    if (Array.isArray(candidate.diagnostics)) {
      const diagnostics = candidate.diagnostics.filter(isDiagnostic)
      if (diagnostics.length > 0) return diagnostics
    }
    for (const item of candidate.errors ?? []) {
      if (item.detail instanceof BrowserPreviewBuildError) return [...item.detail.diagnostics]
    }
    const messages = (candidate.errors ?? [])
      .filter(
        (item): item is Readonly<{ text: string; detail?: unknown }> =>
          typeof item.text === 'string'
      )
      .slice(0, BROWSER_PREVIEW_LIMITS.maxDiagnostics)
      .map((item) => ({
        code: 'browser-preview-bundle-error',
        severity: 'error' as const,
        message: item.text.slice(0, 1_000)
      }))
    if (messages.length > 0) return messages
  }
  return [
    {
      code: 'browser-preview-build-failed',
      severity: 'error',
      message: 'Browser preview build failed inside the isolated bundler.'
    }
  ]
}

function isDiagnostic(value: unknown): value is BrowserPreviewDiagnostic {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Readonly<{
    code?: unknown
    severity?: unknown
    message?: unknown
  }>
  return (
    typeof candidate.code === 'string' &&
    (candidate.severity === 'warning' || candidate.severity === 'error') &&
    typeof candidate.message === 'string'
  )
}

export async function buildBrowserPreview(
  input: BrowserPreviewBuildInput
): Promise<BrowserPreviewBuildResult> {
  const startedAt = now()
  let inputBytes = 0
  let assetCount = 0
  let dependencyCount = 0
  const fileCount = input.files instanceof Map ? input.files.size : 0
  const target: BrowserPreviewTarget = input.target === 'vue' ? 'vue' : 'react'
  try {
    input.onStage?.('bundle-validate')
    const validated = validateBrowserPreviewInput(input)
    inputBytes = validated.inputBytes
    assetCount = validated.assetCount
    if (input.target === 'vue') {
      const reason = {
        code: 'browser-preview-vue-unsupported',
        message:
          'Vue browser preview is not available in v1 because its SFC compiler is not yet inside the reviewed Worker boundary.'
      }
      return {
        status: 'unsupported',
        target: 'vue',
        reason,
        diagnostics: [{ ...reason, severity: 'warning' }],
        metrics: baseMetrics(startedAt, inputBytes, fileCount, assetCount, 0)
      }
    }
    const prepared = prepareBrowserPreviewReactFiles(validated.files, input.channel)
    assertNoDynamicSourceImports(prepared.files)
    const dependencyPolicy = readBrowserPreviewDependencyPolicy(prepared.files)
    dependencyCount = Object.keys(dependencyPolicy.declared).length
    assertBrowserRuntimeCapabilities(prepared.files, dependencyPolicy)
    const assets = new BrowserPreviewAssetRegistry(prepared.files)
    input.onStage?.('bundle-load')
    const esbuild = input.esbuild ?? (await loadDefaultEsbuild())
    input.onStage?.('bundle-initialize')
    await initializeBrowserEsbuild(esbuild, input.wasmURL)
    const externalSpecifiers = new Set<string>()
    const cssSources: BrowserPreviewCSSSource[] = []
    input.onStage?.('bundle-javascript')
    const bundled = await bundleReactProject(
      esbuild,
      prepared.files,
      assets,
      externalSpecifiers,
      cssSources
    )
    const javascript = readJavaScript(bundled)
    const importMap = buildBrowserPreviewImportMap(dependencyPolicy, externalSpecifiers)
    input.onStage?.('bundle-css')
    const builtCSS = await buildBrowserPreviewCSS(input, cssSources, prepared.files, assets)
    const diagnostics = [
      ...prepared.diagnostics,
      ...importMap.diagnostics,
      ...builtCSS.diagnostics,
      ...(bundled.warnings ?? []).map((warning) =>
        esbuildDiagnostic('browser-preview-bundle-warning', 'warning', warning)
      )
    ].slice(0, BROWSER_PREVIEW_LIMITS.maxDiagnostics)
    input.onStage?.('bundle-html')
    const html = buildBrowserPreviewHTML({
      channel: input.channel,
      javascript,
      css: builtCSS.css,
      imports: importMap.imports,
      reviewedDataURLBytes: builtCSS.reviewedDataURLBytes
    })
    const outputBytes = encoder.encode(html).byteLength
    return {
      status: 'ready',
      target: 'react',
      html,
      diagnostics,
      metrics: baseMetrics(
        startedAt,
        inputBytes,
        fileCount,
        assetCount,
        dependencyCount,
        outputBytes
      )
    }
  } catch (error) {
    return {
      status: 'error',
      target,
      diagnostics: diagnosticsFromError(error).slice(0, BROWSER_PREVIEW_LIMITS.maxDiagnostics),
      metrics: baseMetrics(startedAt, inputBytes, fileCount, assetCount, dependencyCount)
    }
  }
}
