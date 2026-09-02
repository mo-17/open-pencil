import { LEGACY_SUPABASE_SERVER_WORKFLOW_ARTIFACT_PATHS } from '#compiler/backend/supabase/legacy-react-artifacts'
import type {
  ComponentDef,
  IRAsset,
  IRNode,
  IRServerWorkflow,
  IRSupabaseConfig,
  IRTranslations,
  IRTree
} from '#compiler/ir/types'
import { buildOpenPencilMicrofrontendTypes } from '#compiler/microfrontend/runtime'
import {
  buildGitignore,
  buildIndexCSS,
  buildIndexHTML,
  buildMainTsx,
  buildPackageJSON,
  buildTsConfig,
  buildViteConfig
} from '#compiler/project'
import type {
  CompilerOptions,
  CompileWarning,
  HTMLMetadata,
  LowcodeThemeSwitchPosition
} from '#compiler/types'

import { compactLowcodeHeadMetadata } from '@open-pencil/lowcode'

import { scopeMicrofrontendCSS } from '../microfrontend-css'
import { buildPreviewBridge } from '../preview-bridge'
import type { AdapterEmission, FrameworkAdapter } from '../types'
import { buildComponentModule } from './emit/component'
import { OVERLAY_RUNTIME_CLASSES } from './emit/element'
import { buildGeneratedEffectPlan } from './generated-effect/scan'
import {
  pageUsesAnalytics,
  pageUsesConfirm,
  pageUsesToast,
  referencedComponentNames,
  referencedLucideIconNames,
  stripNavigateFromNodesForSinglePage,
  stripNavigateForSinglePage
} from './ir-walk'
import { buildLowcodeAnalyticsRuntime } from './lowcode/analytics'
import { buildLowcodeConfirmRuntime, CONFIRM_RUNTIME_CLASSES } from './lowcode/confirm'
import {
  buildI18nCoverageReport,
  i18nCoverageWarnings,
  buildLocaleCatalog,
  buildLocaleSwitcher,
  buildLowcodeI18nRuntime,
  buildTranslatedCatalog,
  isRTLLocale,
  REACT_INTL_VERSION,
  sourceCatalogPath,
  SOURCE_LOCALE
} from './lowcode/i18n'
import { buildLowcodeServerClientRuntime } from './lowcode/server-client'
import { buildServerArtifacts } from './lowcode/server-edge'
import { buildLowcodeStateRuntime, ZUSTAND_VERSION } from './lowcode/state'
import {
  buildLowcodeSupabaseRuntime,
  buildSupabaseEnvExample,
  buildViteEnvDts,
  SUPABASE_JS_VERSION
} from './lowcode/supabase'
import { buildLowcodeThemeRuntime } from './lowcode/theme'
import { buildLowcodeToastRuntime, TOAST_RUNTIME_CLASSES } from './lowcode/toast'
import {
  buildLowcodeValidationRuntime,
  VALIDATION_ERROR_CLASSES,
  VALIDATION_INVALID_FIELD_CLASSES
} from './lowcode/validation'
import { collectReactModuleProject, emitReactModuleRuntimes } from './modules/registry'
import { buildMotionPlan } from './motion/scan'
import type { ReactMotionPlan } from './motion/types'
import { buildPrototypePlan } from './prototype/scan'
import { derivePagePaths, type PagePathInfo } from './route-paths'
import { buildAppTsx, buildPageModule, buildRouterApp, PAGE_WRAPPER_CLASSES } from './scaffold'
import { collectUsedKitComponents, resolveUIKit } from './ui-kit/registry'
import type { UIKitAdapter } from './ui-kit/types'

/**
 * Pinned alongside `react: ^19.2.0` / `react: ^18.3.1` — `react-router-dom@6`
 * supports both. Lock to 6.27 minimum (the line that added React 19 support)
 * to avoid older v6 versions crashing under `<StrictMode>` in React 19.
 */
const REACT_ROUTER_DOM_VERSION = '^6.27.0'
const LUCIDE_REACT_VERSION = '^1.21.0'

const LOWCODE_STATE_FILE = 'src/_lowcode_state.ts'
const LOWCODE_SUPABASE_FILE = 'src/_lowcode_supabase.ts'
const LOWCODE_SERVER_FILE = 'src/_lowcode_server.ts'
const LOWCODE_I18N_FILE = 'src/_lowcode_i18n.tsx'
const LOWCODE_TOAST_FILE = 'src/_lowcode_toast.tsx'
const LOWCODE_CONFIRM_FILE = 'src/_lowcode_confirm.tsx'
const LOWCODE_VALIDATION_FILE = 'src/_lowcode_validation.tsx'
const LOWCODE_THEME_FILE = 'src/_lowcode_theme.tsx'
const LOWCODE_ANALYTICS_FILE = 'src/_lowcode_analytics.ts'
const PROTOTYPE_RUNTIME_FILE = 'src/__prototype-runtime.ts'
const GENERATED_EFFECT_RUNTIME_FILE = 'src/__generated-effect-runtime.ts'
const MICROFRONTEND_CONTEXT_FILE = 'src/__microfrontend-context.ts'
const MICROFRONTEND_ABI_FILE = 'src/__microfrontend-abi.ts'
const MICROFRONTEND_ENTRY_FILE = 'src/microfrontend.tsx'
const LOWCODE_RUNTIME_THEME_UTILITY_RE =
  /(?:^|:)(?:accent|bg|text|border|ring)-(?:background|foreground|primary|primary-foreground|secondary|secondary-foreground|muted-foreground|destructive|destructive-foreground|border|ring)(?:\/|$)/
const LOWCODE_RUNTIME_THEME_CSS = `@layer base {
  :root {
    --background: Canvas;
    --foreground: CanvasText;
    --primary: var(--op-lowcode-theme-accent, CanvasText);
    --primary-foreground: var(--op-lowcode-theme-on-accent, Canvas);
    --secondary: color-mix(in srgb, var(--op-lowcode-theme-accent, CanvasText) 10%, Canvas);
    --secondary-foreground: CanvasText;
    --muted-foreground: color-mix(in srgb, CanvasText 68%, transparent);
    --destructive: #dc2626;
    --destructive-foreground: #ffffff;
    --border: color-mix(in srgb, CanvasText 16%, transparent);
    --ring: var(--destructive);
  }
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted-foreground: var(--muted-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-ring: var(--ring);
}
`

function resolveThemeSwitchPosition(
  options: CompilerOptions
): LowcodeThemeSwitchPosition | false | undefined {
  const config = options.themeSwitch
  if (config === false) return false
  if (config === true || config === undefined) return undefined
  if (config.enabled === false) return false
  return config.position
}

