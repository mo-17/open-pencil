import { buildPreviewBridge } from '#compiler/adapters/preview-bridge'
import { derivePagePaths } from '#compiler/adapters/react/route-paths'
import type { AdapterEmission, FrameworkAdapter } from '#compiler/adapters/types'
import type { ComponentDef, IREventHandler, IRNode, IRTree } from '#compiler/ir/types'
import type { CompileWarning, CompilerOptions, HtmlMetadata } from '#compiler/types'

import { buildVueComponentModule, buildVuePageModule, sanitizeVueHrefLiteral } from './emit'
import {
  buildVueConfirmHost,
  buildVueConfirmRuntime,
  VUE_CONFIRM_HOST_FILE,
  VUE_CONFIRM_RUNTIME_FILE
} from './lowcode/confirm'
import {
  buildVueToastHost,
  buildVueToastRuntime,
  VUE_TOAST_HOST_FILE,
  VUE_TOAST_RUNTIME_FILE
} from './lowcode/toast'
import { collectVueProjectLowcodeUsage, type VueLowcodeUsage } from './lowcode/usage'
import {
  buildVueValidationCss,
  buildVueValidationRuntime,
  VUE_VALIDATION_CSS_FILE,
  VUE_VALIDATION_RUNTIME_FILE
} from './lowcode/validation'
import {
  collectVueModuleProject,
  emitVueModuleRuntimes,
  supportsVueModule
} from './modules/registry'
import {
  buildVueApp,
  buildVueIndexCssFile,
  buildVueIndexHtml,
  buildVueMain,
  buildVuePackageJson,
  buildVueReadme,
  buildVueRouter,
  buildVueTsConfig,
  buildVueViteConfig,
  normalizeVueSourceLocale
} from './project'

export const vueAdapter: FrameworkAdapter = {
  emit(
    irs: readonly IRTree[],
    options: CompilerOptions,
    components: readonly ComponentDef[] = []
  ): AdapterEmission {
    return emitVueProject(irs, options, components)
  }
}

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
  const moduleProject = collectVueModuleProject(
    irs.map((ir) => ir.children),
    components
  )
  const docStateTypes = new Map(
    (irs[0]?.docStates ?? []).map((state) => [state.name, state.type] as const)
  )

  emitAssets(files, irs, components)
  emitVueModuleRuntimes(files, moduleProject)
  emitVueLowcodeRuntimes(files, lowcode)
  for (const definition of components) {
    const emitted = buildVueComponentModule(definition, options, router, docStateTypes)
    files.set(`src/components/${definition.name}.vue`, emitted.source)
    warnings.push(...emitted.warnings)
  }
  for (const info of infos) {
    const emitted = buildVuePageModule(info.ir, options, router)
    files.set(`src/pages/${info.slug}.vue`, emitted.source)
    warnings.push(...emitted.warnings)
  }

  const firstComponent = infos[0]?.component ?? 'PageIndex'
  files.set('package.json', buildVuePackageJson(options, router))
  files.set('vite.config.ts', buildVueViteConfig())
  files.set('tsconfig.json', buildVueTsConfig())
  files.set('src/env.d.ts', '/// <reference types="vite/client" />\n')
  files.set('src/main.ts', buildVueMain(router, lowcode, options.devMode))
  files.set('src/App.vue', buildVueApp(router, firstComponent, lowcode))
  files.set('src/index.css', buildVueIndexCssFile(collectClassNames(irs, components), options))
  files.set(
    'src/lowcode-state.ts',
    buildVueDocStateRuntime(irs[0]?.docStates ?? [], options.devMode)
  )
  if (options.devMode) files.set('src/__preview-bridge.ts', buildPreviewBridge())
  if (router) files.set('src/router.ts', buildVueRouter(infos))
  files.set(
    'index.html',
    buildVueIndexHtml(options.packageName, indexMetadata(irs, options), options.sourceLocale)
  )
  files.set('README.md', buildVueReadme(router))
  files.set('.gitignore', 'node_modules\ndist\n*.local\n')
  return { files, warnings: dedupeWarnings(warnings) }
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
    files.set(VUE_VALIDATION_CSS_FILE, buildVueValidationCss())
  }
}

