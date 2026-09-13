import { buildPreviewBridge } from '#compiler/adapters/preview-bridge'
import { buildServerArtifacts } from '#compiler/adapters/react/lowcode/server-edge'
import { derivePagePaths } from '#compiler/adapters/react/route-paths'
import type { AdapterEmission, FrameworkAdapter } from '#compiler/adapters/types'
import { LEGACY_SUPABASE_SERVER_WORKFLOW_ARTIFACT_PATHS } from '#compiler/backend/supabase/legacy-react-artifacts'
import type { ComponentDef, IRNode, IRTree } from '#compiler/ir/types'
import { buildOpenPencilMicrofrontendTypes } from '#compiler/microfrontend/runtime'
import type { CompileWarning, CompilerOptions, HTMLMetadata } from '#compiler/types'

import { buildVueComponentModule, buildVuePageModule } from './emit'
import {
  buildVueConfirmHost,
  buildVueConfirmRuntime,
  VUE_CONFIRM_HOST_FILE,
  VUE_CONFIRM_RUNTIME_FILE
} from './lowcode/confirm'
import { buildVueServerClientRuntime } from './lowcode/server-client'
import {
  buildVueSupabaseClientRuntime,
  buildVueSupabaseEnvironmentExample,
  buildVueSupabaseViteEnvironmentTypes,
  SUPABASE_JS_VERSION
} from './lowcode/supabase'
import {
  buildVueToastHost,
  buildVueToastRuntime,
  VUE_TOAST_HOST_FILE,
  VUE_TOAST_RUNTIME_FILE
} from './lowcode/toast'
import { collectVueProjectLowcodeUsage, type VueLowcodeUsage } from './lowcode/usage'
import {
  buildVueValidationCSS,
  buildVueValidationRuntime,
  VUE_VALIDATION_CSS_FILE,
  VUE_VALIDATION_RUNTIME_FILE
} from './lowcode/validation'
import { collectVueModuleProject, emitVueModuleRuntimes } from './modules/registry'
import {
  buildVueApp,
  buildVueIndexCSSFile,
  buildVueIndexHTML,
  buildVueMain,
  buildVueMicrofrontendContext,
  buildVueMicrofrontendEntry,
  buildVuePackageJSON,
  buildVueReadme,
  buildVueRouter,
  buildVueTsConfig,
  buildVueViteConfig
} from './project'
import { collectVueWarnings } from './warnings'

export const vueAdapter: FrameworkAdapter = {
  emit(
    irs: readonly IRTree[],
    options: CompilerOptions,
    components: readonly ComponentDef[] = []
  ): AdapterEmission {
    return emitVueProject(irs, options, components)
  }
}