export const reactAdapter: FrameworkAdapter = {
  emit(
    irs: readonly IRTree[],
    options: CompilerOptions,
    components: readonly ComponentDef[] = []
  ): AdapterEmission {
    return irs.length > 1
      ? emitMultiPage(irs, options, components)
      : emitSinglePage(irs[0], options, components)
  }
}

/** Phase 3 §8: emit one `src/components/<Name>.tsx` per reusable component.
 *  Pages reference them via the import prefix set in the scaffold options
 *  (`./components/` single-page, `../components/` multi-page). */
function emitComponentFiles(
  files: Map<string, string | Uint8Array>,
  components: readonly ComponentDef[],
  devMode: boolean,
  uiKit: UIKitAdapter | null,
  animatedComponentNames: ReadonlySet<string>,
  eventComponentNames: ReadonlySet<string>,
  motionScopeComponentNames: ReadonlySet<string>,
  prototypeComponentNames: ReadonlySet<string>,
  routerAvailable: boolean
): void {
  for (const def of components) {
    files.set(
      `src/components/${def.name}.tsx`,
      buildComponentModule(
        def,
        devMode,
        uiKit,
        animatedComponentNames.has(def.name),
        eventComponentNames.has(def.name),
        motionScopeComponentNames.has(def.name),
        prototypeComponentNames.has(def.name),
        routerAvailable
      )
    )
  }
}

/**
 * Phase 3 §15 — when a UI kit is active, emit its inlined component sources +
 * shared files for the components the pages/components actually render, and
 * return the deps + theme CSS to fold into package.json / index.css. Emits
 * nothing (and reports inactive) when no interactive node maps, so `--ui-kit`
 * on a kit-free doc stays byte-identical.
 */
function applyUIKit(
  files: Map<string, string | Uint8Array>,
  irs: readonly IRTree[],
  components: readonly ComponentDef[],
  uiKit: UIKitAdapter | null,
  microfrontend = false
): { deps: Record<string, string>; themeCss: string; active: boolean } {
  if (!uiKit) return { deps: {}, themeCss: '', active: false }
  const used = new Set<string>()
  for (const ir of irs) collectUsedKitComponents(ir.children, uiKit, used)
  for (const def of components) collectUsedKitComponents(componentBodyNodes(def), uiKit, used)
  if (used.size === 0) return { deps: {}, themeCss: '', active: false }
  for (const [path, content] of uiKit.sharedFiles()) files.set(path, content)
  for (const [path, content] of uiKit.componentFiles(used, { microfrontend })) {
    files.set(path, content)
  }
  return { deps: uiKit.deps(used), themeCss: uiKit.themeCSS(), active: true }
}

/** Phase 3 §8 v10 — all body nodes of a component def. A COMPONENT_SET's body
 *  lives in its variant subtrees (`children` is empty for a SET), so refs nested
 *  inside variants are missed unless those subtrees are walked too. */
function componentBodyNodes(def: ComponentDef): IRNode[] {
  return def.variants ? [...def.children, ...def.variants.flatMap((v) => v.children)] : def.children
}

/** A single-page bundle has no Router context. Reusable component bodies live
 *  outside the page IR, so strip their navigate actions separately and retain
 *  the same per-node warnings as the page transform. */
function stripComponentNavigateForSinglePage(components: readonly ComponentDef[]): {
  components: ComponentDef[]
  warnings: CompileWarning[]
} {
  const warnings: CompileWarning[] = []
  const stripped = components.map((def) => {
    const childResult = stripNavigateFromNodesForSinglePage(def.children)
    warnings.push(...childResult.warnings)
    const variants = def.variants?.map((variant) => {
      const result = stripNavigateFromNodesForSinglePage(variant.children)
      warnings.push(...result.warnings)
      return result.nodes === variant.children ? variant : { ...variant, children: result.nodes }
    })
    const variantsUnchanged =
      variants === undefined ||
      variants.every((variant, index) => variant === def.variants?.[index])
    if (childResult.nodes === def.children && variantsUnchanged) {
      return def
    }
    return { ...def, children: childResult.nodes, variants }
  })
  return { components: stripped, warnings }
}

/**
 * Phase 3 §8 v10 — the components actually reachable from the pages, transitively
 * through component bodies. A registered component whose every usage was inlined
 * (e.g. a §8 v9 deep-override instance) is referenced by no page or component
 * body, so it is pruned — no orphan `src/components/<Name>.tsx` is emitted, and
 * its classes/messages don't bloat the safelist/catalog. Order-preserving.
 */
function reachableComponents(
  irs: readonly IRTree[],
  components: readonly ComponentDef[]
): ComponentDef[] {
  if (components.length === 0) return []
  const byName = new Map(components.map((d) => [d.name, d]))
  const reachable = new Set<string>()
  const queue: string[] = []
  const seed = (names: readonly string[]): void => {
    for (const name of names) {
      if (byName.has(name) && !reachable.has(name)) {
        reachable.add(name)
        queue.push(name)
      }
    }
  }
  for (const ir of irs) seed(referencedComponentNames(ir.children))
  while (queue.length > 0) {
    const name = queue.pop()
    const def = name === undefined ? undefined : byName.get(name)
    if (def) seed(referencedComponentNames(componentBodyNodes(def)))
  }
  return components.filter((d) => reachable.has(d.name))
}

