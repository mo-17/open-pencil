/* eslint-disable max-lines -- Browser bundling and final Prefill auditing share one trust boundary. */
import { Buffer } from 'node:buffer'
import { posix } from 'node:path'

import { compileScript, compileStyle, parse } from '#vue-compiler-sfc-browser'
import { compile as compileTailwind } from 'tailwindcss'

import { findCodePenSecretKinds } from '@open-pencil/core/lowcode-validation'

import {
  CodePenCSSAssetError,
  assertCodePenBinaryAssetBudget,
  codePenAssetDataURL,
  rewriteCodePenCSSAssetURLs,
  type CodePenCSSSource
} from './css-assets'
import { containsDynamicImport, isSafeBarePackageSpecifier } from './import-guard'
import { isCodePenServerArtifact, projectPolicyDiagnostics } from './project-policy'
import {
  CODEPEN_SIDECAR_LIMITS,
  type CodePenSidecarDiagnostic,
  type CodePenSidecarPrefillData,
  type CodePenSidecarRequest,
  type CodePenSidecarSuccessResult
} from './protocol'
import { applyCodePenRoutingFallback, type CodePenRoutingStatus } from './routing'
import {
  CodePenTailwindCandidateError,
  CodePenTailwindDirectiveError,
  extractCodePenTailwindCandidates,
  stripCodePenTailwindDirectives
} from './tailwind-candidates'

import tailwindStylesheet from 'tailwindcss/index.css' with { type: 'text' }

const encoder = new TextEncoder()
const binaryDecoder = new TextDecoder('latin1')
const ENTRY_PATH = '__openpencil_codepen_entry.ts'
const VFS_NAMESPACE = 'openpencil-codepen-vfs'
const EXTERNAL_STYLE_NAMESPACE = 'openpencil-codepen-external-style'
const MAPLIBRE_STYLE_SPECIFIER = 'maplibre-gl/dist/maplibre-gl.css'
const MAPLIBRE_STYLE_URL = 'https://cdn.jsdelivr.net/npm/maplibre-gl@6.0.0/dist/maplibre-gl.css'
const ALLOWED_SOURCE_EXTENSIONS = ['.vue', '.tsx', '.ts', '.jsx', '.js', '.json', '.css'] as const

interface ExternalPin {
  version: string
  declaration: string | readonly string[]
}

const COMMON_EXTERNAL_PINS: Readonly<Record<string, ExternalPin>> = Object.freeze({
  'react-router-dom': { version: '6.27.0', declaration: '^6.27.0' },
  '@supabase/supabase-js': { version: '2.100.0', declaration: '^2.100.0' },
  'react-intl': { version: '7.1.0', declaration: '^7.1.0' },
  zustand: { version: '5.0.0', declaration: '^5.0.0' },
  clsx: { version: '2.1.1', declaration: '^2.1.1' },
  'tailwind-merge': { version: '2.5.5', declaration: '^2.5.5' },
  'class-variance-authority': { version: '0.7.1', declaration: '^0.7.1' },
  '@radix-ui/react-slot': { version: '1.1.1', declaration: '^1.1.1' },
  '@radix-ui/react-label': { version: '2.1.1', declaration: '^2.1.1' },
  '@radix-ui/react-checkbox': { version: '1.1.3', declaration: '^1.1.3' },
  '@radix-ui/react-switch': { version: '1.1.2', declaration: '^1.1.2' },
  '@radix-ui/react-radio-group': { version: '1.2.2', declaration: '^1.2.2' },
  '@radix-ui/react-select': { version: '2.1.4', declaration: '^2.1.4' },
  '@radix-ui/react-avatar': { version: '1.2.0', declaration: '^1.2.0' },
  '@radix-ui/react-progress': { version: '1.1.10', declaration: '^1.1.10' },
  '@radix-ui/react-separator': { version: '1.1.10', declaration: '^1.1.10' },
  '@radix-ui/react-tabs': { version: '1.1.12', declaration: '^1.1.12' },
  '@radix-ui/react-accordion': { version: '1.2.11', declaration: '^1.2.11' },
  'lucide-react': { version: '1.21.0', declaration: '^1.21.0' },
  'react-markdown': { version: '10.1.0', declaration: '10.1.0' },
  'remark-gfm': { version: '4.0.1', declaration: '4.0.1' },
  'lottie-web': { version: '5.13.0', declaration: '5.13.0' },
  jsbarcode: { version: '3.12.3', declaration: '3.12.3' },
  qrcode: { version: '1.5.4', declaration: '1.5.4' },
  'maplibre-gl': { version: '6.0.0', declaration: '6.0.0' }
})