// oxlint-disable-next-line complexity -- Project emission coordinates optional runtime and packaging artifacts.
function emitVueProject(
  irs: readonly IRTree[],
  options: CompilerOptions,
  components: readonly ComponentDef[]
): AdapterEmission {
  const warnings = collectVueWarnings(irs, components, options)
  const files = new Map<string, string | Uint8Array>()
  const infos = derivePagePaths(irs)
  const router = irs.length > 1
  const lowcode = collectVueProjectLowcodeUsage(irs, components)
  const supabaseConfig = irs.find((ir) => ir.supabaseConfig)?.supabaseConfig
  const serverWorkflows =
    irs.find((ir) => (ir.serverWorkflows?.length ?? 0) > 0)?.serverWorkflows ?? []
  const moduleProject = collectVueModuleProject(
    irs.map((ir) => ir.children),
    components
  )
  const docStateTypes = new Map(
    (irs[0]?.docStates ?? []).map((state) => [state.name, state.type] as const)
  )

  emitAssets(files, irs, components)
  emitVueModuleRuntimes(files, moduleProject, {
    microfrontend: options.packaging?.kind === 'microfrontend'
  })
  emitVueLowcodeRuntimes(files, lowcode)
  if (supabaseConfig) {
    files.set('src/lowcode-supabase.ts', buildVueSupabaseClientRuntime(supabaseConfig))
    files.set('.env.example', buildVueSupabaseEnvironmentExample(supabaseConfig))
  }
  const executableServerWorkflowFiles = supabaseConfig
    ? emitVueServerWorkflowFiles(files, serverWorkflows)
    : []
  for (const definition of components) {
    const emitted = buildVueComponentModule(definition, options, router, docStateTypes, {
      backend: irs.some((ir) => ir.backendClient !== undefined),
      supabase: supabaseConfig !== undefined,
      serverWorkflow: supabaseConfig !== undefined && serverWorkflows.length > 0
    })
    files.set(`src/components/${definition.name}.vue`, emitted.source)
    warnings.push(...emitted.warnings)
  }
  for (const info of infos) {
    const emitted = buildVuePageModule(info.ir, options, router, {
      backend: irs.some((ir) => ir.backendClient !== undefined),
      supabase: supabaseConfig !== undefined,
      serverWorkflow: supabaseConfig !== undefined && serverWorkflows.length > 0
    })
    files.set(`src/pages/${info.slug}.vue`, emitted.source)
    warnings.push(...emitted.warnings)
  }

  const firstComponent = infos[0]?.component ?? 'PageIndex'
  files.set(
    'package.json',
    buildVuePackageJSON(
      options,
      router,
      supabaseConfig ? { '@supabase/supabase-js': SUPABASE_JS_VERSION } : {}
    )
  )
  files.set('vite.config.ts', buildVueViteConfig())
  files.set('tsconfig.json', buildVueTsConfig())
  files.set(
    'src/env.d.ts',
    supabaseConfig
      ? buildVueSupabaseViteEnvironmentTypes()
      : '/// <reference types="vite/client" />\n'
  )
  files.set(
    'src/main.ts',
    buildVueMain(router, lowcode, options.devMode, options.packaging?.kind === 'microfrontend')
  )
  files.set('src/App.vue', buildVueApp(router, firstComponent, lowcode))
  files.set('src/index.css', buildVueIndexCSSFile(collectClassNames(irs, components), options))
  files.set(
    'src/lowcode-state.ts',
    buildVueDocStateRuntime(irs[0]?.docStates ?? [], options.devMode)
  )
  if (options.devMode)
    files.set(
      'src/__preview-bridge.ts',
      buildPreviewBridge({ documentState: !options.backendPreview })
    )
  if (router) {
    files.set('src/router.ts', buildVueRouter(infos, options.packaging?.kind === 'microfrontend'))
  }
  if (options.packaging?.kind === 'microfrontend') {
    files.set('src/__microfrontend-abi.ts', buildOpenPencilMicrofrontendTypes())
    files.set('src/__microfrontend-context.ts', buildVueMicrofrontendContext())
    files.set(
      'src/microfrontend.ts',
      buildVueMicrofrontendEntry(options.packaging, router, lowcode, options.devMode)
    )
  }
  files.set(
    'index.html',
    buildVueIndexHTML(options.packageName, indexMetadata(irs, options), options.sourceLocale)
  )
  files.set('README.md', buildVueReadme(router))
  files.set('.gitignore', 'node_modules\ndist\n*.local\n')
  return {
    files,
    warnings: dedupeWarnings(warnings),
    ...(executableServerWorkflowFiles.length > 0 ? { executableServerWorkflowFiles } : {})
  }
}

function emitVueLowcodeRuntimes(
  files: Map<string, string | Uint8Array>,
  usage: VueLowcodeUsage
): void {
  if (usage.toast) {
    files.set(VUE_TOAST_RUNTIME_FILE, buildVueToastRuntime())
    files.set(VUE_TOAST_HOST_FILE, buildVueToastHost())
  }
  if (usage.confirm) {
    files.set(VUE_CONFIRM_RUNTIME_FILE, buildVueConfirmRuntime())
    files.set(VUE_CONFIRM_HOST_FILE, buildVueConfirmHost())
  }
  if (usage.validation) {
    files.set(VUE_VALIDATION_RUNTIME_FILE, buildVueValidationRuntime())
    files.set(VUE_VALIDATION_CSS_FILE, buildVueValidationCSS())
  }
}

function emitVueServerWorkflowFiles(
  files: Map<string, string | Uint8Array>,
  workflows: readonly NonNullable<IRTree['serverWorkflows']>[number][]
): readonly string[] {
  if (workflows.length === 0) return []
  const artifacts = buildServerArtifacts(workflows)
  files.set('src/lowcode-server.ts', buildVueServerClientRuntime())
  const [edgeFunctionPath, envPath, manifestPath, readmePath] =
    LEGACY_SUPABASE_SERVER_WORKFLOW_ARTIFACT_PATHS
  files.set(edgeFunctionPath, artifacts.edgeFunction)
  files.set(envPath, artifacts.envExample)
  files.set(manifestPath, artifacts.manifest)
  files.set(readmePath, artifacts.readme)
  return LEGACY_SUPABASE_SERVER_WORKFLOW_ARTIFACT_PATHS
}

