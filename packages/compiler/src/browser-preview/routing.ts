import * as v from 'valibot'

import { validateLowcodeNavigationTarget } from '@open-pencil/lowcode'

import { buildPreviewBridge } from '../adapters/preview-bridge'
import { failBrowserPreview } from './error'
import type { BrowserPreviewDiagnostic } from './types'

function occurrences(source: string, token: string): number {
  return source.split(token).length - 1
}

const SESSION_IMPORT =
  "import { OpenPencilApplicationPage } from './components/_open-pencil-application-session'"
const NAVIGATION_IMPORT = "import { ApplicationNavigationTracker } from './_application_navigation'"

const sessionDeclarationsSchema = v.record(
  v.pipe(
    v.string(),
    v.minLength(1),
    v.maxLength(512),
    v.check((value) => !/[\p{Cc}\s"\\<>]/u.test(value))
  ),
  v.strictObject({
    retention: v.picklist(['reset', 'preserve']),
    states: v.record(v.string(), v.picklist(['string', 'number', 'boolean', 'array', 'object']))
  })
)

function generatedSessionDeclarations(files: ReadonlyMap<string, string | Uint8Array>) {
  const runtime = files.get('src/lib/open-pencil-application-session.ts')
  if (typeof runtime !== 'string') return null
  const declaration = runtime.match(
    /^const declarations: Record<string, \{ retention\?: string; states: Record<string, string> \}> = ([^\r\n]+)$/m
  )?.[1]
  if (!declaration) return null
  try {
    const value: unknown = JSON.parse(declaration)
    const parsed = v.safeParse(sessionDeclarationsSchema, value)
    if (!parsed.success) return null
    return new Map(
      Object.entries(parsed.output).map(([pageId, fields]) => [pageId, fields.retention])
    )
  } catch {
    return null
  }
}

function hasGeneratedSessionRoutes(
  source: string,
  pages: readonly RegExpMatchArray[],
  files: ReadonlyMap<string, string | Uint8Array>
): boolean {
  const sessions = pages.filter((page) => page[0].includes('<OpenPencilApplicationPage '))
  if (!sessions.length) return !source.includes('OpenPencilApplicationPage')
  if (
    occurrences(source, SESSION_IMPORT) !== 1 ||
    occurrences(source, './components/_open-pencil-application-session') !== 1 ||
    !files.has('src/components/_open-pencil-application-session.tsx')
  )
    return false
  if (
    occurrences(source, '<OpenPencilApplicationPage ') !== sessions.length ||
    occurrences(source, '</OpenPencilApplicationPage>') !== sessions.length
  )
    return false
  const declarations = generatedSessionDeclarations(files)
  return declarations !== null && sessions.every((page) => declarations.get(page[2]) === page[3])
}

function hasGeneratedNavigationTracker(
  source: string,
  files: ReadonlyMap<string, string | Uint8Array>
): boolean {
  const trackerCount = occurrences(source, '<ApplicationNavigationTracker />')
  if (!trackerCount) return !source.includes('ApplicationNavigationTracker')
  return (
    trackerCount === 1 &&
    occurrences(source, NAVIGATION_IMPORT) === 1 &&
    occurrences(source, './_application_navigation') === 1 &&
    files.has('src/_application_navigation.ts')
  )
}

const PAGE_ROUTE =
  /<Route path="([^"\r\n]+)" element=\{(?:<Page\w+ \/>|<OpenPencilApplicationPage pageId="([^"\r\n]+)" retention="(reset|preserve)"><Page\w+ \/><\/OpenPencilApplicationPage>)\} \/>/g
const GENERATED_SHELL =
  /^export default function App\(\) \{\s*return \(\s*<BrowserRouter>\s*(?:<LowcodeAnalyticsRouteTracker \/>\s*)?(?:<ApplicationNavigationTracker \/>\s*)?<Routes>\s*<\/Routes>\s*<\/BrowserRouter>\s*\)\s*\}\s*$/

function generatedRouterPages(
  source: string,
  files: ReadonlyMap<string, string | Uint8Array>,
  redirect = ''
): RegExpMatchArray[] | null {
  const appBody = source.slice(source.indexOf('export default function App()'))
  const pages = [...appBody.matchAll(PAGE_ROUTE)]
  const body = appBody.replace(redirect, '').replace(PAGE_ROUTE, '')
  // Other JSX or executable expressions cannot add alias/dynamic redirects to this shell.
  if (
    !GENERATED_SHELL.test(body) ||
    !hasGeneratedSessionRoutes(source, pages, files) ||
    !hasGeneratedNavigationTracker(source, files)
  )
    return null
  return pages
}

function hasApplicationSessionFeatures(
  source: string,
  files: ReadonlyMap<string, string | Uint8Array>
): boolean {
  return (
    source.includes('<OpenPencilApplicationPage') ||
    source.includes('<ApplicationNavigationTracker') ||
    files.has('src/lib/open-pencil-application-session.ts') ||
    files.has('src/_application_navigation.ts')
  )
}

