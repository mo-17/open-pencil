import {
  buildGitignore,
  buildIndexCss,
  buildIndexHtml,
  buildMainTsx,
  buildPackageJson,
  buildTsConfig,
  buildViteConfig
} from '#compiler/project'
import type { ComponentDef, IRNode, IRSupabaseConfig, IRTranslations, IRTree } from '#compiler/ir/types'
import type { CompilerOptions, CompileWarning } from '#compiler/types'

import type { AdapterEmission, FrameworkAdapter } from '../types'

import { buildComponentModule } from './emit/component'
import {
  buildI18nCoverageReport,
  buildLocaleCatalog,
  buildLocaleSwitcher,
  buildLowcodeI18nRuntime,
  buildTranslatedCatalog,
  isRtlLocale,
  REACT_INTL_VERSION,
  sourceCatalogPath,
  SOURCE_LOCALE
} from './lowcode/i18n'
import { pageUsesConfirm, pageUsesToast, stripNavigateForSinglePage } from './ir-walk'
import { buildLowcodeStateRuntime, ZUSTAND_VERSION } from './lowcode/state'
import { buildLowcodeToastRuntime, TOAST_RUNTIME_CLASSES } from './lowcode/toast'
import { buildLowcodeConfirmRuntime, CONFIRM_RUNTIME_CLASSES } from './lowcode/confirm'
import {
  buildLowcodeSupabaseRuntime,
  buildSupabaseEnvExample,
  buildViteEnvDts,
  SUPABASE_JS_VERSION
} from './lowcode/supabase'
import { buildPreviewBridge } from './preview-bridge'
import { derivePagePaths, type PagePathInfo } from './route-paths'
import {
  buildAppTsx,
  buildPageModule,
  buildRouterApp,
  PAGE_WRAPPER_CLASSES
} from './scaffold'

/**
 * Pinned alongside `react: ^19.2.0` / `react: ^18.3.1` — `react-router-dom@6`
 * supports both. Lock to 6.27 minimum (the line that added React 19 support)
 * to avoid older v6 versions crashing under `<StrictMode>` in React 19.
 */
const REACT_ROUTER_DOM_VERSION = '^6.27.0'

const LOWCODE_STATE_FILE = 'src/_lowcode_state.ts'
const LOWCODE_SUPABASE_FILE = 'src/_lowcode_supabase.ts'
const LOWCODE_I18N_FILE = 'src/_lowcode_i18n.tsx'
const LOWCODE_TOAST_FILE = 'src/_lowcode_toast.tsx'
const LOWCODE_CONFIRM_FILE = 'src/_lowcode_confirm.tsx'

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
  devMode: boolean
): void {
  for (const def of components) {
    files.set(`src/components/${def.name}.tsx`, buildComponentModule(def, devMode))
  }
}

function emitSinglePage(
  ir: IRTree,
  options: CompilerOptions,
  components: readonly ComponentDef[]
): AdapterEmission {
  // Phase 1 §7.4: navigate handlers require react-router-dom's `useNavigate`,
  // which only exists in the multi-page router shell. Strip them up front and
  // warn — the page body emit then proceeds as if they were never collected.
  const { ir: cleaned, warnings } = stripNavigateForSinglePage(ir)
  const files = new Map<string, string | Uint8Array>()
  // Phase 3 §9: i18n is active only when the flag is on AND there is text to
  // translate (an empty doc gets no runtime/dep/provider).
  const messages = collectMessages([cleaned], components)
  const i18nActive = options.i18n === true && messages.size > 0
  const toastActive = pageUsesToast(cleaned)
  const confirmActive = pageUsesConfirm(cleaned)
  const translations = cleaned.translations
  const sourceLocale = resolveSourceLocale(options)
  const targetLocales = resolveTargetLocales(options.locales, translations, sourceLocale)
  const extraDeps: Record<string, string> = {
    ...lowcodeStateExtraDeps(cleaned.docStates),
    ...lowcodeSupabaseExtraDeps(cleaned.supabaseConfig),
    ...i18nExtraDeps(i18nActive)
  }
  files.set('package.json', buildPackageJson(options, extraDeps))
  // Phase 2 §2: emit the lowcode runtime alongside App.tsx when any
  // DocumentStateDef exists; the page module imports `useDocState` /
  // `setDocState` from `./` (single-page) or `../` (multi-page).
  maybeEmitLowcodeRuntime(files, cleaned.docStates)
  maybeEmitLowcodeSupabaseRuntime(files, cleaned.supabaseConfig)
  maybeEmitI18n(files, i18nActive, messages, sourceLocale, targetLocales, translations)
  maybeEmitLowcodeToastRuntime(files, toastActive)
  maybeEmitLowcodeConfirmRuntime(files, confirmActive)
  emitComponentFiles(files, components, options.devMode)
  files.set(
    'src/App.tsx',
    buildAppTsx(cleaned, {
      devMode: options.devMode,
      lowcodeStateImportPath: './_lowcode_state',
      lowcodeSupabaseImportPath: './_lowcode_supabase',
      lowcodeToastImportPath: './_lowcode_toast',
      lowcodeConfirmImportPath: './_lowcode_confirm',
      componentImportPrefix: './components/'
    })
  )
  setSharedProjectFiles(
    files,
    options,
    collectClassNames([cleaned], components),
    i18nActive,
    toastActive,
    confirmActive
  )
  return { files, warnings }
}