function emitSinglePage(
  ir: IRTree,
  options: CompilerOptions,
  allComponents: readonly ComponentDef[]
): AdapterEmission {
  // Phase 1 §7.4: navigate handlers require react-router-dom's `useNavigate`,
  // which only exists in the multi-page router shell. Strip them up front and
  // warn — the page body emit then proceeds as if they were never collected.
  const { ir: cleaned, warnings } = stripNavigateForSinglePage(ir)
  // Phase 4 §16.3: an auth guard needs the router's <Navigate> to redirect, which
  // only exists in the multi-page shell. Warn + drop for a single-page compile
  // (the scaffold's `routerAvailable` gate already skips the guard emit).
  if (cleaned.requiresAuth) {
    warnings.push({
      code: 'auth-guard-no-router',
      message: `page ${cleaned.pageName} requiresAuth dropped — a single-page compile has no router to redirect unauthenticated users`
    })
  }
  const files = new Map<string, string | Uint8Array>()
  // Phase 3 §8 v10: drop components no page (transitively) references, so an
  // all-inlined master (e.g. §8 v9 deep-override) leaves no orphan module/class.
  const reachable = reachableComponents([cleaned], allComponents)
  const componentStrip = stripComponentNavigateForSinglePage(reachable)
  const components = componentStrip.components
  warnings.push(...componentStrip.warnings)
  const moduleProject = collectReactModuleProject([cleaned.children], components)
  const motion = buildMotionPlan([cleaned], components, options.devMode)
  const generatedEffect = buildGeneratedEffectPlan([cleaned], components)
  const prototype = buildPrototypePlan(derivePagePaths([cleaned]), components)
  // Phase 3 §15: emit the UI kit's inlined sources for the components rendered
  // here (sets files; returns deps + theme to fold in below).
  const uiKit = resolveUIKit(options)
  const kit = applyUIKit(
    files,
    [cleaned],
    components,
    uiKit,
    options.packaging?.kind === 'microfrontend'
  )
  emitAssets(files, collectAssets([cleaned], components))
  // Phase 3 §9: i18n is active only when the flag is on AND there is text to
  // translate (an empty doc gets no runtime/dep/provider).
  const messages = collectMessages([cleaned], components)
  const i18nActive = options.i18n === true && messages.size > 0
  const toastActive = pageUsesToast(cleaned)
  const confirmActive = pageUsesConfirm(cleaned)
  const validationActive = validationActiveIn([cleaned], components)
  const analyticsActive = analyticsActiveIn([cleaned])
  const serverWorkflows = cleaned.serverWorkflows ?? []
  const analyticsConsentBanner =
    analyticsActive && analyticsRequiresConsent(cleaned.analyticsConfig)
  const translations = cleaned.translations
  const sourceLocale = resolveSourceLocale(options)
  const targetLocales = resolveTargetLocales(options.locales, translations, sourceLocale)
  const extraDeps: Record<string, string> = {
    ...lowcodeStateExtraDeps(cleaned.docStates),
    ...lowcodeSupabaseExtraDeps(cleaned.supabaseConfig),
    ...i18nExtraDeps(i18nActive),
    ...lucideExtraDeps([cleaned], components),
    ...moduleProject.dependencies,
    ...kit.deps
  }
  files.set('package.json', buildPackageJSON(options, extraDeps))
  // Phase 2 §2: emit the lowcode runtime alongside App.tsx when any
  // DocumentStateDef exists; the page module imports `useDocState` /
  // `setDocState` from `./` (single-page) or `../` (multi-page).
  emitLowcodeRuntimes(files, {
    packageName: options.packageName,
    docStates: cleaned.docStates,
    supabaseConfig: cleaned.supabaseConfig,
    i18nActive,
    messages,
    sourceLocale,
    targetLocales,
    translations,
    toastActive,
    confirmActive,
    validationActive,
    analyticsActive,
    analyticsConfig: cleaned.analyticsConfig,
    analyticsConsentBanner,
    microfrontend: options.packaging?.kind === 'microfrontend'
  })
  const executableServerWorkflowFiles = emitServerWorkflowFiles(files, serverWorkflows)
  emitReactModuleRuntimes(files, moduleProject, {
    devMode: options.devMode,
    microfrontend: options.packaging?.kind === 'microfrontend'
  })
  emitRuntimeAndComponentFiles(files, components, options.devMode, uiKit, {
    motion,
    generatedEffect,
    prototype,
    routerAvailable: false
  })
  files.set(
    'src/App.tsx',
    buildAppTsx(cleaned, {
      devMode: options.devMode,
      lowcodeStateImportPath: './_lowcode_state',
      lowcodeSupabaseImportPath: './_lowcode_supabase',
      lowcodeServerImportPath: './_lowcode_server',
      lowcodeToastImportPath: './_lowcode_toast',
      lowcodeConfirmImportPath: './_lowcode_confirm',
      lowcodeValidationImportPath: './_lowcode_validation',
      lowcodeAnalyticsImportPath: './_lowcode_analytics',
      componentImportPrefix: './components/',
      uiKit,
      prototypeRuntime: prototype.runtime !== undefined
    })
  )
  setSharedProjectFiles(
    files,
    options,
    collectClassNames([cleaned], components),
    i18nActive,
    toastActive,
    confirmActive,
    validationActive,
    analyticsActive,
    analyticsConsentBanner,
    motion,
    generatedEffect.runtime !== undefined,
    kit,
    resolveIndexMetadata([cleaned], options)
  )
  // Phase 3 §9 v14: surface untranslated strings per target locale in the build flow.
  const coverage = i18nActive
    ? i18nCoverageWarnings(messages, sourceLocale, targetLocales, translations)
    : []
  return {
    files,
    warnings: [...warnings, ...prototype.warnings, ...coverage],
    ...(executableServerWorkflowFiles.length > 0 ? { executableServerWorkflowFiles } : {})
  }
}

