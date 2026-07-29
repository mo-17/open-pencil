import type { IRNode, IRTree } from '#compiler/ir/types'

import { buildComponentImports, buildLucideIconImport } from './emit/component'
import { emitElement } from './emit/element'
import { emitListQueryHook } from './emit/list-query'
import { emitStateDecl } from './emit/state'
import {
  hasIntlAttr,
  hasTranslatableText,
  pageHasDocumentStateMotionDriver,
  pageHasNavigateHandler,
  pageHasNavigateParams,
  pageMotionDriverStateIds,
  pageUsesAnalytics,
  pageUsesConfirm,
  pageUsesSupabase,
  pageUsesToast,
  referencedComponentNames,
  referencedLucideIconNames
} from './ir-walk'
import { buildReactIntlImport } from './lowcode/i18n'
import {
  buildValidationGlue,
  validationUsesDocStateSnapshot,
  validationUsesRemote
} from './lowcode/validation'
import { motionDriverToken } from './motion/drivers'
import { motionToken } from './motion/key'
import type { PagePathInfo } from './route-paths'
import { collectKitImports, kitImportLine } from './ui-kit/registry'
import type { UiKitAdapter } from './ui-kit/types'

/**
 * Classes the page wrapper carries on every compiled page. They never appear
 * in the IR (the wrapper isn't an IRNode), so the React adapter must seed
 * them into the Tailwind `@source inline(...)` safelist by hand — otherwise
 * Tailwind v4 won't emit the corresponding utilities in our VFS-served
 * iframe and the absolute-positioned children lose their reference frame.
 */
export const PAGE_WRAPPER_CLASSES = ['relative', 'min-h-screen'] as const
const WRAPPER_CLASS_ATTR = PAGE_WRAPPER_CLASSES.join(' ')

interface BuildPageOptions {
  /** Emit `data-node-id` attributes on every element (canvas↔preview bridge). */
  devMode: boolean
  /** Prepend `import './__preview-bridge'` so the bridge runtime mounts.
   *  Multi-page mode imports it once from the router shell (`App.tsx`); the
   *  per-page modules omit it. */
  importPreviewBridge: boolean
  /** Default-exported function component name. */
  exportName: string
  /** Phase 2 §2: relative path the page module uses to reach
   *  `src/_lowcode_state.ts`. `'./_lowcode_state'` for single-page (App.tsx
   *  sits in `src/`), `'../_lowcode_state'` for multi-page (page modules
   *  sit in `src/pages/`). Only consulted when the page reads or writes
   *  a doc-state. */
  lowcodeStateImportPath: string
  /** Phase 3 §2: relative path the page module uses to reach
   *  `src/_lowcode_supabase.ts`. Mirrors `lowcodeStateImportPath` —
   *  `'./_lowcode_supabase'` for single-page, `'../_lowcode_supabase'`
   *  for multi-page page modules. Only consulted when the page contains
   *  a `supabaseQuery` or `supabaseMutation` handler. */
  lowcodeSupabaseImportPath: string
  /** Phase 3 §10 v2: relative path the page module uses to reach
   *  `src/_lowcode_toast.tsx`. `'./_lowcode_toast'` for single-page,
   *  `'../_lowcode_toast'` for multi-page. Only consulted when the page fires
   *  a `toast` action. */
  lowcodeToastImportPath: string
  /** Phase 3 §10 v3: relative path the page module uses to reach
   *  `src/_lowcode_confirm.tsx`. `'./_lowcode_confirm'` for single-page,
   *  `'../_lowcode_confirm'` for multi-page. Only consulted when the page fires
   *  a `confirm` action. */
  lowcodeConfirmImportPath: string
  /** Phase 4 §19: relative path the page module uses to reach
   *  `src/_lowcode_validation.tsx`. `'./_lowcode_validation'` for single-page,
   *  `'../_lowcode_validation'` for multi-page. Only consulted when the page has
   *  a validated field. */
  lowcodeValidationImportPath: string
  /** Phase 5 §10: relative path to `src/_lowcode_analytics.ts`. */
  lowcodeAnalyticsImportPath: string
  /** Phase 3 §8: relative path prefix to `src/components/` from this file —
   *  `'./components/'` for single-page App.tsx, `'../components/'` for page
   *  modules. Component imports are emitted only for the refs the page uses. */
  componentImportPrefix: string
  /** Phase 3 §15: the active UI kit (or null). Rewrites interactive tags to kit
   *  components + emits their imports. */
  uiKit: UiKitAdapter | null
  /** Phase 4 §16.1: true when this page is rendered inside the multi-page
   *  `<BrowserRouter>` (so `useParams()` has a router context). Route-param
   *  reads (`$params`) only emit when true — single-page `App.tsx` has no
   *  router, so it never imports `useParams`. */
  routerAvailable: boolean
  /** Import the generated browser prototype runtime from this page module. */
  importPrototypeRuntime: boolean
  /** Emit page-scope prototype DOM markers. */
  prototypeRuntime: boolean
}