function emitMultiPage(
  irs: readonly IRTree[],
  options: CompilerOptions,
  components: readonly ComponentDef[]
): AdapterEmission {
  const infos = derivePagePaths(irs)
  const files = new Map<string, string | Uint8Array>()
  const docStates = irs[0]?.docStates ?? []
  const supabaseConfig = irs[0]?.supabaseConfig
  const translations = irs.find((ir) => ir.translations)?.translations
  const messages = collectMessages(irs, components)
  const i18nActive = options.i18n === true && messages.size > 0
  const toastActive = irs.some((ir) => pageUsesToast(ir))
  const confirmActive = irs.some((ir) => pageUsesConfirm(ir))
  const sourceLocale = resolveSourceLocale(options)
  const targetLocales = resolveTargetLocales(options.locales, translations, sourceLocale)
  const extraDeps: Record<string, string> = {
    'react-router-dom': REACT_ROUTER_DOM_VERSION,
    ...lowcodeStateExtraDeps(docStates),
    ...lowcodeSupabaseExtraDeps(supabaseConfig),
    ...i18nExtraDeps(i18nActive)
  }
  files.set('package.json', buildPackageJson(options, extraDeps))
  maybeEmitLowcodeRuntime(files, docStates)
  maybeEmitLowcodeSupabaseRuntime(files, supabaseConfig)
  maybeEmitI18n(files, i18nActive, messages, sourceLocale, targetLocales, translations)
  maybeEmitLowcodeToastRuntime(files, toastActive)
  maybeEmitLowcodeConfirmRuntime(files, confirmActive)
  emitComponentFiles(files, components, options.devMode)
  files.set('src/App.tsx', buildRouterApp(infos, { devMode: options.devMode }))
  for (const info of infos) {
    files.set(
      `src/pages/${info.file}`,
      buildPageModule(info, {
        devMode: options.devMode,
        lowcodeStateImportPath: '../_lowcode_state',
        lowcodeSupabaseImportPath: '../_lowcode_supabase',
        lowcodeToastImportPath: '../_lowcode_toast',
        lowcodeConfirmImportPath: '../_lowcode_confirm',
        componentImportPrefix: '../components/'
      })
    )
  }
  setSharedProjectFiles(
    files,
    options,
    collectClassNames(irs, components),
    i18nActive,
    toastActive,
    confirmActive
  )
  return { files, warnings: collectSlugWarnings(infos) }
}

function lowcodeStateExtraDeps(
  docStates: readonly IRTree['docStates'][number][]
): Record<string, string> {
  return docStates.length > 0 ? { zustand: ZUSTAND_VERSION } : {}
}

function lowcodeSupabaseExtraDeps(
  config: IRSupabaseConfig | undefined
): Record<string, string> {
  return config ? { '@supabase/supabase-js': SUPABASE_JS_VERSION } : {}
}

function i18nExtraDeps(active: boolean): Record<string, string> {
  return active ? { 'react-intl': REACT_INTL_VERSION } : {}
}

/** Phase 3 §9: emit the i18n runtime + source-locale catalog when i18n is
 *  active. The app body's `<FormattedMessage>` calls come from the IR
 *  (`IRText.messageId`); main.tsx wraps `<App/>` in `<I18nProvider>`.
 *
 *  Phase 3 §9 v2: each declared target locale gets a `src/locales/<loc>.json`
 *  stub (pre-filled with the source strings to translate in place) registered
 *  in the runtime, plus a `LocaleSwitcher` component (emitted only when ≥1
 *  target exists — a switcher with just the source locale is pointless). */
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
    files.set('src/locales/_coverage.json', buildI18nCoverageReport(messages, sourceLocale, targetLocales, translations))
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
  docStates: readonly IRTree['docStates'][number][]
): void {
  if (docStates.length === 0) return
  files.set(LOWCODE_STATE_FILE, buildLowcodeStateRuntime(docStates))
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
  confirm: boolean
): void {
  // Phase 3 §10 v2 / v3: the toast + confirm runtimes' classes never appear in
  // the IR, so seed them into the Tailwind safelist (the VFS iframe finds no
  // classes on disk). Only seed the runtimes a page actually uses so projects
  // without them stay byte-identical.
  const runtimeClasses = [
    ...(toast ? TOAST_RUNTIME_CLASSES : []),
    ...(confirm ? CONFIRM_RUNTIME_CLASSES : [])
  ]
  const safelist =
    runtimeClasses.length > 0 ? [...new Set([...classNames, ...runtimeClasses])].sort() : classNames
  files.set('vite.config.ts', buildViteConfig())
  files.set('tsconfig.json', buildTsConfig())
  // Phase 3 §9 v12: <html lang>/dir from the configured source locale.
  const htmlLang = resolveSourceLocale(options)
  files.set('index.html', buildIndexHtml(options.packageName, htmlLang, isRtlLocale(htmlLang)))
  files.set('src/main.tsx', buildMainTsx(i18n, toast, confirm))
  files.set('src/index.css', buildIndexCss(safelist))
  files.set('.gitignore', buildGitignore())
  if (options.devMode) {
    files.set('src/__preview-bridge.ts', buildPreviewBridge())
  }
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
      if (prop.kind === 'className') addClasses(prop.value, acc)
    }
    return
  }
  if (node.kind !== 'element') return
  addClasses(node.className, acc)
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
    if (typeof value === 'object') acc.set(value.messageId, value.defaultMessage)
  }
  for (const child of node.children) collectText(child, acc)
}