function emitMultiPage(
  irs: readonly IRTree[],
  options: CompilerOptions,
  allComponents: readonly ComponentDef[]
): AdapterEmission {
  const infos = derivePagePaths(irs)
  const files = new Map<string, string | Uint8Array>()
  // Phase 3 §8 v10: prune components unreferenced across all pages (see emitSinglePage).
  const components = reachableComponents(irs, allComponents)
  const moduleProject = collectReactModuleProject(
    irs.map((ir) => ir.children),
    components
  )
  const motion = buildMotionPlan(irs, components, options.devMode)
  const generatedEffect = buildGeneratedEffectPlan(irs, components)
  const prototype = buildPrototypePlan(infos, components)
  // Phase 3 §15: emit the UI kit's inlined sources across all pages.
  const uiKit = resolveUIKit(options)
  const kit = applyUIKit(files, irs, components, uiKit, options.packaging?.kind === 'microfrontend')
  emitAssets(files, collectAssets(irs, components))
  const docStates = irs[0]?.docStates ?? []
  const supabaseConfig = irs[0]?.supabaseConfig
  const analyticsConfig = irs.find((ir) => ir.analyticsConfig)?.analyticsConfig
  const translations = irs.find((ir) => ir.translations)?.translations
  const messages = collectMessages(irs, components)
  const i18nActive = options.i18n === true && messages.size > 0
  const toastActive = irs.some((ir) => pageUsesToast(ir))
  const confirmActive = irs.some((ir) => pageUsesConfirm(ir))
  const validationActive = validationActiveIn(irs, components)
  const analyticsActive = analyticsActiveIn(irs)
  const serverWorkflows =
    irs.find((ir) => (ir.serverWorkflows?.length ?? 0) > 0)?.serverWorkflows ?? []
  const analyticsRouteTracking =
    analyticsConfig !== undefined && analyticsConfig.pageViews !== false && analyticsActive
  const analyticsConsentBanner = analyticsActive && analyticsRequiresConsent(analyticsConfig)
  const sourceLocale = resolveSourceLocale(options)
  const targetLocales = resolveTargetLocales(options.locales, translations, sourceLocale)
  const extraDeps: Record<string, string> = {
    'react-router-dom': REACT_ROUTER_DOM_VERSION,
    ...lowcodeStateExtraDeps(docStates),
    ...lowcodeSupabaseExtraDeps(supabaseConfig),
    ...i18nExtraDeps(i18nActive),
    ...lucideExtraDeps(irs, components),
    ...moduleProject.dependencies,
    ...kit.deps
  }
  files.set('package.json', buildPackageJSON(options, extraDeps))
  emitLowcodeRuntimes(files, {
    packageName: options.packageName,
    docStates,
    supabaseConfig,
    i18nActive,
    messages,
    sourceLocale,
    targetLocales,
    translations,
    toastActive,
    confirmActive,
    validationActive,
    analyticsActive,
    analyticsConfig,
    analyticsRouteTracking,
    analyticsConsentBanner,
    microfrontend: options.packaging?.kind === 'microfrontend'
  })
  const executableServerWorkflowFiles = emitServerWorkflowFiles(files, serverWorkflows)
  emitReactModuleRuntimes(files, moduleProject, {
    devMode: options.devMode,
    microfrontend: options.packaging?.kind === 'microfrontend'
  })
  emitRuntimeAndComponentFiles(files, components, options.devMode, uiKit, {
    motion,
    generatedEffect,
    prototype,
    routerAvailable: true
  })
  files.set(
    'src/App.tsx',
    buildRouterApp(infos, {
      devMode: options.devMode,
      analyticsRouteTracking,
      prototypeRuntime: prototype.runtime !== undefined,
      microfrontend: options.packaging?.kind === 'microfrontend'
    })
  )
  for (const info of infos) {
    files.set(
      `src/pages/${info.file}`,
      buildPageModule(info, {
        devMode: options.devMode,
        lowcodeStateImportPath: '../_lowcode_state',
        lowcodeSupabaseImportPath: '../_lowcode_supabase',
        lowcodeServerImportPath: '../_lowcode_server',
        lowcodeToastImportPath: '../_lowcode_toast',
        lowcodeConfirmImportPath: '../_lowcode_confirm',
        lowcodeValidationImportPath: '../_lowcode_validation',
        lowcodeAnalyticsImportPath: '../_lowcode_analytics',
        componentImportPrefix: '../components/',
        uiKit,
        prototypeRuntime: prototype.runtime !== undefined
      })
    )
  }
  setSharedProjectFiles(
    files,
    options,
    collectClassNames(irs, components),
    i18nActive,
    toastActive,
    confirmActive,
    validationActive,
    analyticsActive,
    analyticsConsentBanner,
    motion,
    generatedEffect.runtime !== undefined,
    kit,
    resolveIndexMetadata(irs, options)
  )
  // Phase 3 §9 v14: surface untranslated strings per target locale in the build flow.
  const coverage = i18nActive
    ? i18nCoverageWarnings(messages, sourceLocale, targetLocales, translations)
    : []
  return {
    files,
    warnings: [...collectSlugWarnings(infos), ...prototype.warnings, ...coverage],
    ...(executableServerWorkflowFiles.length > 0 ? { executableServerWorkflowFiles } : {})
  }
}

function lowcodeStateExtraDeps(
  docStates: readonly IRTree['docStates'][number][]
): Record<string, string> {
  return docStates.length > 0 ? { zustand: ZUSTAND_VERSION } : {}
}

function lowcodeSupabaseExtraDeps(config: IRSupabaseConfig | undefined): Record<string, string> {
  return config ? { '@supabase/supabase-js': SUPABASE_JS_VERSION } : {}
}

function i18nExtraDeps(active: boolean): Record<string, string> {
  return active ? { 'react-intl': REACT_INTL_VERSION } : {}
}

function lucideExtraDeps(
  irs: readonly IRTree[],
  components: readonly ComponentDef[]
): Record<string, string> {
  for (const ir of irs) {
    if (referencedLucideIconNames(ir.children).length > 0) {
      return { 'lucide-react': LUCIDE_REACT_VERSION }
    }
  }
  for (const def of components) {
    if (referencedLucideIconNames(componentBodyNodes(def)).length > 0) {
      return { 'lucide-react': LUCIDE_REACT_VERSION }
    }
  }
  return {}
}

function validationActiveIn(irs: readonly IRTree[], components: readonly ComponentDef[]): boolean {
  return (
    irs.some((ir) => (ir.validatedFields?.length ?? 0) > 0) ||
    components.some((def) => (def.validatedFields?.length ?? 0) > 0)
  )
}

function analyticsActiveIn(irs: readonly IRTree[]): boolean {
  return irs.some((ir) => ir.analyticsConfig !== undefined || pageUsesAnalytics(ir))
}

function analyticsRequiresConsent(config: IRTree['analyticsConfig']): boolean {
  if (config?.consentRequired !== undefined) return config.consentRequired
  return config?.consentRegionPreset === 'eea'
}

/** Phase 3 §9: emit the i18n runtime + source-locale catalog when i18n is
 *  active. The app body's `<FormattedMessage>` calls come from the IR
 *  (`IRText.messageId`); main.tsx wraps `<App/>` in `<I18nProvider>`.
 *
 *  Phase 3 §9 v2: each declared target locale gets a `src/locales/<loc>.json`
 *  stub (pre-filled with the source strings to translate in place) registered
 *  in the runtime, plus a `LocaleSwitcher` component (emitted only when ≥1
 *  target exists — a switcher with just the source locale is pointless). */
/** The resolved per-emission inputs the on-demand lowcode runtime files need. */
interface LowcodeRuntimeEmit {
  packageName: string
  docStates: readonly IRTree['docStates'][number][]
  supabaseConfig: IRSupabaseConfig | undefined
  i18nActive: boolean
  messages: ReadonlyMap<string, string>
  sourceLocale: string
  targetLocales: readonly string[]
  translations: IRTranslations | undefined
  toastActive: boolean
  confirmActive: boolean
  validationActive: boolean
  analyticsActive: boolean
  analyticsConfig: IRTree['analyticsConfig']
  analyticsRouteTracking?: boolean
  analyticsConsentBanner?: boolean
  microfrontend: boolean
}

interface RuntimeAndComponentEmit {
  motion: ReactMotionPlan
  generatedEffect: { runtime?: string }
  prototype: {
    runtime?: string
    prototypeComponentNames: ReadonlySet<string>
  }
  routerAvailable: boolean
}

/** Emit every on-demand lowcode runtime file (doc-state store, Supabase client,
 *  i18n, toast, confirm, validation). Shared by the single-page and multi-page
 *  emitters so the identical call sequence stays in one place (and clone-free). */
function emitLowcodeRuntimes(files: Map<string, string | Uint8Array>, e: LowcodeRuntimeEmit): void {
  maybeEmitLowcodeRuntime(files, e.docStates, e.packageName, e.microfrontend)
  maybeEmitLowcodeSupabaseRuntime(files, e.supabaseConfig)
  maybeEmitI18n(files, e.i18nActive, e.messages, e.sourceLocale, e.targetLocales, e.translations)
  maybeEmitLowcodeToastRuntime(files, e.toastActive)
  maybeEmitLowcodeConfirmRuntime(files, e.confirmActive)
  maybeEmitLowcodeValidationRuntime(files, e.validationActive)
  maybeEmitLowcodeAnalyticsRuntime(
    files,
    e.analyticsActive,
    e.analyticsConfig,
    e.analyticsRouteTracking,
    e.analyticsConsentBanner
  )
}