interface BuildAppOptions {
  /** Emit the canvas↔preview bridge import + `data-node-id` attributes. */
  devMode: boolean
  /** Phase 2 §2: see `BuildPageOptions.lowcodeStateImportPath`. Defaults to
   *  `'./_lowcode_state'` (the single-page default) so existing call sites
   *  that don't carry a doc-state stay unchanged. */
  lowcodeStateImportPath?: string
  /** Phase 3 §2: see `BuildPageOptions.lowcodeSupabaseImportPath`. Defaults
   *  to `'./_lowcode_supabase'` for single-page; multi-page call sites
   *  pass `'../_lowcode_supabase'` explicitly. */
  lowcodeSupabaseImportPath?: string
  /** Phase 3 §10 v2: see `BuildPageOptions.lowcodeToastImportPath`. Defaults to
   *  `'./_lowcode_toast'` (single-page); multi-page pages pass
   *  `'../_lowcode_toast'` explicitly. */
  lowcodeToastImportPath?: string
  /** Phase 3 §10 v3: see `BuildPageOptions.lowcodeConfirmImportPath`. Defaults
   *  to `'./_lowcode_confirm'` (single-page); multi-page pages pass
   *  `'../_lowcode_confirm'` explicitly. */
  lowcodeConfirmImportPath?: string
  /** Phase 4 §19: see `BuildPageOptions.lowcodeValidationImportPath`. Defaults
   *  to `'./_lowcode_validation'` (single-page); multi-page pages pass
   *  `'../_lowcode_validation'` explicitly. */
  lowcodeValidationImportPath?: string
  /** Phase 5 §10: see `BuildPageOptions.lowcodeAnalyticsImportPath`. */
  lowcodeAnalyticsImportPath?: string
  /** Phase 5 §10: multi-page router shell should fire page_view on route changes. */
  analyticsRouteTracking?: boolean
  /** Phase 3 §8: see `BuildPageOptions.componentImportPrefix`. Defaults to
   *  `'./components/'` (single-page); multi-page pages pass `'../components/'`. */
  componentImportPrefix?: string
  /** Phase 3 §15: the active UI kit (or null → plain HTML, byte-identical). */
  uiKit?: UiKitAdapter | null
  /** Phase 4 §16.1: see `BuildPageOptions.routerAvailable`. Defaults to false
   *  (single-page `App.tsx` has no router); `buildPageModule` passes true. */
  routerAvailable?: boolean
  /** Generated project includes `src/__prototype-runtime.ts`. */
  prototypeRuntime?: boolean
}

/**
 * Build `src/App.tsx` for the legacy single-page shape. Equivalent to
 * `buildPageFile(ir, { devMode, importPreviewBridge: devMode, exportName: 'App' })`
 * — kept as a thin wrapper so the single-page test suite stays byte-identical.
 */
export function buildAppTsx(ir: IRTree, options: BuildAppOptions = { devMode: false }): string {
  return buildPageFile(ir, {
    devMode: options.devMode,
    importPreviewBridge: options.devMode,
    exportName: 'App',
    lowcodeStateImportPath: options.lowcodeStateImportPath ?? './_lowcode_state',
    lowcodeSupabaseImportPath: options.lowcodeSupabaseImportPath ?? './_lowcode_supabase',
    lowcodeToastImportPath: options.lowcodeToastImportPath ?? './_lowcode_toast',
    lowcodeConfirmImportPath: options.lowcodeConfirmImportPath ?? './_lowcode_confirm',
    lowcodeValidationImportPath: options.lowcodeValidationImportPath ?? './_lowcode_validation',
    lowcodeAnalyticsImportPath: options.lowcodeAnalyticsImportPath ?? './_lowcode_analytics',
    componentImportPrefix: options.componentImportPrefix ?? './components/',
    uiKit: options.uiKit ?? null,
    importPrototypeRuntime: options.prototypeRuntime === true,
    prototypeRuntime: options.prototypeRuntime === true,
    // Single-page App.tsx is not wrapped in a router → no `useParams` context.
    routerAvailable: false
  })
}