function buildVueDocStateRuntime(
  states: readonly IRTree['docStates'][number][],
  devMode: boolean
): string {
  const initializers = states
    .map(
      (state) =>
        `state[${safeScriptJSON(state.name)}] = ${stateDefault(state.defaultValue, state.type)}`
    )
    .join('\n')
  const previewRuntime = devMode
    ? `
type PreviewDocStoreListener = (
  state: Record<string, unknown>,
  previous: Record<string, unknown>
) => void

const previewDocStoreListeners = new Set<PreviewDocStoreListener>()
let previousPreviewDocState = { ...state }

watch(
  state,
  () => {
    const next = { ...state }
    const previous = previousPreviewDocState
    previousPreviewDocState = next
    for (const listener of previewDocStoreListeners) listener(next, previous)
  },
  { deep: true, flush: 'sync' }
)

const previewDocStore = {
  getState: (): Record<string, unknown> => ({ ...state }),
  setState(partial: Record<string, unknown>): void {
    for (const [name, value] of Object.entries(partial)) {
      if (Object.hasOwn(state, name)) state[name] = value
    }
  },
  subscribe(listener: PreviewDocStoreListener): () => void {
    previewDocStoreListeners.add(listener)
    return () => previewDocStoreListeners.delete(listener)
  }
}

if (typeof window !== 'undefined') {
  ;(window as Window & { __opDocStore?: typeof previewDocStore }).__opDocStore = previewDocStore
  window.dispatchEvent(new Event('op-docstore-ready'))
}
`
    : ''
  const imports = devMode ? 'reactive, toRef, watch, type Ref' : 'reactive, toRef, type Ref'
  return `import { ${imports} } from 'vue'

const state = reactive<Record<string, unknown>>(Object.create(null) as Record<string, unknown>)
${initializers}
${previewRuntime}

export function useDocState<T = unknown>(name: string): Ref<T> {
  return toRef(state, name) as Ref<T>
}

export function getDocState<T = unknown>(name: string): T {
  return state[name] as T
}

export function setDocState(name: string, value: unknown): void {
  state[name] = value
}
`
}

function emitAssets(
  files: Map<string, string | Uint8Array>,
  irs: readonly IRTree[],
  components: readonly ComponentDef[]
): void {
  const assets = [
    ...irs.flatMap((ir) => ir.assets ?? []),
    ...components.flatMap((c) => c.assets ?? [])
  ]
  assets.sort((a, b) => a.path.localeCompare(b.path))
  for (const asset of assets) files.set(asset.path, asset.bytes)
}

function collectClassNames(irs: readonly IRTree[], components: readonly ComponentDef[]): string[] {
  const result = new Set<string>()
  const collect = (node: IRNode): void => {
    if (node.kind === 'conditional') return collect(node.consequent)
    if (node.kind === 'list') return collect(node.template)
    if (node.kind === 'text' || node.kind === 'expression') return
    for (const name of node.className.split(/\s+/)) if (name) result.add(name)
    if (node.kind === 'componentRef') {
      for (const prop of node.props) {
        if (prop.kind !== 'className' || typeof prop.value !== 'string') continue
        for (const name of prop.value.split(/\s+/)) if (name) result.add(name)
      }
      return
    }
    node.children.forEach(collect)
  }
  for (const ir of irs) ir.children.forEach(collect)
  for (const definition of components) {
    definition.children.forEach(collect)
    definition.variants?.forEach((variant) => variant.children.forEach(collect))
    for (const prop of definition.props) {
      if (prop.kind !== 'className') continue
      for (const name of prop.defaultValue.split(/\s+/)) if (name) result.add(name)
    }
  }
  return [...result].sort((a, b) => a.localeCompare(b))
}

function indexMetadata(irs: readonly IRTree[], options: CompilerOptions): HTMLMetadata | undefined {
  const base = options.metadata
  if (irs.length !== 1) return base
  const page = base?.pages?.[irs[0].pageId]
  return page ? { ...base, ...page } : base
}

function stateDefault(value: unknown, type: IRTree['docStates'][number]['type']): string {
  if (type === 'string') return safeScriptJSON(typeof value === 'string' ? value : '')
  if (type === 'number')
    return typeof value === 'number' && Number.isFinite(value) ? String(value) : '0'
  if (type === 'boolean') return value === true ? 'true' : 'false'
  if (type === 'array') return safeScriptJSON(Array.isArray(value) ? value : [])
  return safeScriptJSON(value !== null && typeof value === 'object' ? value : {})
}

function safeScriptJSON(value: unknown): string {
  return JSON.stringify(value).replace(/<\/script/gi, '<\\/script')
}

function dedupeWarnings(warnings: readonly CompileWarning[]): CompileWarning[] {
  const seen = new Set<string>()
  return warnings.filter((warning) => {
    const key = `${warning.code}\0${warning.nodeId ?? ''}\0${warning.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