function emitServerWorkflowFiles(
  files: Map<string, string | Uint8Array>,
  workflows: readonly IRServerWorkflow[]
): readonly string[] {
  if (workflows.length === 0) return []
  const artifacts = buildServerArtifacts(workflows)
  files.set(LOWCODE_SERVER_FILE, buildLowcodeServerClientRuntime())
  const [edgeFunctionPath, envPath, manifestPath, readmePath] =
    LEGACY_SUPABASE_SERVER_WORKFLOW_ARTIFACT_PATHS
  files.set(edgeFunctionPath, artifacts.edgeFunction)
  files.set(envPath, artifacts.envExample)
  files.set(manifestPath, artifacts.manifest)
  files.set(readmePath, artifacts.readme)
  return LEGACY_SUPABASE_SERVER_WORKFLOW_ARTIFACT_PATHS
}

/** Emit runtime artifacts and reusable component modules in their stable order. */
function emitRuntimeAndComponentFiles(
  files: Map<string, string | Uint8Array>,
  components: readonly ComponentDef[],
  devMode: boolean,
  uiKit: UIKitAdapter | null,
  e: RuntimeAndComponentEmit
): void {
  emitMotionFiles(files, e.motion)
  emitGeneratedEffectRuntime(files, e.generatedEffect.runtime)
  emitPrototypeRuntime(files, e.prototype.runtime)
  emitComponentFiles(
    files,
    components,
    devMode,
    uiKit,
    e.motion.animatedComponentNames,
    e.motion.eventComponentNames,
    e.motion.motionScopeComponentNames,
    e.prototype.prototypeComponentNames,
    e.routerAvailable
  )
}

function maybeEmitI18n(
  files: Map<string, string | Uint8Array>,
  active: boolean,
  messages: ReadonlyMap<string, string>,
  sourceLocale: string,
  targetLocales: readonly string[],
  translations: IRTranslations | undefined
): void {
  if (!active) return
  // Source locale catalog is always the source strings (it IS the source).
  files.set(`src/${sourceCatalogPath(sourceLocale)}`, buildLocaleCatalog(messages))
  // Phase 3 §9 v7: each target locale catalog is pre-filled from authored
  // translations (missing entries fall back to the source string).
  for (const loc of targetLocales) {
    files.set(`src/locales/${loc}.json`, buildTranslatedCatalog(messages, translations?.[loc]))
  }
  files.set(LOWCODE_I18N_FILE, buildLowcodeI18nRuntime(sourceLocale, targetLocales))
  if (targetLocales.length > 0) {
    files.set('src/components/LocaleSwitcher.tsx', buildLocaleSwitcher())
    // Phase 3 §9 v10: a build-time translation-coverage report (which source
    // strings each target locale still lacks). Not imported by the app.
    files.set(
      'src/locales/_coverage.json',
      buildI18nCoverageReport(messages, sourceLocale, targetLocales, translations)
    )
  }
}

/** Phase 3 §9 v8 — the configured source locale (the language canvas strings are
 *  authored in), defaulting to `SOURCE_LOCALE` ('en') when unset/blank. */
function resolveSourceLocale(options: CompilerOptions): string {
  const src = options.sourceLocale?.trim()
  return src ? src : SOURCE_LOCALE
}

/** Phase 3 §9 v2/v7: normalize the target locales — the union of the declared
 *  `options.locales` and any locale that carries authored translations (so
 *  authoring a translation is sufficient to wire its catalog + switcher entry).
 *  Drops empties, the source locale, and duplicates (declared order first, then
 *  translation-only locales in catalog order). */
function resolveTargetLocales(
  raw: readonly string[] | undefined,
  translations: IRTranslations | undefined,
  sourceLocale: string
): string[] {
  const seen = new Set<string>([sourceLocale])
  const out: string[] = []
  for (const code of [...(raw ?? []), ...Object.keys(translations ?? {})]) {
    if (typeof code !== 'string' || code === '' || seen.has(code)) continue
    seen.add(code)
    out.push(code)
  }
  return out
}

function maybeEmitLowcodeRuntime(
  files: Map<string, string | Uint8Array>,
  docStates: readonly IRTree['docStates'][number][],
  packageName: string,
  microfrontend: boolean
): void {
  if (docStates.length === 0) return
  files.set(LOWCODE_STATE_FILE, buildLowcodeStateRuntime(docStates, packageName, { microfrontend }))
}

/** Phase 3 §10 v2: emit the toast runtime (`_lowcode_toast.tsx`) when any page
 *  fires a `toast` action. main.tsx mounts `<ToastHost/>`; pages import
 *  `__opToast`. */
function maybeEmitLowcodeToastRuntime(
  files: Map<string, string | Uint8Array>,
  toastActive: boolean
): void {
  if (!toastActive) return
  files.set(LOWCODE_TOAST_FILE, buildLowcodeToastRuntime())
}

/** Phase 3 §10 v3: emit the confirm runtime (`_lowcode_confirm.tsx`) when any
 *  page fires a `confirm` action. main.tsx mounts `<ConfirmHost/>`; pages
 *  import `__opConfirm`. */
function maybeEmitLowcodeConfirmRuntime(
  files: Map<string, string | Uint8Array>,
  confirmActive: boolean
): void {
  if (!confirmActive) return
  files.set(LOWCODE_CONFIRM_FILE, buildLowcodeConfirmRuntime())
}

/** Phase 4 §19: emit the validation runtime (`_lowcode_validation.tsx`) when any
 *  page has a validated field. Pages import `validateValue`; the page glue calls
 *  it from each field's validator closure. */
function maybeEmitLowcodeValidationRuntime(
  files: Map<string, string | Uint8Array>,
  validationActive: boolean
): void {
  if (!validationActive) return
  files.set(LOWCODE_VALIDATION_FILE, buildLowcodeValidationRuntime())
}

function maybeEmitLowcodeSupabaseRuntime(
  files: Map<string, string | Uint8Array>,
  config: IRSupabaseConfig | undefined
): void {
  if (!config) return
  files.set(LOWCODE_SUPABASE_FILE, buildLowcodeSupabaseRuntime(config))
  // §5: the runtime reads import.meta.env — ship the Vite client types (for the
  // standalone `tsc --noEmit`) and a copy-to-.env override template.
  files.set('src/vite-env.d.ts', buildViteEnvDts())
  files.set('.env.example', buildSupabaseEnvExample(config))
}

