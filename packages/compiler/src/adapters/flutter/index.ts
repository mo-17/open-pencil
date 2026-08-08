import type { AdapterEmission, FrameworkAdapter } from '#compiler/adapters/types'
import type { ComponentDef, IRAsset, IRTree } from '#compiler/ir/types'
import type { CompileWarning, CompilerOptions } from '#compiler/types'

import {
  createCompileWarningSink,
  nativeUnsupportedOptionNames,
  selectNativePages
} from '../native-shared'
import { derivePagePaths } from '../react/route-paths'
import { emitFlutterComponent, emitFlutterPage } from './emit'
import {
  allocateDartIdentifier,
  dartClassName,
  portableDartFileName,
  portableFileKey
} from './names'
import {
  buildFlutterAnalysisOptions,
  buildFlutterGitignore,
  buildFlutterMain,
  buildFlutterPubspec,
  buildFlutterReadme,
  buildFlutterRuntime,
  buildFlutterWidgetTest,
  type FlutterPageEntry
} from './project'
import type { FlutterComponentPlan, FlutterWarningSink } from './types'

const FLUTTER_RASTER_ASSET = /\.(?:gif|jpe?g|png|webp)$/i
const UNSAFE_ROUTE_SEGMENT = /^(?:\.{1,2}|__proto__|constructor|prototype)$/i
const SAFE_ROUTE_LITERAL = /^[A-Za-z0-9._~-]+$/
const SAFE_ASSET_BASENAME = /^[A-Za-z0-9._-]+$/
const WINDOWS_DEVICE_BASENAME = /^(?:con|prn|aux|nul|clock\$|com[1-9]|lpt[1-9])(?:\..*)?$/i

interface FlutterAssetPlan {
  aliases: ReadonlyMap<string, string>
  assets: readonly IRAsset[]
  names: ReadonlySet<string>
}

export const flutterAdapter: FrameworkAdapter = {
  emit(
    irs: readonly IRTree[],
    options: CompilerOptions,
    components: readonly ComponentDef[] = []
  ): AdapterEmission {
    return emitFlutterProject(irs, options, components)
  }
}

function emitFlutterProject(
  irs: readonly IRTree[],
  options: CompilerOptions,
  components: readonly ComponentDef[]
): AdapterEmission {
  const files = new Map<string, string | Uint8Array>()
  const warnings: CompileWarning[] = []
  const warn: FlutterWarningSink = createCompileWarningSink(warnings)
  const router = resolveFlutterRouter(options, warn)
  warnUnsupportedOptions(options, warn)
  const selected = selectPages(irs, router, warn)
  const assets = collectFlutterAssets(selected, components, warn)
  const componentPlans = planComponents(components, warn)
  const pageEntries = planPages(selected, warn)
  if (
    router &&
    pageEntries.length > 0 &&
    pageEntries.every((entry) => entry.route.includes('/:'))
  ) {
    warn({
      code: 'flutter-dynamic-initial-route-unavailable',
      message:
        'Every Flutter page uses a dynamic route; the generated landing screen asks the user to open a concrete route instead of inventing route parameters'
    })
  }
  const routeRewrites = new Map<string, string>()
  const claimedAuthoredRoutes = new Set<string>()
  for (const entry of pageEntries) {
    if (claimedAuthoredRoutes.has(entry.authoredRoute)) continue
    claimedAuthoredRoutes.add(entry.authoredRoute)
    if (entry.authoredRoute !== entry.route) routeRewrites.set(entry.authoredRoute, entry.route)
  }
  const environment = {
    componentPlans,
    devMode: options.devMode,
    nativeAssetAliases: assets.aliases,
    nativeAssetNames: assets.names,
    routeRewrites,
    router,
    warn
  }

  files.set('pubspec.yaml', buildFlutterPubspec(options, assets.assets.map(outputAssetPath)))
  files.set('.gitignore', buildFlutterGitignore())
  files.set('analysis_options.yaml', buildFlutterAnalysisOptions())
  files.set('README.md', buildFlutterReadme(options, router))
  files.set('test/widget_test.dart', buildFlutterWidgetTest(options))
  files.set('lib/openpencil_runtime.dart', buildFlutterRuntime(selected[0]?.docStates ?? []))
  files.set(
    'lib/main.dart',
    buildFlutterMain(
      options,
      pageEntries.map(({ authoredRoute: _, ir: __, ...entry }) => entry),
      router
    )
  )
  for (const page of pageEntries) {
    files.set(`lib/pages/${page.fileName}`, emitFlutterPage(page.ir, page.className, environment))
  }
  for (const definition of components) {
    const plan = componentPlans.get(definition.name)
    if (plan) {
      files.set(
        `lib/components/${plan.fileName}`,
        emitFlutterComponent(definition, plan, environment)
      )
    }
  }
  for (const asset of assets.assets) files.set(outputAssetPath(asset), asset.bytes)
  return { files, warnings }
}