/**
 * Build `src/pages/<slug>.tsx` for one page in a multi-page project.
 * The router shell (`buildRouterApp`) owns the bridge import.
 */
export function buildPageModule(info: PagePathInfo, options: BuildAppOptions): string {
  return buildPageFile(info.ir, {
    devMode: options.devMode,
    importPreviewBridge: false,
    exportName: info.component,
    lowcodeStateImportPath: options.lowcodeStateImportPath ?? '../_lowcode_state',
    lowcodeSupabaseImportPath: options.lowcodeSupabaseImportPath ?? '../_lowcode_supabase',
    lowcodeToastImportPath: options.lowcodeToastImportPath ?? '../_lowcode_toast',
    lowcodeConfirmImportPath: options.lowcodeConfirmImportPath ?? '../_lowcode_confirm',
    lowcodeValidationImportPath: options.lowcodeValidationImportPath ?? '../_lowcode_validation',
    lowcodeAnalyticsImportPath: options.lowcodeAnalyticsImportPath ?? '../_lowcode_analytics',
    componentImportPrefix: options.componentImportPrefix ?? '../components/',
    uiKit: options.uiKit ?? null,
    importPrototypeRuntime: false,
    prototypeRuntime: options.prototypeRuntime === true,
    // Multi-page modules render inside `<BrowserRouter>` → `useParams` is valid.
    routerAvailable: true
  })
}

/**
 * Build the multi-page router shell `src/App.tsx`. Uses `BrowserRouter` from
 * `react-router-dom@^6.27` per Phase 1 §11.3 decision #2.
 */
export function buildRouterApp(infos: readonly PagePathInfo[], options: BuildAppOptions): string {
  const bridgeImport = options.devMode ? `import './__preview-bridge'\n` : ''
  const prototypeImport = options.prototypeRuntime ? `import './__prototype-runtime'\n` : ''
  const routerImport = `import { BrowserRouter, Route, Routes } from 'react-router-dom'\n`
  const analyticsImport = options.analyticsRouteTracking
    ? `import { LowcodeAnalyticsRouteTracker } from './_lowcode_analytics'\n`
    : ''
  const pageImports = infos
    .map((info) => `import ${info.component} from './pages/${info.slug}'`)
    .join('\n')
  const importBlock = `${bridgeImport}${prototypeImport}${routerImport}${analyticsImport}${pageImports}\n\n`
  const routes = infos
    .map((info) => `        <Route path="${info.route}" element={<${info.component} />} />`)
    .join('\n')
  const analyticsTracker = options.analyticsRouteTracking
    ? `      <LowcodeAnalyticsRouteTracker />\n`
    : ''
  return `${importBlock}export default function App() {
  return (
    <BrowserRouter>
${analyticsTracker}
      <Routes>
${routes}
      </Routes>
    </BrowserRouter>
  )
}
`
}

/**
 * Shared page-file template. Hoists every page-scoped state into a `useState`
 * declaration, declares a `useNavigate` hook when any navigate action is
 * present on the page (Phase 1 §7.4), then renders the IR tree inside the
 * wrapper div.
 */
/** Which react-router-dom hooks/components a page module pulls in. */
interface RouterUsage {
  needsNavigate: boolean
  usesRouteParams: boolean
  usesQueryParams: boolean
  guarded: boolean
}

/** Build the single `react-router-dom` named import a page module needs:
 *  `useNavigate` (navigate handlers), `generatePath` (§16.2 navigate-with-params),
 *  `useParams` (§16.1 `$params`), `useSearchParams` (§16.4 `$query`), `Navigate`
 *  (§16.3 auth guard). Empty when none apply. Extracted to keep `buildPageFile`
 *  under the complexity limit. */
function buildRouterImport(ir: IRTree, u: RouterUsage): string {
  const routerNames: string[] = []
  if (u.needsNavigate) routerNames.push('useNavigate')
  if (u.needsNavigate && pageHasNavigateParams(ir)) routerNames.push('generatePath')
  if (u.usesRouteParams) routerNames.push('useParams')
  if (u.usesQueryParams) routerNames.push('useSearchParams')
  if (u.guarded) routerNames.push('Navigate')
  return routerNames.length > 0
    ? `import { ${routerNames.join(', ')} } from 'react-router-dom'\n`
    : ''
}