function maybeEmitLowcodeAnalyticsRuntime(
  files: Map<string, string | Uint8Array>,
  analyticsActive: boolean,
  config: IRTree['analyticsConfig'],
  routeTracking = false,
  consentBanner = false
): void {
  if (!analyticsActive) return
  files.set(
    LOWCODE_ANALYTICS_FILE,
    buildLowcodeAnalyticsRuntime(config, routeTracking, consentBanner)
  )
}

/**
 * Project-shape files that are identical between single-page and multi-page
 * emissions. Lives next to the dispatch so it stays in sync with both
 * branches and stops jscpd flagging the otherwise-near-identical setups.
 */
function setSharedProjectFiles(
  files: Map<string, string | Uint8Array>,
  options: CompilerOptions,
  classNames: string[],
  i18n: boolean,
  toast: boolean,
  confirm: boolean,
  validation: boolean,
  analytics: boolean,
  analyticsConsentBanner: boolean,
  motion: ReactMotionPlan,
  generatedEffectRuntime: boolean,
  kit: { themeCss: string; active: boolean },
  metadata?: HTMLMetadata
): void {
  const themeActive = !!options.themeCss?.trim()
  // Phase 3 §10 v2 / v3 + §19: the toast / confirm / validation-error classes
  // never appear in the IR, so seed them into the Tailwind safelist (the VFS
  // iframe finds no classes on disk). Only seed the runtimes a page actually
  // uses so projects without them stay byte-identical.
  const runtimeClasses = [
    ...(toast ? TOAST_RUNTIME_CLASSES : []),
    ...(confirm ? CONFIRM_RUNTIME_CLASSES : []),
    ...(validation ? [...VALIDATION_ERROR_CLASSES, ...VALIDATION_INVALID_FIELD_CLASSES] : [])
  ]
  const safelist =
    runtimeClasses.length > 0 ? [...new Set([...classNames, ...runtimeClasses])].sort() : classNames
  const needsRuntimeThemeCSS =
    runtimeClasses.length > 0 ||
    classNames.some((className) => LOWCODE_RUNTIME_THEME_UTILITY_RE.test(className))
  // Phase 3 §15: when a UI kit is active, the inlined `@/`-aliased imports need
  // the alias in both tsconfig (standalone tsc) and vite (build/dev resolution),
  // and the kit's theme tokens go into index.css.
  files.set('vite.config.ts', buildViteConfig(kit.active))
  files.set('tsconfig.json', buildTsConfig(kit.active))
  // Phase 3 §9 v12: <html lang>/dir from the configured source locale.
  const htmlLang = resolveSourceLocale(options)
  files.set(
    'index.html',
    buildIndexHTML(options.packageName, htmlLang, isRTLLocale(htmlLang), metadata)
  )
  if (themeActive) files.set(LOWCODE_THEME_FILE, buildLowcodeThemeRuntime())
  files.set(
    'src/main.tsx',
    buildMainTsx(
      i18n,
      toast,
      confirm,
      themeActive,
      resolveThemeSwitchPosition(options),
      analytics,
      analyticsConsentBanner,
      motion.css !== undefined,
      motion.runtime !== undefined,
      generatedEffectRuntime
    )
  )
  const themeCSS = [
    options.themeCss,
    needsRuntimeThemeCSS ? LOWCODE_RUNTIME_THEME_CSS : '',
    kit.themeCss
  ]
    .filter(Boolean)
    .join('\n')
  const microfrontend = options.packaging?.kind === 'microfrontend'
  files.set(
    'src/index.css',
    buildIndexCSS(
      safelist,
      microfrontend ? scopeMicrofrontendCSS(themeCSS) : themeCSS,
      microfrontend ? scopeMicrofrontendCSS(metadata?.customCss ?? '') : metadata?.customCss
    )
  )
  files.set('.gitignore', buildGitignore())
  if (options.devMode) {
    files.set('src/__preview-bridge.ts', buildPreviewBridge())
  }
  if (options.packaging?.kind === 'microfrontend') {
    files.set(MICROFRONTEND_ABI_FILE, buildOpenPencilMicrofrontendTypes())
    files.set(MICROFRONTEND_CONTEXT_FILE, buildReactMicrofrontendContext())
    files.set(
      MICROFRONTEND_ENTRY_FILE,
      buildReactMicrofrontendEntry(options, {
        i18n,
        toast,
        confirm,
        theme: themeActive,
        themeSwitchPosition: resolveThemeSwitchPosition(options),
        analytics,
        analyticsConsentBanner,
        motionCSS: motion.css !== undefined,
        motionRuntime: motion.runtime !== undefined,
        generatedEffectRuntime
      })
    )
  }
}

function buildReactMicrofrontendContext(): string {
  return `import { useSyncExternalStore } from 'react'
import type { OpenPencilMicrofrontendHostContextV1 } from './__microfrontend-abi'

let currentContext: OpenPencilMicrofrontendHostContextV1 | null = null
let mountTarget: HTMLElement | null = null
const listeners = new Set<() => void>()

export function setMicrofrontendContext(
  value: OpenPencilMicrofrontendHostContextV1 | null
): void {
  currentContext = value
  for (const listener of listeners) listener()
}

export function setMicrofrontendMountTarget(value: HTMLElement | null): void {
  mountTarget = value
}

export function microfrontendBasePath(): string {
  return currentContext?.basePath ?? '/'
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function contextSnapshot(): OpenPencilMicrofrontendHostContextV1 | null {
  return currentContext
}

export function useMicrofrontendRouting(): { basePath: string; location: string } {
  const context = useSyncExternalStore(subscribe, contextSnapshot, contextSnapshot)
  const basePath = context?.basePath ?? '/'
  const location = context?.location
  const base = basePath === '/' ? '' : basePath.endsWith('/') ? basePath.slice(0, -1) : basePath
  const pathname = location?.pathname ?? '/'
  const relativePathname = base && (pathname === base || pathname.startsWith(base + '/'))
    ? pathname.slice(base.length) || '/'
    : pathname
  return {
    basePath,
    location: location
      ? \`\${relativePathname}\${location.search}\${location.hash}\`
      : relativePathname
  }
}

export function microfrontendHostContext(): OpenPencilMicrofrontendHostContextV1 | null {
  return currentContext
}

export function microfrontendPortalTarget(): HTMLElement | null {
  if (currentContext?.portalTarget) return currentContext.portalTarget
  const root = mountTarget?.getRootNode()
  return root instanceof Document || root instanceof ShadowRoot
    ? root.querySelector<HTMLElement>('[data-openpencil-portal]')
    : null
}
`
}

interface ReactMicrofrontendRuntimeOptions {
  i18n: boolean
  toast: boolean
  confirm: boolean
  theme: boolean
  themeSwitchPosition?: LowcodeThemeSwitchPosition | false
  analytics: boolean
  analyticsConsentBanner: boolean
  motionCSS: boolean
  motionRuntime: boolean
  generatedEffectRuntime: boolean
}