const REACT_PINS: Readonly<Record<string, ExternalPin>> = Object.freeze({
  react: { version: '19.2.0', declaration: '^19.2.0' },
  'react-dom': { version: '19.2.0', declaration: '^19.2.0' }
})

const REACT_18_PINS: Readonly<Record<string, ExternalPin>> = Object.freeze({
  react: { version: '18.3.1', declaration: '^18.3.1' },
  'react-dom': { version: '18.3.1', declaration: '^18.3.1' }
})

const VUE_PINS: Readonly<Record<string, ExternalPin>> = Object.freeze({
  vue: { version: '3.5.29', declaration: '^3.5.29' },
  'vue-router': { version: '4.6.4', declaration: '^4.6.4' }
})

function byteLength(value: string): number {
  return encoder.encode(value).byteLength
}

function comparePath(left: string, right: string): number {
  return left < right ? -1 : Number(left > right)
}

function packageBase(specifier: string): string {
  if (specifier.startsWith('@')) return specifier.split('/').slice(0, 2).join('/')
  return specifier.split('/')[0]
}

function assertNoVariableDynamicImport(source: string): void {
  if (containsDynamicImport(source)) {
    rejectRuntime('unsafe-import', 'CodePen export blocked: dynamic imports are not supported')
  }
}

function assertSafeSourceImports(files: ReadonlyMap<string, string | Uint8Array>): void {
  for (const [path, source] of files) {
    if (
      typeof source !== 'string' ||
      (path !== ENTRY_PATH && !path.startsWith('src/')) ||
      !['.vue', '.tsx', '.ts', '.jsx', '.js'].includes(posix.extname(path))
    ) {
      continue
    }
    assertNoVariableDynamicImport(source)
    if (path.endsWith('.vue')) continue
    const scanner = new Bun.Transpiler({
      loader: path.endsWith('.tsx') || path.endsWith('.jsx') ? 'tsx' : 'ts'
    })
    for (const record of scanner.scanImports(source)) {
      const specifier = record.path
      if (specifier.startsWith('.')) continue
      if (specifier.startsWith('@/')) {
        const segments = specifier.slice(2).split('/')
        if (
          segments.some((segment) => segment === '' || segment === '.' || segment === '..') ||
          specifier.includes('?') ||
          specifier.includes('#') ||
          specifier.includes('\\')
        ) {
          rejectRuntime('unsafe-import', 'CodePen export blocked: a local import path is unsafe')
        }
        continue
      }
      if (!isSafeBarePackageSpecifier(specifier)) {
        rejectRuntime('unsafe-import', 'CodePen export blocked: an import specifier is unsafe')
      }
    }
  }
}

function packageManifest(request: CodePenSidecarRequest): Record<string, unknown> {
  const source = request.files.find((file) => file.path === 'package.json')?.content
  if (typeof source !== 'string') throw new Error('package manifest unavailable')
  const value = JSON.parse(source) as unknown
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('package manifest invalid')
  }
  return Object.fromEntries(Object.entries(value))
}

function dependencies(request: CodePenSidecarRequest): Record<string, string> {
  const candidate = packageManifest(request).dependencies
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) return {}
  const output: Record<string, string> = {}
  for (const [name, value] of Object.entries(candidate)) {
    if (typeof value === 'string') output[name] = value
  }
  return output
}

function pinsFor(request: CodePenSidecarRequest): Readonly<Partial<Record<string, ExternalPin>>> {
  if (request.target === 'vue') return Object.freeze({ ...COMMON_EXTERNAL_PINS, ...VUE_PINS })
  const reactDeclaration = dependencies(request).react
  const reactPins = reactDeclaration === '^18.3.1' ? REACT_18_PINS : REACT_PINS
  return Object.freeze({ ...COMMON_EXTERNAL_PINS, ...reactPins })
}

function declarationMatches(
  actual: string | undefined,
  expected: string | readonly string[]
): boolean {
  if (actual === undefined) return false
  return typeof expected === 'string' ? actual === expected : expected.includes(actual)
}

