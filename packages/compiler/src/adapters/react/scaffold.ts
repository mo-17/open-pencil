import type { IRTree } from '#compiler/ir/types'

import { emitElement } from './emit/element'
import { emitStateDecl } from './emit/state'
import { pageHasNavigateHandler } from './ir-walk'
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
}

interface BuildAppOptions {
  /** Emit the canvas↔preview bridge import + `data-node-id` attributes. */
  devMode: boolean
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
    exportName: 'App'
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
    exportName: info.component
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
  const { devMode, importPreviewBridge, exportName } = options
  const bridgeImport = importPreviewBridge ? `import './__preview-bridge'\n` : ''
  const reactImport = ir.states.length > 0 ? `import { useState } from 'react'\n` : ''
  const needsNavigate = pageHasNavigateHandler(ir)
  const routerImport = needsNavigate
    ? `import { useNavigate } from 'react-router-dom'\n`
    : ''
  const importBlock = bridgeImport + reactImport + routerImport
  const importPrefix = importBlock ? `${importBlock}\n` : ''
  const stateLines = ir.states.map((s) => emitStateDecl(s, 1)).join('\n')
  const navigateLine = needsNavigate ? '  const navigate = useNavigate()' : ''

  const hookLines = [stateLines, navigateLine].filter((l) => l !== '').join('\n')

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