function buildReactMicrofrontendEntry(
  options: CompilerOptions,
  runtime: ReactMicrofrontendRuntimeOptions
): string {
  const packaging = options.packaging
  if (!packaging) {
    throw new TypeError('React microfrontend entry requires microfrontend packaging')
  }
  const appId = JSON.stringify(packaging.appId)
  const i18nImport = runtime.i18n ? `import { I18nProvider } from './_lowcode_i18n'\n` : ''
  const toastImport = runtime.toast ? `import { ToastHost } from './_lowcode_toast'\n` : ''
  const confirmImport = runtime.confirm ? `import { ConfirmHost } from './_lowcode_confirm'\n` : ''
  const themeSwitchEnabled = runtime.theme && runtime.themeSwitchPosition !== false
  const themeImport = buildMicrofrontendThemeImport(runtime.theme, themeSwitchEnabled)
  const analyticsImport = buildMicrofrontendAnalyticsImport(
    runtime.analytics,
    runtime.analyticsConsentBanner
  )
  const motionImports = buildMicrofrontendMotionImports(runtime.motionCSS, runtime.motionRuntime)
  const effectImport = runtime.generatedEffectRuntime
    ? `import './__generated-effect-runtime'\n`
    : ''
  const runtimeCleanup = buildMicrofrontendRuntimeCleanup(runtime)
  let app = '<App />'
  if (runtime.i18n) app = `<I18nProvider>\n      ${app}\n    </I18nProvider>`
  const themeSwitch =
    typeof runtime.themeSwitchPosition === 'string'
      ? `<LowcodeThemeSwitch position="${runtime.themeSwitchPosition}" />`
      : '<LowcodeThemeSwitch />'
  if (runtime.theme) {
    app = `<LowcodeThemeProvider>\n      ${app}${
      themeSwitchEnabled ? `\n      ${themeSwitch}` : ''
    }\n    </LowcodeThemeProvider>`
  }
  const runtimeChildren = [
    runtime.toast ? '<ToastHost />' : '',
    runtime.confirm ? '<ConfirmHost />' : '',
    runtime.analyticsConsentBanner ? '<LowcodeAnalyticsConsentBanner />' : ''
  ]
    .filter(Boolean)
    .map((child) => `\n    ${child}`)
    .join('')
  return `import { StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { OpenPencilMicrofrontendHostContextV1 } from './__microfrontend-abi'
import App from './App'
import {
  setMicrofrontendContext,
  setMicrofrontendMountTarget
} from './__microfrontend-context'
${i18nImport}${toastImport}${confirmImport}${themeImport}${analyticsImport}${motionImports}${effectImport}import './index.css'

const APP_ID = ${appId}

let root: Root | null = null
let container: HTMLElement | null = null

function assertContext(context: OpenPencilMicrofrontendHostContextV1): void {
  if (context.appId !== APP_ID) {
    throw new Error(\`Microfrontend context appId must be "\${APP_ID}"\`)
  }
  if (!context.basePath.startsWith('/')) {
    throw new Error('Microfrontend basePath must start with /')
  }
}

function hostLocation(context: OpenPencilMicrofrontendHostContextV1): string {
  return \`\${context.location.pathname}\${context.location.search}\${context.location.hash}\`
}

function applyContext(context: OpenPencilMicrofrontendHostContextV1): void {
  assertContext(context)
  setMicrofrontendContext(context)
  const next = hostLocation(context)
  const current = \`\${window.location.pathname}\${window.location.search}\${window.location.hash}\`
  if (next !== current) {
    window.history.replaceState(window.history.state, '', next)
  }
}

export async function bootstrap(): Promise<void> {}

export async function mount(
  target: HTMLElement,
  context: OpenPencilMicrofrontendHostContextV1
): Promise<void> {
  if (root) throw new Error('Microfrontend is already mounted')
  applyContext(context)
  container = target
  setMicrofrontendMountTarget(target)
  root = createRoot(target)
  root.render(
    <StrictMode>
      ${app}${runtimeChildren}
    </StrictMode>
  )
}

export async function update(context: OpenPencilMicrofrontendHostContextV1): Promise<void> {
  if (!root) return
  applyContext(context)
}

export async function unmount(): Promise<void> {
  if (!root) return
  root.unmount()
${runtimeCleanup}  if (container) container.replaceChildren()
  root = null
  container = null
  setMicrofrontendMountTarget(null)
  setMicrofrontendContext(null)
}
`
}

function buildMicrofrontendRuntimeCleanup(runtime: ReactMicrofrontendRuntimeOptions): string {
  return [
    runtime.motionRuntime
      ? `  ;(globalThis as typeof globalThis & { __OPENPENCIL_MOTION_RUNTIME__?: { dispose(): void } })\n    .__OPENPENCIL_MOTION_RUNTIME__?.dispose()`
      : '',
    runtime.generatedEffectRuntime
      ? `  ;(window as Window & { __OPENPENCIL_GENERATED_EFFECT_RUNTIME__?: { dispose(): void } })\n    .__OPENPENCIL_GENERATED_EFFECT_RUNTIME__?.dispose()`
      : ''
  ]
    .filter(Boolean)
    .map((line) => `${line}\n`)
    .join('')
}

function buildMicrofrontendThemeImport(theme: boolean, themeSwitchEnabled: boolean): string {
  if (!theme) return ''
  const switchImport = themeSwitchEnabled ? ', LowcodeThemeSwitch' : ''
  return `import { LowcodeThemeProvider${switchImport} } from './_lowcode_theme'\n`
}

function buildMicrofrontendMotionImports(css: boolean, runtime: boolean): string {
  return `${css ? `import './__motion.css'\n` : ''}${
    runtime ? `import './__motion-runtime'\n` : ''
  }`
}

function buildMicrofrontendAnalyticsImport(analytics: boolean, consentBanner: boolean): string {
  if (consentBanner) {
    return `import { LowcodeAnalyticsConsentBanner } from './_lowcode_analytics'\n`
  }
  return analytics ? `import './_lowcode_analytics'\n` : ''
}

function emitMotionFiles(files: Map<string, string | Uint8Array>, motion: ReactMotionPlan): void {
  if (motion.css !== undefined) files.set('src/__motion.css', motion.css)
  if (motion.runtime !== undefined) files.set('src/__motion-runtime.ts', motion.runtime)
}

function emitGeneratedEffectRuntime(
  files: Map<string, string | Uint8Array>,
  runtime: string | undefined
): void {
  if (runtime !== undefined) files.set(GENERATED_EFFECT_RUNTIME_FILE, runtime)
}

function emitPrototypeRuntime(
  files: Map<string, string | Uint8Array>,
  runtime: string | undefined
): void {
  if (runtime !== undefined) files.set(PROTOTYPE_RUNTIME_FILE, runtime)
}