function resolveFlutterRouter(options: CompilerOptions, warn: FlutterWarningSink): boolean {
  if (options.router === 'flutter-router') return true
  if (options.router === 'none') return false
  warn({
    code: 'flutter-router-option-unsupported',
    message: `Flutter target does not support router ${JSON.stringify(options.router)}; emitted a router-free app`
  })
  return false
}

function warnUnsupportedOptions(options: CompilerOptions, warn: FlutterWarningSink): void {
  const names = nativeUnsupportedOptionNames(options)
  if (names.length) {
    warn({
      code: 'flutter-web-option-unsupported',
      message: `Flutter static MVP ignored web-only compiler option(s): ${names.join(', ')}`
    })
  }
}

function selectPages(
  irs: readonly IRTree[],
  router: boolean,
  warn: FlutterWarningSink
): readonly IRTree[] {
  return selectNativePages(irs, router, (ir) => {
    warn({
      code: 'flutter-multipage-router-required',
      message: `Flutter router-free output omitted page ${JSON.stringify(ir.pageName)}; select router 'flutter-router' to emit multiple pages`,
      nodeId: ir.pageId
    })
  })
}

function planPages(
  irs: readonly IRTree[],
  warn: FlutterWarningSink
): Array<FlutterPageEntry & { authoredRoute: string; ir: IRTree }> {
  const infos = derivePagePaths(irs)
  const usedFiles = new Set<string>()
  const usedClasses = new Set<string>()
  const usedAliases = new Set<string>()
  const usedRoutes = new Set<string>()
  return infos.map((info, index) => {
    const fileName = uniqueFileName(info.slug, usedFiles)
    const className = uniqueClassName(`${info.component}Page`, usedClasses)
    const importAlias = allocateDartIdentifier(`page${index + 1}`, usedAliases, 'page')
    const authoredRoute = info.route
    const authoredRouteIsSafe = safeFlutterRoute(authoredRoute)
    let route = authoredRouteIsSafe ? authoredRoute : fallbackRoute(info.slug)
    let key = routeSemanticKey(route)
    if (usedRoutes.has(key)) {
      route = uniqueFallbackRoute(info.slug, usedRoutes)
      key = routeSemanticKey(route)
      warn({
        code: 'flutter-route-collision',
        message: `Flutter route ${JSON.stringify(authoredRoute)} collided; emitted page at ${JSON.stringify(route)}`,
        nodeId: info.pageId
      })
    } else if (!authoredRouteIsSafe) {
      warn({
        code: 'flutter-route-pattern-unsupported',
        message: `Flutter could not safely map route ${JSON.stringify(authoredRoute)}; emitted page at ${JSON.stringify(route)}`,
        nodeId: info.pageId
      })
    }
    usedRoutes.add(key)
    return { authoredRoute, className, fileName, importAlias, ir: info.ir, route }
  })
}

function planComponents(
  components: readonly ComponentDef[],
  warn: FlutterWarningSink
): ReadonlyMap<string, FlutterComponentPlan> {
  const result = new Map<string, FlutterComponentPlan>()
  const usedFiles = new Set<string>()
  const usedClasses = new Set<string>()
  const usedAliases = new Set<string>()
  for (const [index, definition] of components.entries()) {
    const fileName = uniqueFileName(definition.name, usedFiles)
    const className = uniqueClassName(`${definition.name}Component`, usedClasses)
    const importAlias = allocateDartIdentifier(`component${index + 1}`, usedAliases, 'component')
    const propNames = new Map<string, string>()
    const usedProps = new Set<string>([
      'build',
      'context',
      'entry',
      'key',
      'next',
      'openPencilItems',
      'runtimeType',
      'OpenPencilDocumentState',
      'OpenPencilRuntime'
    ])
    for (const prop of [...definition.props, ...(definition.variantAxes ?? [])]) {
      propNames.set(
        prop.name,
        allocateDartIdentifier(`op-prop-${prop.name}`, usedProps, 'opProperty')
      )
    }
    if (className !== definition.name) {
      warn({
        code: 'flutter-component-name-sanitized',
        message: `Flutter renamed component ${JSON.stringify(definition.name)} to ${JSON.stringify(className)}`,
        nodeId: definition.componentId
      })
    }
    result.set(definition.name, {
      sourceName: definition.name,
      className,
      fileName,
      importAlias,
      propNames
    })
  }
  return result
}