/** The router-derived hook lines hoisted at the top of a page component, in
 *  declaration order: `useNavigate`, `$params` (§16.1), `$query` (§16.4).
 *  Extracted to keep `buildPageFile` under the complexity limit. */
function buildRouterHookLines(u: RouterUsage): string[] {
  const lines: string[] = []
  if (u.needsNavigate) lines.push('  const navigate = useNavigate()')
  if (u.usesRouteParams) lines.push('  const $params = useParams()')
  // §16.4: URLSearchParams → a plain object so `$query.foo` member access works.
  if (u.usesQueryParams) lines.push('  const $query = Object.fromEntries(useSearchParams()[0])')
  return lines
}

/** §17: the single `react` named import a page needs — `useState` for page
 *  state and/or a Supabase-query LIST's rows, `useEffect` for the LIST fetch
 *  hook, and `useRef` for remote validation cancellation. Extracted to keep
 *  `buildPageFile` under the complexity limit. */
function buildReactImport(ir: IRTree): string {
  const hasListQueries = (ir.listQueries?.length ?? 0) > 0
  // Phase 4 §19: a validated page needs `useState` for its field-errors store.
  const hasValidation = (ir.validatedFields?.length ?? 0) > 0
  const hasRemoteValidation = validationUsesRemote(ir.validatedFields ?? [])
  const hasComputedState = ir.states.some((s) => s.computed)
  const hasWritableState = ir.states.some((s) => !s.computed && s.computedInvalid !== true)
  const hooks: string[] = []
  if (hasWritableState || hasListQueries || hasValidation) hooks.push('useState')
  if (hasRemoteValidation) hooks.push('useRef')
  if (hasComputedState) hooks.push('useMemo')
  if (hasListQueries || buildMotionDriverStateHooks(ir) !== '') hooks.push('useEffect')
  return hooks.length > 0 ? `import { ${hooks.join(', ')} } from 'react'\n` : ''
}