function peerQuery(request: CodePenSidecarRequest, base: string): string {
  if (request.target === 'vue') {
    return base === 'vue-router' ? `?deps=${encodeURIComponent('vue@3.5.29')}` : ''
  }
  const version = dependencies(request).react === '^18.3.1' ? '18.3.1' : '19.2.0'
  if (base === 'react') return ''
  if (base === 'react-dom') return `?deps=${encodeURIComponent(`react@${version}`)}`
  return `?deps=${encodeURIComponent(`react@${version},react-dom@${version}`)}`
}

function externalURL(request: CodePenSidecarRequest, specifier: string, pin: ExternalPin): string {
  const base = packageBase(specifier)
  const subpath = specifier === base ? '' : specifier.slice(base.length)
  return `https://esm.sh/${base}@${pin.version}${subpath}${peerQuery(request, base)}`
}

function lookupFile(files: ReadonlyMap<string, string | Uint8Array>, stem: string): string | null {
  if (files.has(stem)) return stem
  for (const extension of ALLOWED_SOURCE_EXTENSIONS) {
    if (files.has(stem + extension)) return stem + extension
  }
  for (const extension of ALLOWED_SOURCE_EXTENSIONS) {
    const path = `${stem}/index${extension}`
    if (files.has(path)) return path
  }
  return null
}

function sourceFiles(request: CodePenSidecarRequest): {
  files: Map<string, string | Uint8Array>
  routingStatus: CodePenRoutingStatus
} {
  const files = new Map(
    [...request.files]
      .filter((file) => !isCodePenServerArtifact(file.path))
      .sort((left, right) => comparePath(left.path, right.path))
      .map((file) => [file.path, file.content] as const)
  )
  const routePath = request.target === 'vue' ? 'src/router.ts' : 'src/App.tsx'
  const routeSource = files.get(routePath)
  let routingStatus: CodePenRoutingStatus = 'none'
  if (typeof routeSource === 'string') {
    const routed = applyCodePenRoutingFallback(routeSource, request.target)
    files.set(routePath, routed.source)
    routingStatus = routed.status
  }
  files.set(
    ENTRY_PATH,
    request.target === 'vue' ? `import './src/main.ts'\n` : `import './src/main.tsx'\n`
  )
  return { files, routingStatus }
}

function compileVueSource(path: string, source: string, styles: CodePenCSSSource[]): string {
  const id = Buffer.from(path).toString('hex').slice(0, 32)
  const parsed = parse(source, { filename: path })
  if (parsed.errors.length > 0) throw new Error('Vue SFC parse failed')
  for (const style of parsed.descriptor.styles) {
    if (style.src || style.module || style.lang) throw new Error('Unsupported Vue SFC style')
    const compiled = compileStyle({
      filename: path,
      id,
      source: style.content,
      scoped: style.scoped
    })
    if (compiled.errors.length > 0) throw new Error('Vue SFC style compilation failed')
    styles.push({ path, content: compiled.code })
  }
  if (!parsed.descriptor.script && !parsed.descriptor.scriptSetup) {
    const template = parsed.descriptor.template?.content ?? ''
    return `import { defineComponent as __defineComponent } from 'vue'\nexport default __defineComponent({ template: ${JSON.stringify(template)} })\n`
  }
  return compileScript(parsed.descriptor, {
    id,
    inlineTemplate: true,
    templateOptions: { compilerOptions: { isCustomElement: () => false } }
  }).content
}

interface BrowserBundle {
  js: string
  cssSources: CodePenCSSSource[]
  externalStylesheets: string[]
}