function resolveIndexMetadata(
  irs: readonly IRTree[],
  options: CompilerOptions
): HTMLMetadata | undefined {
  const base = cleanMetadata(options.metadata)
  const pageOverride =
    irs.length === 1 ? cleanMetadata(options.metadata?.pages?.[irs[0].pageId]) : undefined
  return mergeMetadata(base, pageOverride)
}

function cleanMetadata(metadata: HTMLMetadata | undefined): HTMLMetadata | undefined {
  if (!metadata) return undefined
  const title = cleanMetadataText(metadata.title)
  const description = cleanMetadataText(metadata.description)
  const image = cleanMetadataText(metadata.image)
  const canonicalURL = cleanMetadataText(metadata.canonicalUrl)
  const head = compactLowcodeHeadMetadata(metadata.head)
  const customCSS = cleanMetadataText(metadata.customCss)
  if (!title && !description && !image && !canonicalURL && !head && !customCSS) return undefined
  return {
    title,
    description,
    image,
    canonicalUrl: canonicalURL,
    head,
    customCss: customCSS
  }
}

function mergeMetadata(
  base: HTMLMetadata | undefined,
  override: HTMLMetadata | undefined
): HTMLMetadata | undefined {
  if (!base) return override
  if (!override) return base
  const merged: HTMLMetadata = { ...base }
  if (override.title) merged.title = override.title
  if (override.description) merged.description = override.description
  if (override.image) merged.image = override.image
  if (override.canonicalUrl) merged.canonicalUrl = override.canonicalUrl
  if (override.head) merged.head = override.head
  if (override.customCss) merged.customCss = override.customCss
  return merged
}

function cleanMetadataText(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function emitAssets(files: Map<string, string | Uint8Array>, assets: readonly IRAsset[]): void {
  for (const asset of assets) files.set(asset.path, asset.bytes)
}

function collectAssets(irs: readonly IRTree[], components: readonly ComponentDef[]): IRAsset[] {
  const byPath = new Map<string, IRAsset>()
  for (const ir of irs) {
    for (const asset of ir.assets ?? []) byPath.set(asset.path, asset)
  }
  for (const def of components) {
    for (const asset of def.assets ?? []) byPath.set(asset.path, asset)
  }
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path))
}

function collectSlugWarnings(infos: readonly PagePathInfo[]): CompileWarning[] {
  const warnings: CompileWarning[] = []
  for (const info of infos) {
    if (info.slug === info.originalSlug) continue
    warnings.push({
      code: 'multi-page-duplicate-slug',
      message:
        `Page "${info.ir.pageName}" produced URL slug "${info.originalSlug}" ` +
        `which collided with an earlier page; routed at "${info.route}" instead. ` +
        `Rename the page to silence this warning.`,
      nodeId: info.ir.pageId
    })
  }
  return warnings
}

function collectClassNames(
  irs: readonly IRTree[],
  components: readonly ComponentDef[] = []
): string[] {
  // Seed with the wrapper classes scaffold.ts emits on the page <div>.
  // They never appear in the IR (the wrapper isn't an IRNode), so without
  // this seed Tailwind v4 wouldn't generate them and absolute children lose
  // their reference frame in the VFS-served iframe.
  const acc = new Set<string>(PAGE_WRAPPER_CLASSES)
  for (const ir of irs) {
    for (const child of ir.children) walk(child, acc)
  }
  // Phase 3 §8: component bodies live in their own files, so their classes
  // must reach the safelist too — otherwise an instanced-only component's
  // styles get stripped in the iframe. Phase 3 §8 v4: a COMPONENT_SET's
  // subtrees live per-variant.
  for (const def of components) {
    for (const child of def.children) walk(child, acc)
    for (const variant of def.variants ?? []) {
      for (const child of variant.children) walk(child, acc)
    }
  }
  return [...acc].sort()
}

function walk(node: IRNode, acc: Set<string>): void {
  // Phase 2 §9: IRConditional / IRList carry no className of their own, but
  // their subtrees do. Without descending here, Tailwind's safelist would miss
  // classes on conditionally-rendered or list-templated elements and the
  // iframe would silently strip their CSS.
  if (node.kind === 'conditional') {
    walk(node.consequent, acc)
    return
  }
  if (node.kind === 'list') {
    walk(node.template, acc)
    return
  }
  // Phase 3 §8: a component ref carries the usage-site root classes. Phase 3
  // §8 v3: a className-kind prop value is a Tailwind class string the instance
  // passes into the component body (`badgeClassName="bg-blue-500 .."`) — it
  // never appears as a literal in any file, so it must be safelisted here.
  if (node.kind === 'componentRef') {
    addClasses(node.className, acc)
    for (const prop of node.props) {
      if (prop.kind === 'className' && typeof prop.value === 'string') addClasses(prop.value, acc)
    }
    return
  }
  if (node.kind !== 'element') return
  addClasses(node.className, acc)
  if (node.overlay) {
    for (const cls of OVERLAY_RUNTIME_CLASSES) acc.add(cls)
  }
  for (const child of node.children) walk(child, acc)
}

function addClasses(className: string, acc: Set<string>): void {
  if (!className) return
  for (const cls of className.split(/\s+/)) {
    if (cls) acc.add(cls)
  }
}

/**
 * Phase 3 §9 — the i18n message catalog (id → source string) across every page
 * and component body. Identical strings share one id (the collect-time
 * content-hash), so they collapse onto one entry. ComponentRefs are leaves —
 * a referenced component's text is walked via its own ComponentDef.
 */
function collectMessages(
  irs: readonly IRTree[],
  components: readonly ComponentDef[]
): Map<string, string> {
  const acc = new Map<string, string>()
  for (const ir of irs) {
    for (const child of ir.children) collectText(child, acc)
  }
  for (const def of components) {
    for (const child of def.children) collectText(child, acc)
    for (const variant of def.variants ?? []) {
      for (const child of variant.children) collectText(child, acc)
    }
  }
  return acc
}

function collectText(node: IRNode, acc: Map<string, string>): void {
  if (node.kind === 'text') {
    if (node.messageId !== undefined) acc.set(node.messageId, node.value)
    return
  }
  if (node.kind === 'conditional') {
    collectText(node.consequent, acc)
    return
  }
  if (node.kind === 'list') {
    collectText(node.template, acc)
    return
  }
  if (node.kind !== 'element') return
  // Phase 3 §9 v3: a translated attribute (e.g. placeholder) carries an
  // `intlMessage` value that must land in the catalog like visible text.
  for (const value of Object.values(node.attrs)) {
    if (typeof value === 'object' && value.kind === 'intlMessage') {
      acc.set(value.messageId, value.defaultMessage)
    }
  }
  for (const child of node.children) collectText(child, acc)
}