function collectFlutterAssets(
  irs: readonly IRTree[],
  components: readonly ComponentDef[],
  warn: FlutterWarningSink
): FlutterAssetPlan {
  const candidates = [
    ...irs.flatMap((ir) => ir.assets ?? []),
    ...components.flatMap((definition) => definition.assets ?? [])
  ].sort((left, right) => compareCodeUnitStrings(left.path, right.path))
  const accepted = new Map<string, IRAsset>()
  const blocked = new Set<string>()
  const aliases = new Map<string, string>()
  const aliasesByKey = new Map<string, Set<string>>()
  for (const asset of candidates) {
    const name = asset.path.split('/').at(-1)
    if (!name || !portableAssetName(name)) {
      warn({
        code: 'flutter-image-asset-format-unsupported',
        message: `Flutter omitted non-raster or unsafe image asset ${JSON.stringify(asset.path)}`
      })
      continue
    }
    const key = portableFileKey(name)
    if (blocked.has(key)) continue
    const existing = accepted.get(key)
    if (!existing) {
      accepted.set(key, asset)
      aliases.set(name, name)
      aliasesByKey.set(key, new Set([name]))
    } else if (bytesEqual(existing.bytes, asset.bytes)) {
      const canonical = existing.path.split('/').at(-1)
      if (canonical) aliases.set(name, canonical)
      aliasesByKey.get(key)?.add(name)
    } else {
      accepted.delete(key)
      blocked.add(key)
      for (const alias of aliasesByKey.get(key) ?? []) aliases.delete(alias)
      aliasesByKey.delete(key)
      warn({
        code: 'flutter-image-asset-path-collision',
        message: `Flutter omitted conflicting image assets that map to ${JSON.stringify(name)}`
      })
    }
  }
  const assets = [...accepted.values()]
  return {
    aliases,
    assets,
    names: new Set(assets.flatMap((asset) => asset.path.split('/').at(-1) ?? []))
  }
}

function portableAssetName(name: string): boolean {
  return (
    name.length <= 120 &&
    new TextEncoder().encode(name).byteLength <= 180 &&
    FLUTTER_RASTER_ASSET.test(name) &&
    SAFE_ASSET_BASENAME.test(name) &&
    !UNSAFE_ROUTE_SEGMENT.test(name) &&
    !WINDOWS_DEVICE_BASENAME.test(name)
  )
}

function outputAssetPath(asset: IRAsset): string {
  return `assets/images/${asset.path.split('/').at(-1)}`
}

function uniqueFileName(value: string, used: Set<string>): string {
  const original = portableDartFileName(value)
  const stem = original.slice(0, -5)
  let candidate = original
  let suffix = 2
  while (used.has(portableFileKey(candidate))) candidate = `${stem}_${suffix++}.dart`
  used.add(portableFileKey(candidate))
  return candidate
}

function uniqueClassName(value: string, used: Set<string>): string {
  const base = dartClassName(value)
  let candidate = base
  let suffix = 2
  while (used.has(candidate)) candidate = `${base}${suffix++}`
  used.add(candidate)
  return candidate
}

function safeFlutterRoute(route: string): boolean {
  if (!route.startsWith('/') || route.includes('?') || route.includes('#')) return false
  if (route === '/') return true
  const segments = route.split('/').slice(1)
  if (segments.some((segment) => !segment)) return false
  return segments.every((segment) => {
    if (segment.startsWith(':')) {
      const name = segment.slice(1)
      return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !UNSAFE_ROUTE_SEGMENT.test(name)
    }
    return SAFE_ROUTE_LITERAL.test(segment) && !UNSAFE_ROUTE_SEGMENT.test(segment)
  })
}

function routeSemanticKey(route: string): string {
  return route
    .split('/')
    .map((segment) => (segment.startsWith(':') ? ':' : segment))
    .join('/')
    .normalize('NFC')
    .toLowerCase()
}

function uniqueFallbackRoute(slug: string, used: ReadonlySet<string>): string {
  let suffix = 1
  const base = fallbackRoute(slug)
  let candidate = base
  while (used.has(routeSemanticKey(candidate))) candidate = `${base}-${++suffix}`
  return candidate
}

function fallbackRoute(slug: string): string {
  let segment = portableDartFileName(slug, 'page').slice(0, -'.dart'.length)
  if (!SAFE_ROUTE_LITERAL.test(segment) || UNSAFE_ROUTE_SEGMENT.test(segment)) {
    segment = `openpencil-${segment.replace(/[^A-Za-z0-9._~-]/g, '-') || 'page'}`
  }
  return `/${segment}`
}

function compareCodeUnitStrings(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index])
}