async function buildBrowserBundle(
  files: ReadonlyMap<string, string | Uint8Array>
): Promise<BrowserBundle> {
  const cssSources: CodePenCSSSource[] = []
  const externalStylesheets: string[] = []
  const build = await Bun.build({
    entrypoints: [ENTRY_PATH],
    target: 'browser',
    format: 'esm',
    packages: 'external',
    define: {
      'import.meta.env.BASE_URL': JSON.stringify('/'),
      'import.meta.env.VITE_SUPABASE_URL': 'undefined',
      'import.meta.env.VITE_SUPABASE_ANON_KEY': 'undefined',
      'import.meta.env.VITE_SUPABASE_SCHEMA': 'undefined',
      'process.env.NODE_ENV': JSON.stringify('production')
    },
    minify: true,
    sourcemap: 'none',
    plugins: [
      {
        name: 'openpencil-codepen-vfs',
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, ({ path: source, importer }) => {
            if (source === ENTRY_PATH && !importer) {
              return { path: ENTRY_PATH, namespace: VFS_NAMESPACE }
            }
            if (source === MAPLIBRE_STYLE_SPECIFIER) {
              externalStylesheets.push(MAPLIBRE_STYLE_URL)
              return { path: source, namespace: EXTERNAL_STYLE_NAMESPACE }
            }
            if (
              source.startsWith('/') ||
              source.includes(':') ||
              source.includes('?') ||
              source.includes('#')
            ) {
              rejectRuntime(
                'unsafe-import',
                'CodePen export blocked: an import specifier is unsafe'
              )
            }
            if (!source.startsWith('.') && !source.startsWith('/') && !source.startsWith('@/')) {
              return undefined
            }
            let candidate: string
            if (source.startsWith('@/')) candidate = `src/${source.slice(2)}`
            else if (source.startsWith('/')) candidate = source.slice(1)
            else candidate = posix.normalize(posix.join(posix.dirname(importer), source))
            const found = lookupFile(files, candidate)
            if (!found) {
              rejectRuntime(
                'missing-local-import',
                'CodePen export blocked: a generated local import is missing'
              )
            }
            return { path: found, namespace: VFS_NAMESPACE }
          })
          builder.onLoad({ filter: /.*/, namespace: EXTERNAL_STYLE_NAMESPACE }, () => ({
            contents: 'export {}\n',
            loader: 'js'
          }))
          builder.onLoad({ filter: /.*/, namespace: VFS_NAMESPACE }, ({ path }) => {
            const content = files.get(path)
            if (content === undefined) throw new Error('Virtual source was not found')
            if (content instanceof Uint8Array) {
              const url = codePenAssetDataURL(path, content)
              return { contents: `export default ${JSON.stringify(url)}\n`, loader: 'js' }
            }
            const extension = posix.extname(path).toLowerCase()
            if (extension === '.css') {
              cssSources.push({ path, content })
              return { contents: 'export {}\n', loader: 'js' }
            }
            if (extension === '.vue') {
              return { contents: compileVueSource(path, content, cssSources), loader: 'ts' }
            }
            if (extension === '.json') return { contents: content, loader: 'json' }
            if (extension === '.tsx') return { contents: content, loader: 'tsx' }
            if (extension === '.jsx') return { contents: content, loader: 'jsx' }
            if (extension === '.ts' || path === ENTRY_PATH) {
              return { contents: content, loader: 'ts' }
            }
            return { contents: content, loader: 'js' }
          })
        }
      }
    ]
  })
  if (!build.success) {
    rejectRuntime('bundle-failed', 'CodePen export blocked: browser bundling failed')
  }
  const javascript = build.outputs.filter((output) => output.kind === 'entry-point')
  if (javascript.length !== 1) throw new Error('Browser bundle entry count is invalid')
  return {
    js: await javascript[0].text(),
    cssSources,
    externalStylesheets: [...new Set(externalStylesheets)].sort()
  }
}

async function buildCSS(
  sources: readonly CodePenCSSSource[],
  files: ReadonlyMap<string, string | Uint8Array>
): Promise<{ css: string; dynamicCandidates: boolean }> {
  if (sources.length === 0) return { css: '', dynamicCandidates: false }
  try {
    const extracted = extractCodePenTailwindCandidates(files)
    const allowedDataURLs = new Set<string>()
    const rewrittenSources = sources.map((source) => {
      const safeSource = stripCodePenTailwindDirectives(source.content)
      const rewritten = rewriteCodePenCSSAssetURLs(safeSource, [source.path], files)
      for (const url of rewritten.dataURLs) allowedDataURLs.add(url)
      return rewritten.content
    })
    const compiler = await compileTailwind(rewrittenSources.join('\n'), {
      async loadStylesheet(id) {
        if (id !== 'tailwindcss') {
          throw new CodePenCSSAssetError(
            'unsupported-stylesheet',
            'CodePen export blocked: an imported stylesheet is unsupported'
          )
        }
        return { path: 'tailwindcss/index.css', base: '', content: tailwindStylesheet }
      }
    })
    const css = rewriteCodePenCSSAssetURLs(
      compiler.build([...extracted.candidates]),
      sources.map((source) => source.path),
      files,
      allowedDataURLs
    ).content
    return { css, dynamicCandidates: extracted.dynamic }
  } catch (error) {
    if (error instanceof CodePenCSSAssetError) rejectRuntime(error.code, error.message)
    if (error instanceof CodePenTailwindCandidateError) rejectRuntime(error.code, error.message)
    if (error instanceof CodePenTailwindDirectiveError) rejectRuntime(error.code, error.message)
    throw error
  }
}