function buildPageFile(ir: IRTree, options: BuildPageOptions): string {
  const {
    devMode,
    importPreviewBridge,
    exportName,
    lowcodeStateImportPath,
    lowcodeSupabaseImportPath,
    lowcodeToastImportPath,
    lowcodeConfirmImportPath,
    lowcodeValidationImportPath,
    lowcodeAnalyticsImportPath,
    componentImportPrefix,
    uiKit,
    routerAvailable,
    importPrototypeRuntime,
    prototypeRuntime
  } = options
  const bridgeImport = importPreviewBridge ? `import './__preview-bridge'\n` : ''
  const prototypeImport = importPrototypeRuntime ? `import './__prototype-runtime'\n` : ''
  const reactImport = buildReactImport(ir)
  // Phase 4 §16.1/§16.3/§16.4: the route-bound built-ins (`$params`, `$query`)
  // and the auth guard only resolve inside the multi-page router; single-page
  // App.tsx has no router context (guard is warned + dropped in emitSinglePage).
  const usage: RouterUsage = {
    needsNavigate: pageHasNavigateHandler(ir),
    usesRouteParams: routerAvailable && ir.usesRouteParams,
    usesQueryParams: routerAvailable && ir.usesQueryParams === true,
    guarded: routerAvailable && ir.requiresAuth === true
  }
  const routerImport = buildRouterImport(ir, usage)
  const lowcodeStateImport = buildLowcodeStateImport(ir, lowcodeStateImportPath)
  // Phase 3 §2 / §10 + §19: the on-demand lowcode runtime imports (Supabase
  // client, toast/confirm prompters, validation helper).
  const lowcodeRuntimeImports = buildLowcodeRuntimeImports(ir, {
    supabase: lowcodeSupabaseImportPath,
    toast: lowcodeToastImportPath,
    confirm: lowcodeConfirmImportPath,
    validation: lowcodeValidationImportPath,
    analytics: lowcodeAnalyticsImportPath
  })
  // Phase 3 §8: import the components this page references.
  const componentNames = referencedComponentNames(ir.children)
  const componentImports = buildComponentImports(componentNames, componentImportPrefix)
  const componentImportBlock = componentImports ? `${componentImports}\n` : ''
  const lucideImport = buildLucideIconImport(referencedLucideIconNames(ir.children))
  // Phase 3 §15: import the kit components this page renders (one per used
  // component, e.g. `import { Button } from '@/components/ui/button'`).
  const kitImportBlock = buildKitImports(ir.children, uiKit)
  // Phase 3 §9: import FormattedMessage for visible text, useIntl for
  // translated attributes (§9 v3, e.g. placeholder).
  const usesIntlAttr = hasIntlAttr(ir.children)
  const i18nImport = buildReactIntlImport({
    formattedMessage: hasTranslatableText(ir.children),
    intl: usesIntlAttr
  })
  const importBlock =
    bridgeImport +
    prototypeImport +
    reactImport +
    routerImport +
    lowcodeStateImport +
    lowcodeRuntimeImports +
    componentImportBlock +
    lucideImport +
    kitImportBlock +
    i18nImport
  const importPrefix = importBlock ? `${importBlock}\n` : ''
  const stateLines = ir.states.map((s) => emitStateDecl(s, 1)).join('\n')
  const motionDriverStateLines = buildMotionDriverStateHooks(ir)
  // Phase 4 §16.1/§16.2/§16.4: useNavigate / $params / $query hook lines.
  const routerHookLines = buildRouterHookLines(usage).join('\n')
  const docStateReadLines = ir.docStateReads
    .map((name) => `  const ${name} = useDocState(${JSON.stringify(name)})`)
    .join('\n')
  // §17: per-LIST Supabase fetch hooks. Emitted after the state / docState /
  // router hooks above so their effect deps (page-state, doc-state, `$params`)
  // reference locals already declared.
  const listQueryLines = (ir.listQueries ?? []).map(emitListQueryHook).join('\n')
  // §9 v3: a `const intl = useIntl()` hook for any translated attribute.
  const intlHookLine = usesIntlAttr ? '  const intl = useIntl()' : ''
  // Phase 4 §19: the field-errors store + `__validators` map + validate
  // helpers. After the doc-state hoists (custom-rule exprs reference them).
  const validationGlue =
    (ir.validatedFields?.length ?? 0) > 0 ? buildValidationGlue(ir.validatedFields ?? []) : ''
  // Phase 4 §16.3: redirect-if-unauthenticated guard. Comes after the hooks (it
  // reads the `$currentUser` doc-state declared above) and short-circuits the
  // render before the page body when the session isn't signed in.
  const guardLine = usage.guarded
    ? `  if (!$currentUser.signedIn) return <Navigate to="${ir.authRedirect ?? '/login'}" replace />`
    : ''

  const hookLines = [
    docStateReadLines,
    routerHookLines,
    stateLines,
    motionDriverStateLines,
    listQueryLines,
    validationGlue,
    intlHookLine,
    guardLine
  ]
    .filter((l) => l !== '')
    .join('\n')

  const wrapperOpen = `<div className="${WRAPPER_CLASS_ATTR}"${pageMotionAttrs(ir, devMode)}${pagePrototypeAttrs(ir, prototypeRuntime)}>`

  if (ir.children.length === 0) {
    if (hookLines === '') {
      return `${importPrefix}export default function ${exportName}() {
  return ${wrapperOpen}</div>
}
`
    }
    return `${importPrefix}export default function ${exportName}() {
${hookLines}
  return ${wrapperOpen}</div>
}
`
  }

  const body = ir.children.map((c) => emitElement(c, 3, devMode, uiKit)).join('\n')
  const hookPrefix = hookLines !== '' ? `${hookLines}\n` : ''
  return `${importPrefix}export default function ${exportName}() {
${hookPrefix}  return (
    ${wrapperOpen}
${body}
    </div>
  )
}
`
}

function buildMotionDriverStateHooks(ir: IRTree): string {
  const ids = pageMotionDriverStateIds(ir)
  return ir.states
    .filter((state) => ids.has(state.id) && (state.type === 'number' || state.type === 'boolean'))
    .map(
      (state) => `  useEffect(() => {
    const updateMotionDriver = () => {
      ;(window as unknown as {
        __OPENPENCIL_MOTION_DRIVERS__?: {
          setPageState(stateId: string, value: number | boolean): number
        }
      }).__OPENPENCIL_MOTION_DRIVERS__?.setPageState(${JSON.stringify(state.id)}, ${state.name})
    }
    updateMotionDriver()
    window.addEventListener('op-motion-drivers-ready', updateMotionDriver)
    return () => window.removeEventListener('op-motion-drivers-ready', updateMotionDriver)
  }, [${state.name}])`
    )
    .join('\n')
}

