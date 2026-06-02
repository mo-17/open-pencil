import type { IRTree } from '#compiler/ir/types'

import { buildComponentImports } from './emit/component'
import { emitElement } from './emit/element'
import { emitStateDecl } from './emit/state'
import {
  hasIntlAttr,
  hasTranslatableText,
  pageHasNavigateHandler,
  pageUsesSupabase,
  referencedComponentNames
} from './ir-walk'
import { buildReactIntlImport } from './lowcode/i18n'
import type { PagePathInfo } from './route-paths'

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
  /** Phase 3 §8: relative path prefix to `src/components/` from this file —
   *  `'./components/'` for single-page App.tsx, `'../components/'` for page
   *  modules. Component imports are emitted only for the refs the page uses. */
  componentImportPrefix: string
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
  /** Phase 3 §8: see `BuildPageOptions.componentImportPrefix`. Defaults to
   *  `'./components/'` (single-page); multi-page pages pass `'../components/'`. */
  componentImportPrefix?: string
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
    componentImportPrefix: options.componentImportPrefix ?? './components/'
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
    componentImportPrefix: options.componentImportPrefix ?? '../components/'
  })
}

/**
 * Build the multi-page router shell `src/App.tsx`. Uses `BrowserRouter` from
 * `react-router-dom@^6.27` per Phase 1 §11.3 decision #2.
 */
export function buildRouterApp(
  infos: readonly PagePathInfo[],
  options: BuildAppOptions
): string {
  const bridgeImport = options.devMode ? `import './__preview-bridge'\n` : ''
  const routerImport = `import { BrowserRouter, Route, Routes } from 'react-router-dom'\n`
  const pageImports = infos
    .map((info) => `import ${info.component} from './pages/${info.slug}'`)
    .join('\n')
  const importBlock = `${bridgeImport}${routerImport}${pageImports}\n\n`
  const routes = infos
    .map((info) => `        <Route path="${info.route}" element={<${info.component} />} />`)
    .join('\n')
  return `${importBlock}export default function App() {
  return (
    <BrowserRouter>
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
function buildPageFile(ir: IRTree, options: BuildPageOptions): string {
  const { devMode, importPreviewBridge, exportName, lowcodeStateImportPath, lowcodeSupabaseImportPath, componentImportPrefix } = options
  const bridgeImport = importPreviewBridge ? `import './__preview-bridge'\n` : ''
  const reactImport = ir.states.length > 0 ? `import { useState } from 'react'\n` : ''
  const needsNavigate = pageHasNavigateHandler(ir)
  const routerImport = needsNavigate
    ? `import { useNavigate } from 'react-router-dom'\n`
    : ''
  const lowcodeStateImport = buildLowcodeStateImport(ir, lowcodeStateImportPath)
  const lowcodeSupabaseImport = pageUsesSupabase(ir)
    ? `import { getSupabaseClient } from '${lowcodeSupabaseImportPath}'\n`
    : ''
  // Phase 3 §8: import the components this page references.
  const componentNames = referencedComponentNames(ir.children)
  const componentImports = buildComponentImports(componentNames, componentImportPrefix)
  const componentImportBlock = componentImports ? `${componentImports}\n` : ''
  // Phase 3 §9: import FormattedMessage for visible text, useIntl for
  // translated attributes (§9 v3, e.g. placeholder).
  const usesIntlAttr = hasIntlAttr(ir.children)
  const i18nImport = buildReactIntlImport({
    formattedMessage: hasTranslatableText(ir.children),
    intl: usesIntlAttr
  })
  const importBlock = bridgeImport + reactImport + routerImport + lowcodeStateImport + lowcodeSupabaseImport + componentImportBlock + i18nImport
  const importPrefix = importBlock ? `${importBlock}\n` : ''
  const stateLines = ir.states.map((s) => emitStateDecl(s, 1)).join('\n')
  const navigateLine = needsNavigate ? '  const navigate = useNavigate()' : ''
  const docStateReadLines = ir.docStateReads
    .map((name) => `  const ${name} = useDocState(${JSON.stringify(name)})`)
    .join('\n')
  // §9 v3: a `const intl = useIntl()` hook for any translated attribute.
  const intlHookLine = usesIntlAttr ? '  const intl = useIntl()' : ''

  const hookLines = [stateLines, docStateReadLines, navigateLine, intlHookLine]
    .filter((l) => l !== '')
    .join('\n')

  const wrapperOpen = `<div className="${WRAPPER_CLASS_ATTR}">`

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

  const body = ir.children.map((c) => emitElement(c, 3, devMode)).join('\n')
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

/**
 * Phase 2 §2: build the `import { useDocState, setDocState } from '<path>'`
 * line. `useDocState` is included only if the page reads at least one
 * doc-state; `setDocState` only if it writes at least one. When neither is
 * needed the function returns an empty string and the page omits the import.
 */
function buildLowcodeStateImport(ir: IRTree, path: string): string {
  const names: string[] = []
  if (ir.docStateReads.length > 0) names.push('useDocState')
  if (ir.docStateWrites.length > 0) names.push('setDocState')
  if (names.length === 0) return ''
  return `import { ${names.join(', ')} } from '${path}'\n`
}