function buildVueDocStateRuntime(
  states: readonly IRTree['docStates'][number][],
  devMode: boolean
): string {
  const initializers = states
    .map(
      (state) =>
        `state[${safeScriptJson(state.name)}] = ${stateDefault(state.defaultValue, state.type)}`
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

// oxlint-disable-next-line complexity -- Capability auditing intentionally enumerates every fail-closed Vue v1 boundary.
function collectVueWarnings(
  irs: readonly IRTree[],
  components: readonly ComponentDef[],
  options: CompilerOptions
): CompileWarning[] {
  const warnings: CompileWarning[] = []
  const seen = new Set<string>()
  const warn = (code: string, message: string, nodeId?: string): void => {
    if (seen.has(code)) return
    seen.add(code)
    warnings.push({ code, message, ...(nodeId ? { nodeId } : {}) })
  }
  if (irs.length > 1 && options.router !== 'vue-router-v4') {
    warn(
      'vue-router-option-normalized',
      `Vue multi-page output requires vue-router v4; router option '${options.router}' was normalized for the generated project.`
    )
  }
  if (options.i18n) {
    warn(
      'vue-i18n-unsupported',
      'Vue v1 does not emit an i18n runtime; source-language text is preserved without translation controls.'
    )
  }
  if (options.uiKit) {
    warn(
      'vue-ui-kit-unsupported',
      `Vue v1 does not emit the '${options.uiKit}' React UI kit; semantic nodes use plain HTML.`
    )
  }
  if (options.themeSwitch) {
    warn(
      'vue-theme-switch-unsupported',
      'Vue v1 preserves generated theme CSS but omits the interactive theme switch runtime.'
    )
  }
  if (
    options.sourceLocale?.trim() &&
    normalizeVueSourceLocale(options.sourceLocale) !== options.sourceLocale.trim()
  ) {
    warn(
      'vue-source-locale-invalid',
      `Vue v1 replaced the invalid source locale '${options.sourceLocale.trim()}' with 'en'.`
    )
  }
  if (irs.length > 1 && Object.keys(options.metadata?.pages ?? {}).length > 0) {
    warn(
      'vue-page-metadata-unsupported',
      'Vue v1 emits one HTML shell for multi-page output, so route-specific metadata overrides are omitted.'
    )
  }
  const router = irs.length > 1
  for (const ir of irs) {
    if (!router && (ir.usesRouteParams || ir.usesQueryParams)) {
      warn(
        'vue-route-context-unavailable',
        'Vue single-page output cannot provide route or query parameters without vue-router; those bindings use empty objects.',
        ir.pageId
      )
    }
    if (ir.motion || ir.motionDrivers || ir.motionScene) motionWarning(warn, ir.pageId)
    if (ir.prototype || ir.prototypeTarget || ir.transitionKey) prototypeWarning(warn, ir.pageId)
    if (ir.supabaseConfig || (ir.listQueries?.length ?? 0) > 0 || ir.requiresAuth) {
      supabaseWarning(warn, ir.pageId)
    }
    if (ir.requiresAuth) {
      warn(
        'vue-auth-guard-unsupported',
        'Vue v1 cannot enforce Supabase auth guards; guarded page content is omitted.',
        ir.pageId
      )
    }
    if (ir.validatedFields?.some((field) => field.async)) {
      asyncValidationWarning(warn, ir.pageId)
    }
    if (ir.serverWorkflows?.length) {
      warn(
        'vue-server-workflow-unsupported',
        'Vue v1 omits server workflow clients and their actions.',
        ir.pageId
      )
    }
    if (ir.analyticsConfig) {
      warn(
        'vue-analytics-unsupported',
        'Vue v1 omits analytics providers and tracking actions.',
        ir.pageId
      )
    }
    ir.children.forEach((node) => scanNode(node, warn, router))
  }
  for (const definition of components) {
    const componentReadsRouteContext = (definition.docStateReads ?? []).some(
      (name) => name === '$params' || name === '$query'
    )
    if (!router && componentReadsRouteContext) {
      warn(
        'vue-route-context-unavailable',
        'Vue single-page output cannot provide route or query parameters without vue-router; those bindings use empty objects.',
        definition.componentId
      )
    }
    if (definition.prototypeBody) prototypeWarning(warn, definition.componentId)
    if (definition.validatedFields?.some((field) => field.async)) {
      asyncValidationWarning(warn, definition.componentId)
    }
    definition.children.forEach((node) => scanNode(node, warn, router))
    definition.variants?.forEach((variant) =>
      variant.children.forEach((node) => scanNode(node, warn, router))
    )
  }
  for (const state of irs[0]?.docStates ?? []) {
    if (state.persist) {
      warn(
        'vue-doc-state-persistence-unsupported',
        'Vue v1 keeps document state in memory and omits localStorage persistence.'
      )
    }
  }
  return warnings
}

// oxlint-disable-next-line complexity -- This exhaustive IR capability scanner keeps unsupported behaviors visible.
function scanNode(
  node: IRNode,
  warn: (code: string, message: string, nodeId?: string) => void,
  router: boolean
): void {
  if (node.kind === 'conditional') return scanNode(node.consequent, warn, router)
  if (node.kind === 'list') return scanNode(node.template, warn, router)
  if (node.kind === 'text' || node.kind === 'expression') return
  if (node.motion || node.motionDrivers || node.motionDriverMarker)
    motionWarning(warn, node.sourceId)
  if (
    (node.kind === 'componentRef' && node.prototypeBody) ||
    node.transitionKey ||
    node.prototypeTarget
  ) {
    prototypeWarning(warn, node.sourceId)
  }
  scanEvents(node.events, warn, node.sourceId, router)
  if (node.kind === 'componentRef') return
  if (node.motionScene || node.generatedEffect) motionWarning(warn, node.sourceId)
  if (node.module && !supportsVueModule(node.module)) {
    warn(
      'vue-module-unsupported',
      'Vue v1 has no runtime for this trusted plugin module and preserves only its static node shell.',
      node.sourceId
    )
  }
  if (node.upload) supabaseWarning(warn, node.sourceId)
  if (node.link?.hrefLiteral !== undefined) {
    if (sanitizeVueHrefLiteral(node.link.hrefLiteral) === undefined) {
      warn(
        'vue-link-href-unsafe',
        'Vue v1 blocked an unsafe or non-allowlisted link URL.',
        node.sourceId
      )
    }
  }
  if (node.link?.hrefExpr) {
    warn(
      'vue-link-href-runtime-sanitized',
      'Vue v1 applies a runtime allowlist to this dynamic link URL and removes unsafe values.',
      node.sourceId
    )
  }
  if ((node.image?.sources?.length ?? 0) > 0) {
    warn(
      'vue-responsive-image-unsupported',
      'Vue v1 omits responsive image sources and preserves only the fallback image.',
      node.sourceId
    )
  }
  if (node.rawHtml !== undefined) {
    warn(
      'vue-raw-html-unsupported',
      'Vue v1 omits authored raw HTML instead of emitting an injectable v-html binding.',
      node.sourceId
    )
  }
  if (node.validation?.async) asyncValidationWarning(warn, node.sourceId)
  if (node.icon || node.displayKind || node.overlay) {
    warn(
      'vue-advanced-ui-unsupported',
      'Vue v1 preserves the static HTML shell but omits advanced icon/display/overlay behavior.',
      node.sourceId
    )
  }
  for (const value of Object.values(node.attrs)) {
    if (typeof value === 'object' && value.kind === 'intlMessage') {
      warn(
        'vue-i18n-unsupported',
        'Vue v1 preserves source-language attributes but omits the i18n runtime.',
        node.sourceId
      )
    }
  }
  node.children.forEach((child) => scanNode(child, warn, router))
}

function scanEvents(
  events: Partial<Record<string, IREventHandler[]>> | undefined,
  warn: (code: string, message: string, nodeId?: string) => void,
  nodeId: string,
  router: boolean
): void {
  for (const handlers of Object.values(events ?? {})) {
    for (const handler of handlers ?? []) scanHandler(handler, warn, nodeId, router)
  }
}

function scanHandler(
  handler: IREventHandler,
  warn: (code: string, message: string, nodeId?: string) => void,
  nodeId: string,
  router: boolean
): void {
  if (handler.kind === 'navigate' && !router) {
    warn(
      'vue-navigation-no-router',
      'Vue single-page output omitted an internal navigate action because no router is present.',
      nodeId
    )
    return
  }
  if (handler.kind === 'condition' || handler.kind === 'confirm') {
    handler.consequent.forEach((item) => scanHandler(item, warn, nodeId, router))
    handler.alternate?.forEach((item) => scanHandler(item, warn, nodeId, router))
    return
  }
  if (handler.kind === 'apiCall') {
    handler.onSuccess?.forEach((item) => scanHandler(item, warn, nodeId, router))
    handler.onError?.forEach((item) => scanHandler(item, warn, nodeId, router))
    return
  }
  if (handler.kind.startsWith('supabase')) {
    supabaseWarning(warn, nodeId)
    return
  }
  if (['playMotion', 'stopMotion', 'toggleMotion', 'awaitMotion'].includes(handler.kind)) {
    motionWarning(warn, nodeId)
    return
  }
  if (handler.kind === 'invokeServerWorkflow') {
    warn('vue-server-workflow-unsupported', 'Vue v1 omitted a server workflow action.', nodeId)
    return
  }
  if (handler.kind === 'stripeCheckout' || handler.kind === 'stripeCustomerPortal') {
    warn('vue-stripe-unsupported', 'Vue v1 omitted a Stripe redirect action.', nodeId)
    return
  }
  if (handler.kind === 'trackEvent') {
    warn('vue-analytics-unsupported', 'Vue v1 omitted an analytics tracking action.', nodeId)
    return
  }
  if (!SUPPORTED_HANDLER_KINDS.has(handler.kind)) {
    warn(
      `vue-event-${handler.kind}-unsupported`,
      `Vue v1 omitted unsupported '${handler.kind}' event behavior.`,
      nodeId
    )
  }
}

const SUPPORTED_HANDLER_KINDS = new Set<IREventHandler['kind']>([
  'setState',
  'setVariable',
  'navigate',
  'apiCall',
  'condition',
  'delay',
  'stop',
  'toast',
  'confirm',
  'clipboard'
])

function motionWarning(
  warn: (code: string, message: string, nodeId?: string) => void,
  nodeId: string
): void {
  warn(
    'vue-motion-unsupported',
    'Vue v1 preserves the static visual state but omits MotionSpec playback and generated effects.',
    nodeId
  )
}

function prototypeWarning(
  warn: (code: string, message: string, nodeId?: string) => void,
  nodeId: string
): void {
  warn(
    'vue-prototype-unsupported',
    'Vue v1 omits prototype transitions and Smart Animate behavior.',
    nodeId
  )
}

function supabaseWarning(
  warn: (code: string, message: string, nodeId?: string) => void,
  nodeId: string
): void {
  warn(
    'vue-supabase-unsupported',
    'Vue v1 omits Supabase auth, query, mutation, list-query, and upload runtimes.',
    nodeId
  )
}

function asyncValidationWarning(
  warn: (code: string, message: string, nodeId?: string) => void,
  nodeId: string
): void {
  warn(
    'vue-validation-async-unsupported',
    'Vue v1 supports local validation but blocks submit when a field still requires remote validation.',
    nodeId
  )
}

function indexMetadata(irs: readonly IRTree[], options: CompilerOptions): HtmlMetadata | undefined {
  const base = options.metadata
  if (irs.length !== 1) return base
  const page = base?.pages?.[irs[0].pageId]
  return page ? { ...base, ...page } : base
}

function stateDefault(value: unknown, type: IRTree['docStates'][number]['type']): string {
  if (type === 'string') return safeScriptJson(typeof value === 'string' ? value : '')
  if (type === 'number')
    return typeof value === 'number' && Number.isFinite(value) ? String(value) : '0'
  if (type === 'boolean') return value === true ? 'true' : 'false'
  if (type === 'array') return safeScriptJson(Array.isArray(value) ? value : [])
  return safeScriptJson(value !== null && typeof value === 'object' ? value : {})
}

function safeScriptJson(value: unknown): string {
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