function externalSpecifiers(js: string): string[] {
  assertNoVariableDynamicImport(js)
  const imports = new Bun.Transpiler({ loader: 'js' }).scanImports(js)
  const specifiers = imports.map((entry) => entry.path)
  if (specifiers.some((specifier) => !isSafeBarePackageSpecifier(specifier))) {
    rejectRuntime('unsafe-import', 'CodePen export blocked: an import specifier is unsafe')
  }
  return [...new Set(specifiers)].sort()
}

function importMapAndDiagnostics(
  request: CodePenSidecarRequest,
  specifiers: readonly string[]
): { imports: Record<string, string>; diagnostics: CodePenSidecarDiagnostic[] } {
  const declared = dependencies(request)
  const pins = pinsFor(request)
  const imports: Record<string, string> = {}
  const diagnostics: CodePenSidecarDiagnostic[] = []
  for (const specifier of specifiers) {
    if (specifier.endsWith('.css')) {
      rejectRuntime(
        'unsupported-stylesheet',
        'CodePen export blocked: an external stylesheet is unsupported'
      )
    }
    const base = packageBase(specifier)
    const pin = pins[base]
    if (!pin || !declarationMatches(declared[base], pin.declaration)) {
      rejectRuntime(
        'unsupported-dependency',
        'CodePen export blocked: a generated dependency is not approved'
      )
    }
    const url = externalURL(request, specifier, pin)
    imports[specifier] = url
    diagnostics.push({
      code: 'codepen-pinned-external-dependency',
      severity: 'warning',
      path: specifier,
      message: `CodePen will load the pinned browser dependency ${url}.`
    })
  }
  return { imports, diagnostics }
}

function secretDiagnostics(
  files: ReadonlyMap<string, string | Uint8Array>
): CodePenSidecarDiagnostic[] {
  const diagnostics: CodePenSidecarDiagnostic[] = []
  for (const [path, content] of files) {
    const source = typeof content === 'string' ? content : binaryDecoder.decode(content)
    for (const kind of findCodePenSecretKinds(source)) {
      diagnostics.push({
        code: 'codepen-secret-detected',
        severity: 'error',
        path,
        message: `CodePen export blocked: ${kind} detected in ${path}.`
      })
      if (diagnostics.length >= CODEPEN_SIDECAR_LIMITS.maxDiagnostics) return diagnostics
    }
  }
  return diagnostics
}

function optionSecretDiagnostics(request: CodePenSidecarRequest): CodePenSidecarDiagnostic[] {
  const options = new Map<string, string>()
  if (request.options.title !== undefined) options.set('options.title', request.options.title)
  if (request.options.description !== undefined) {
    options.set('options.description', request.options.description)
  }
  request.options.tags?.forEach((tag, index) => options.set(`options.tags.${index}`, tag))
  return secretDiagnostics(options)
}

function cleanOptions(
  request: CodePenSidecarRequest
): Omit<CodePenSidecarPrefillData, 'html' | 'css' | 'js'> {
  const options = request.options
  return {
    ...(options.title?.trim() ? { title: options.title.trim() } : {}),
    ...(options.description?.trim() ? { description: options.description.trim() } : {}),
    ...(options.tags?.length
      ? { tags: options.tags.map((tag) => tag.trim()).filter(Boolean) }
      : {}),
    ...(options.private === undefined ? {} : { private: options.private }),
    ...(options.layout === undefined ? {} : { layout: options.layout }),
    html_pre_processor: 'none',
    css_pre_processor: 'none',
    js_pre_processor: 'none'
  }
}