/** Accept only the compiler's single static homepage redirect and closed emitted page/shell targets. */
function hasGeneratedApplicationRedirect(
  source: string,
  files: ReadonlyMap<string, string | Uint8Array>
): boolean {
  const appBody = source.slice(source.indexOf('export default function App()'))
  const redirects = [
    ...appBody.matchAll(/<Route path="\/" element=\{<Navigate to="([^"\r\n]+)" replace \/>\} \/>/g)
  ]
  const target = redirects[0]?.[1]
  if (
    redirects.length !== 1 ||
    occurrences(source, '<Navigate') !== 1 ||
    !target ||
    target === '/' ||
    !validateLowcodeNavigationTarget(target).ok ||
    /[:*?#]/.test(target)
  )
    return false
  const pages = generatedRouterPages(source, files, redirects[0]?.[0] ?? '')
  return pages?.filter((page) => page[1] === target).length === 1
}

function invalidLegacyRouterFeatures(
  source: string,
  files: ReadonlyMap<string, string | Uint8Array>
): boolean {
  return (
    source.includes('<Navigate') ||
    (hasApplicationSessionFeatures(source, files) && generatedRouterPages(source, files) === null)
  )
}

const GUARD_IMPORT =
  "import { ApplicationGuardLayout, ApplicationGuardPage } from './components/_open-pencil-application-guards'"
const GUARDED_ROUTE =
  /\{ path: "([^"\r\n]+)", element: <ApplicationGuardPage pageId="([^"\r\n]+)">(?:<Page\w+ \/>|<OpenPencilApplicationPage pageId="([^"\r\n]+)" retention="(reset|preserve)"><Page\w+ \/><\/OpenPencilApplicationPage>)<\/ApplicationGuardPage> \}/g

function generatedGuardPolicies(
  files: ReadonlyMap<string, string | Uint8Array>
): Map<string, string> | null {
  const runtime = files.get('src/lib/open-pencil-application-guards.ts')
  if (typeof runtime !== 'string') return null
  const declaration = runtime.match(/^export const policies: GuardPolicy\[\] = ([^\r\n]+)$/m)?.[1]
  if (!declaration || declaration.length > 256 * 1024) return null
  try {
    const value: unknown = JSON.parse(declaration)
    const parsed = v.safeParse(v.array(v.object({ pageId: v.string(), route: v.string() })), value)
    if (!parsed.success || !parsed.output.length) return null
    const policies = new Map(parsed.output.map((policy) => [policy.pageId, policy.route]))
    return policies.size === parsed.output.length ? policies : null
  } catch {
    return null
  }
}

function guardedRouteIdentitiesMatch(
  policies: Map<string, string>,
  pages: readonly RegExpMatchArray[]
): boolean {
  return (
    pages.length === policies.size &&
    new Set(pages.map((page) => page[2])).size === pages.length &&
    pages.every((page) => policies.get(page[2]) === page[1] && (!page[3] || page[3] === page[2]))
  )
}

function guardedRouterImport(hasRedirect: boolean): string {
  return hasRedirect
    ? "import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom'"
    : "import { createBrowserRouter, RouterProvider } from 'react-router-dom'"
}

function adaptGuardedDataRouter(
  source: string,
  files: ReadonlyMap<string, string | Uint8Array>
): string | null {
  const policies = generatedGuardPolicies(files)
  const pages = [...source.matchAll(GUARDED_ROUTE)]
  const redirects = [
    ...source.matchAll(/\{ path: '\/', element: <Navigate to="([^"\r\n]+)" replace \/> \}/g)
  ]
  const importToken = guardedRouterImport(redirects.length > 0)
  if (
    !policies ||
    !guardedRouteIdentitiesMatch(policies, pages) ||
    occurrences(source, GUARD_IMPORT) !== 1 ||
    occurrences(source, './components/_open-pencil-application-guards') !== 1 ||
    !files.has('src/components/_open-pencil-application-guards.tsx') ||
    occurrences(source, importToken) !== 1 ||
    [...source.matchAll(/['"]react-router-dom['"]/g)].length !== 1 ||
    occurrences(source, 'createBrowserRouter') !== 2 ||
    redirects.length > 1 ||
    occurrences(source, '<ApplicationGuardPage ') !== pages.length ||
    occurrences(source, '</ApplicationGuardPage>') !== pages.length
  )
    return null
  if (
    redirects.length &&
    (!validateLowcodeNavigationTarget(redirects[0][1]).ok ||
      /[:*?#]/.test(redirects[0][1]) ||
      ![...policies.values()].includes(redirects[0][1]))
  )
    return null
  const sessions = pages.map((page) => [page[0], page[1], page[3], page[4]] as RegExpMatchArray)
  if (!hasGeneratedSessionRoutes(source, sessions, files)) return null
  const body = source
    .slice(source.indexOf('const router ='))
    .replace(GUARDED_ROUTE, '')
    .replace(redirects[0]?.[0] ?? '', '')
  if (
    !/^const router = typeof window === 'undefined' \? undefined : createBrowserRouter\(\[\s*\{ element: <ApplicationGuardLayout \/>, children: \[\s*,?\s*\] \}\s*\]\)\s*export default function App\(\) \{\s*return router \? <RouterProvider router=\{router\} \/> : <section>Routing unavailable\.<\/section>\s*\}\s*$/.test(
      body.replace(/(?:,\s*)+(?=\])/g, '')
    )
  )
    return null
  return source.replaceAll('createBrowserRouter', 'createHashRouter')
}

function instrumentPreviewBridge(source: string): string {
  const outboundMarker = "const OUTBOUND_SOURCE = 'op-lowcode-preview'"
  const protocolMarker = "const CHANNEL_PROTOCOL = 'open-pencil-preview-v2'"
  const frameContextMarker =
    "const frameContext = typeof window === 'undefined' ? null : readFrameContext()"
  const pushMarker = "nativePushState(null, '', route)"
  const replaceMarker = "nativeReplaceState(history.state, '', route)"
  const guarded =
    source === buildPreviewBridge({ applicationGuards: true }) ||
    source === buildPreviewBridge({ applicationGuards: true, documentState: false })
  const routeMarker = `function currentPreviewRoute(): string {
  return location.pathname + location.search + location.hash
}`
  if (
    occurrences(source, outboundMarker) !== 1 ||
    occurrences(source, protocolMarker) !== 1 ||
    occurrences(source, frameContextMarker) !== 1 ||
    !source.includes('parseInbound(event.data, frameContext.channel)') ||
    !source.includes('event.origin !== frameContext.parentOrigin') ||
    occurrences(source, pushMarker) !== (guarded ? 0 : 1) ||
    occurrences(source, replaceMarker) !== (guarded ? 0 : 1) ||
    occurrences(source, routeMarker) !== 1
  ) {
    failBrowserPreview(
      'browser-preview-bridge-contract-unsupported',
      'Browser preview cannot safely instrument this generated preview bridge.',
      'src/__preview-bridge.ts'
    )
  }
  const routeHelper = `function currentPreviewRoute(): string {
  const value = location.hash.startsWith('#') ? location.hash.slice(1) : '/'
  return value.startsWith('/') ? value : '/'
}`
  let output = source.replace(routeMarker, routeHelper)
  output = output.replace(pushMarker, "nativePushState(null, '', `#${route}`)")
  output = output.replace(replaceMarker, "nativeReplaceState(history.state, '', `#${route}`)")
  if (
    !output.includes('currentPreviewRoute()') ||
    !output.includes(`channel: frameContext.channel`)
  ) {
    failBrowserPreview(
      'browser-preview-bridge-contract-unsupported',
      'Browser preview failed to apply the isolated bridge channel.',
      'src/__preview-bridge.ts'
    )
  }
  return output
}

export function prepareBrowserPreviewReactFiles(
  input: ReadonlyMap<string, string | Uint8Array>,
  _channel: string
): { files: Map<string, string | Uint8Array>; diagnostics: BrowserPreviewDiagnostic[] } {
  const files = new Map(input)
  const appPath = 'src/App.tsx'
  const app = files.get(appPath)
  if (typeof app !== 'string') {
    failBrowserPreview(
      'browser-preview-entry-missing',
      'Browser preview requires the generated React App module.',
      appPath
    )
  }
  const legacyImport = "import { BrowserRouter, Route, Routes } from 'react-router-dom'"
  const applicationImport =
    "import { BrowserRouter, Route, Routes, Navigate } from 'react-router-dom'"
  const applicationRouter = app.includes(applicationImport)
  const importToken = applicationRouter ? applicationImport : legacyImport
  if (app.includes('createBrowserRouter')) {
    const adapted = adaptGuardedDataRouter(app, files)
    if (!adapted)
      failBrowserPreview(
        'browser-preview-routing-contract-unsupported',
        'Browser preview cannot safely adapt this generated guarded router to Blob URL routing.',
        appPath
      )
    files.set(appPath, adapted)
  } else if (app.includes('BrowserRouter')) {
    if (
      occurrences(app, importToken) !== 1 ||
      [...app.matchAll(/['"]react-router-dom['"]/g)].length !== 1 ||
      occurrences(app, '<BrowserRouter>') !== 1 ||
      occurrences(app, '</BrowserRouter>') !== 1 ||
      (applicationRouter
        ? !hasGeneratedApplicationRedirect(app, files)
        : invalidLegacyRouterFeatures(app, files))
    ) {
      failBrowserPreview(
        'browser-preview-routing-contract-unsupported',
        'Browser preview cannot safely adapt this generated router to Blob URL routing.',
        appPath
      )
    }
    files.set(
      appPath,
      app
        .replace(importToken, importToken.replace('BrowserRouter', 'HashRouter'))
        .replace('<BrowserRouter>', '<HashRouter>')
        .replace('</BrowserRouter>', '</HashRouter>')
    )
  }
  const bridgePath = 'src/__preview-bridge.ts'
  const bridge = files.get(bridgePath)
  if (typeof bridge !== 'string') {
    failBrowserPreview(
      'browser-preview-bridge-missing',
      'Browser preview requires a dev-mode compiler preview bridge.',
      bridgePath
    )
  }
  files.set(bridgePath, instrumentPreviewBridge(bridge))
  return { files, diagnostics: [] }
}