function pageMotionAttrs(ir: IRTree, devMode: boolean): string {
  const attrs: string[] = []
  if (devMode || ir.motion || ir.motionDrivers || ir.motionDriverMarker || ir.motionScene) {
    attrs.push(`data-node-id="${escapeAttribute(ir.pageId)}"`)
  }
  if (ir.motionScene) {
    attrs.push(`data-op-motion-scene-owner="${escapeAttribute(ir.pageId)}"`)
  }
  if (ir.motion) attrs.push(`data-op-motion="${motionToken(ir.motion)}"`)
  if (ir.motionDrivers) {
    attrs.push(
      `data-op-motion-drivers="${motionDriverToken(ir.motionDrivers)}"`,
      'data-op-motion-scope'
    )
  }
  return attrs.length > 0 ? ` ${attrs.join(' ')}` : ''
}

function pagePrototypeAttrs(ir: IRTree, active: boolean): string {
  if (!active) return ''
  const attrs = [
    `data-op-prototype-page="${escapeAttribute(ir.pageId)}"`,
    `data-op-prototype-node="${escapeAttribute(ir.pageId)}"`
  ]
  if (ir.prototype) attrs.push('data-op-prototype-source')
  if (ir.prototype?.connections.some(({ trigger }) => trigger.kind === 'click')) {
    attrs.push('data-op-prototype-keyboard', 'role="button"', 'tabIndex={0}')
  }
  if (ir.transitionKey) {
    attrs.push(`data-op-transition-key="${escapeAttribute(ir.transitionKey)}"`)
  }
  return ` ${attrs.join(' ')}`
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

/**
 * Phase 2 §2: build the `import { useDocState, setDocState } from '<path>'`
 * line. `useDocState` is included only if the page reads at least one
 * doc-state; `setDocState` only if it writes at least one. When neither is
 * needed the function returns an empty string and the page omits the import.
 */
/** Phase 3 §2 / §10 v2 / v3 + §19: the lowcode runtime imports a page pulls in
 *  on demand — the Supabase client, the toast / confirm prompters, and the
 *  validation helper. Extracted from `buildPageFile` to keep it under the
 *  cyclomatic-complexity gate (each gate is its own branch). */
function buildLowcodeRuntimeImports(
  ir: IRTree,
  paths: { supabase: string; toast: string; confirm: string; validation: string; analytics: string }
): string {
  const supabase = pageUsesSupabase(ir)
    ? `import { getSupabaseClient } from '${paths.supabase}'\n`
    : ''
  const toast = pageUsesToast(ir) ? `import { __opToast } from '${paths.toast}'\n` : ''
  const confirm = pageUsesConfirm(ir) ? `import { __opConfirm } from '${paths.confirm}'\n` : ''
  const validation =
    (ir.validatedFields?.length ?? 0) > 0
      ? `import { ${validationImportNames(ir.validatedFields ?? []).join(', ')} } from '${paths.validation}'\n`
      : ''
  const analytics = pageUsesAnalytics(ir)
    ? `import { __opTrackEvent } from '${paths.analytics}'\n`
    : ''
  return supabase + toast + confirm + validation + analytics
}

function validationImportNames(
  fields: readonly NonNullable<IRTree['validatedFields']>[number][]
): string[] {
  const names = ['validateValue']
  if (validationUsesRemote(fields)) names.push('validateRemote')
  return names.sort()
}

function buildLowcodeStateImport(ir: IRTree, path: string): string {
  const names: string[] = []
  if (ir.docStateReads.length > 0) names.push('useDocState')
  if (ir.docStateWrites.length > 0) names.push('setDocState')
  // Phase 4 §19: a doc-state-bound validated field reads its value fresh at
  // validate time via `getDocStateSnapshot` (dodging the render-snapshot).
  if (validationUsesDocStateSnapshot(ir.validatedFields ?? [])) names.push('getDocStateSnapshot')
  if (names.length === 0) {
    return pageHasDocumentStateMotionDriver(ir) ? `import '${path}'\n` : ''
  }
  return `import { ${names.join(', ')} } from '${path}'\n`
}

/**
 * Phase 3 §15: the `import { <Component> } from '@/components/ui/<name>'` lines
 * for every kit component the subtree renders. Returns '' (→ byte-identical)
 * when no kit is active or no interactive node maps.
 */
export function buildKitImports(nodes: readonly IRNode[], uiKit: UiKitAdapter | null): string {
  if (!uiKit) return ''
  const mappings = collectKitImports(nodes, uiKit)
  if (mappings.length === 0) return ''
  return mappings.map(kitImportLine).join('\n') + '\n'
}