function assertOutputLimits(html: string, css: string, js: string, payload: string): void {
  for (const value of [html, css, js]) {
    if (byteLength(value) > 1_000_000) {
      rejectRuntime('output-limit', 'CodePen export blocked: a text pane exceeds its byte limit')
    }
  }
  if (
    byteLength(payload) > 3_100_000 ||
    byteLength(payload) > CODEPEN_SIDECAR_LIMITS.maxOutputBytes
  ) {
    rejectRuntime(
      'output-limit',
      'CodePen export blocked: the Prefill payload exceeds its byte limit'
    )
  }
}

export async function createCodePenSidecarShowcase(
  request: CodePenSidecarRequest
): Promise<CodePenSidecarSuccessResult> {
  const unfilteredFiles = new Map(request.files.map((file) => [file.path, file.content] as const))
  const secrets = [...secretDiagnostics(unfilteredFiles), ...optionSecretDiagnostics(request)]
  if (secrets.length > 0) throw new CodePenSidecarRuntimeError('secret-detected', secrets)
  const serverArtifactsOmitted = [...unfilteredFiles.keys()].some(isCodePenServerArtifact)
  const prepared = sourceFiles(request)
  const files = prepared.files
  if (files.has('src/__preview-bridge.ts')) {
    throw new Error('Development preview projects are not publishable')
  }
  try {
    assertCodePenBinaryAssetBudget(files)
  } catch (error) {
    if (error instanceof CodePenCSSAssetError) rejectRuntime(error.code, error.message)
    throw error
  }
  assertSafeSourceImports(files)
  const bundle = await buildBrowserBundle(files)
  const specifiers = externalSpecifiers(bundle.js)
  const { imports, diagnostics } = importMapAndDiagnostics(request, specifiers)
  diagnostics.push(
    ...projectPolicyDiagnostics({
      bundleJavaScript: bundle.js,
      routingStatus: prepared.routingStatus,
      serverArtifactsOmitted
    })
  )
  for (const url of bundle.externalStylesheets) {
    diagnostics.push({
      code: 'codepen-pinned-external-stylesheet',
      severity: 'warning',
      path: MAPLIBRE_STYLE_SPECIFIER,
      message: `CodePen will load the pinned browser stylesheet ${url}.`
    })
  }
  const importMap = JSON.stringify({ imports }).replaceAll('<', '\\u003c')
  const root = request.target === 'vue' ? 'app' : 'root'
  const stylesheets = bundle.externalStylesheets
    .map((url) => `<link rel="stylesheet" href="${url}">`)
    .join('\n')
  const html = `${stylesheets ? `${stylesheets}\n` : ''}<script type="importmap">${importMap}</script>\n<div id="${root}"></div>\n`
  const builtCSS = await buildCSS(bundle.cssSources, files)
  const css = builtCSS.css
  if (builtCSS.dynamicCandidates) {
    diagnostics.push({
      code: 'codepen-dynamic-tailwind-candidates-omitted',
      severity: 'warning',
      message:
        'Dynamic Tailwind class expressions cannot be fully discovered; only bounded static class candidates were compiled.'
    })
  }
  const js = bundle.js
  const data: CodePenSidecarPrefillData = { ...cleanOptions(request), html, css, js }
  const payload = JSON.stringify(data)
  const outputSecrets = secretDiagnostics(new Map([['codepen-prefill.json', payload]]))
  if (outputSecrets.length > 0) {
    throw new CodePenSidecarRuntimeError('secret-detected', outputSecrets)
  }
  assertOutputLimits(html, css, js, payload)
  return Object.freeze({
    target: request.target,
    packageName: request.packageName,
    data: Object.freeze(data),
    diagnostics: Object.freeze(diagnostics),
    compatible: true
  })
}

export class CodePenSidecarRuntimeError extends Error {
  readonly code: string
  readonly diagnostics: readonly CodePenSidecarDiagnostic[]

  constructor(
    code: string,
    diagnostics: readonly CodePenSidecarDiagnostic[],
    message = 'CodePen sidecar rejected the generated project'
  ) {
    super(message)
    this.name = 'CodePenSidecarRuntimeError'
    this.code = code
    this.diagnostics = diagnostics.slice(0, CODEPEN_SIDECAR_LIMITS.maxDiagnostics)
  }
}

function rejectRuntime(code: string, message: string): never {
  throw new CodePenSidecarRuntimeError(code, [], message)
}
