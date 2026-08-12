import type { AdapterEmission, FrameworkAdapter } from '#compiler/adapters/types'
import { stableNameSuffix } from '#compiler/ir/stable-name'
import type { ComponentDef, IRAsset, IRTree } from '#compiler/ir/types'
import type { CompileWarning, CompilerOptions } from '#compiler/types'

import {
  createCompileWarningSink,
  nativeUnsupportedOptionNames,
  selectNativePages
} from '../native-shared'
import { derivePagePaths, type PagePathInfo } from '../react/route-paths'
import { emitExpoComponent, emitExpoPage } from './emit'
import { expoRoutePath } from './event'
import {
  buildExpoAppJSON,
  buildExpoDocumentState,
  buildExpoFontStub,
  buildExpoGitignore,
  buildExpoPackageJSON,
  buildExpoReadme,
  buildExpoRootApp,
  buildExpoRouteProxy,
  buildExpoRouterLayout,
  buildExpoTsConfig
} from './project'
import type { ExpoWarningSink } from './types'

const UNSAFE_ROUTE_SEGMENTS = new Set([
  '.',
  '..',
  '__proto__',
  'constructor',
  'prototype',
  '_layout'
])
const WINDOWS_DEVICE_ROUTE_SEGMENT =
  /^(?:con|prn|aux|nul|clock\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\..*)?$/i

interface ExpoPagePathInfo extends PagePathInfo {
  moduleSlug: string
}

interface PlannedRouterPage {
  info: ExpoPagePathInfo
  routeFile: string
}

interface ExpoAssetPlan {
  assets: readonly IRAsset[]
  names: ReadonlySet<string>
}

const EXPO_RASTER_ASSET_EXTENSION = /\.(?:gif|jpe?g|png|webp)$/i

export const expoAdapter: FrameworkAdapter = {
  emit(
    irs: readonly IRTree[],
    options: CompilerOptions,
    components: readonly ComponentDef[] = []
  ): AdapterEmission {
    return emitExpoProject(irs, options, components)
  }
}

function emitExpoProject(
  irs: readonly IRTree[],
  options: CompilerOptions,
  components: readonly ComponentDef[]
): AdapterEmission {
  const files = new Map<string, string | Uint8Array>()
  const warnings: CompileWarning[] = []
  const warn: ExpoWarningSink = createCompileWarningSink(warnings)
  const router = resolveExpoRouter(options, warn)
  warnWebOptions(options, warn)
  const selected = selectPages(irs, router, warn)
  const infos = deriveExpoPagePaths(selected, warn)
  const routerPlan = router ? planRouterPages(infos, warn) : undefined
  const routeRewrites = routerPlan?.routeRewrites ?? new Map<string, string>()
  const assetPlan = collectExpoAssets(selected, components, warn)

  files.set('package.json', buildExpoPackageJSON(options, router))
  files.set('app.json', buildExpoAppJSON(options, router))
  files.set('tsconfig.json', buildExpoTsConfig())
  files.set('.gitignore', buildExpoGitignore())
  files.set('README.md', buildExpoReadme(router))
  files.set('expo-env.d.ts', `/// <reference types="expo/types" />\n`)
  files.set('src/generated-fonts.ts', buildExpoFontStub())
  files.set('src/runtime/document-state.ts', buildExpoDocumentState(selected[0]?.docStates ?? []))

  if (router) {
    files.set('app/_layout.tsx', buildExpoRouterLayout())
    emitRouterPages(files, routerPlan?.pages ?? [], options, routeRewrites, assetPlan.names, warn)
  } else {
    files.set('App.tsx', buildExpoRootApp())
    emitPageModule(files, infos[0], options, false, routeRewrites, assetPlan.names, warn)
  }
  emitComponents(files, components, options, router, routeRewrites, assetPlan.names, warn)
  emitAssets(files, assetPlan.assets)
  warnings.push(...duplicateSlugWarnings(infos))
  return { files, warnings }
}

function resolveExpoRouter(options: CompilerOptions, warn: ExpoWarningSink): boolean {
  if (options.router === 'expo-router') return true
  if (options.router === 'none') return false
  warn({
    code: 'expo-router-option-unsupported',
    message: `Expo target does not support router ${JSON.stringify(options.router)}; emitted a router-free app`
  })
  return false
}

function warnWebOptions(options: CompilerOptions, warn: ExpoWarningSink): void {
  const names = nativeUnsupportedOptionNames(options)
  if (names.length === 0) return
  warn({
    code: 'expo-web-option-unsupported',
    message: `Expo static MVP ignored web-only compiler option(s): ${names.join(', ')}`
  })
}

function selectPages(
  irs: readonly IRTree[],
  router: boolean,
  warn: ExpoWarningSink
): readonly IRTree[] {
  return selectNativePages(irs, router, (ir) => {
    warn({
      code: 'expo-multipage-router-required',
      message: `Expo router-free output omitted page ${JSON.stringify(ir.pageName)}; select router 'expo-router' to emit multiple pages`,
      nodeId: ir.pageId
    })
  })
}

function deriveExpoPagePaths(irs: readonly IRTree[], warn: ExpoWarningSink): ExpoPagePathInfo[] {
  const used = new Set<string>()
  return derivePagePaths(irs).map((info) => {
    const moduleSlug = uniquePortableModuleSlug(info.slug, used)
    if (moduleSlug !== info.slug) {
      warn({
        code: 'expo-page-module-path-sanitized',
        message: `Expo renamed page module ${JSON.stringify(info.slug)} to portable filename ${JSON.stringify(moduleSlug)}`,
        nodeId: info.pageId
      })
    }
    return { ...info, moduleSlug }
  })
}

function uniquePortableModuleSlug(slug: string, used: Set<string>): string {
  const portableSlug = boundedPortableRouteSegment(slug)
  const base = isUnsafeRouteSegment(portableSlug) ? `page-${portableSlug}` : portableSlug
  let candidate = base
  let suffix = 2
  while (used.has(portableRouteFileKey(candidate))) candidate = `${base}-${suffix++}`
  used.add(portableRouteFileKey(candidate))
  return candidate
}

function planRouterPages(
  infos: readonly ExpoPagePathInfo[],
  warn: ExpoWarningSink
): { pages: PlannedRouterPage[]; routeRewrites: ReadonlyMap<string, string> } {
  const usedRouteFiles = new Set<string>([portableRouteFileKey('app/_layout.tsx')])
  const usedRouteSemantics = new Set<string>()
  const claimedAuthoredRoutes = new Set<string>()
  const routeRewrites = new Map<string, string>()
  const pages: PlannedRouterPage[] = []
  for (const info of infos) {
    let routeFile = expoRouteFile(info, warn)
    if (
      usedRouteFiles.has(portableRouteFileKey(routeFile)) ||
      usedRouteSemantics.has(expoRouteSemanticKey(routeFile))
    ) {
      const authoredRouteFile = routeFile
      routeFile = uniqueFallbackRouteFile(info.moduleSlug, usedRouteFiles, usedRouteSemantics)
      warn({
        code: 'expo-route-file-collision',
        message: `Expo Router route ${JSON.stringify(info.route)} collided at ${JSON.stringify(authoredRouteFile)}; emitted page ${JSON.stringify(info.ir.pageName)} at ${JSON.stringify(routeFile)} for manual review`,
        nodeId: info.pageId
      })
    }
    usedRouteFiles.add(portableRouteFileKey(routeFile))
    usedRouteSemantics.add(expoRouteSemanticKey(routeFile))
    const emittedRoute = expoRouteFromFile(routeFile)
    const authoredRoute = expoRoutePath(info.route)
    if (
      emittedRoute !== authoredRoute &&
      !claimedAuthoredRoutes.has(info.route) &&
      !routeRewrites.has(info.route)
    ) {
      routeRewrites.set(info.route, emittedRoute)
    }
    claimedAuthoredRoutes.add(info.route)
    pages.push({ info, routeFile })
  }
  return { pages, routeRewrites }
}

function emitRouterPages(
  files: Map<string, string | Uint8Array>,
  pages: readonly PlannedRouterPage[],
  options: CompilerOptions,
  routeRewrites: ReadonlyMap<string, string>,
  nativeAssetNames: ReadonlySet<string>,
  warn: ExpoWarningSink
): void {
  for (const { info, routeFile } of pages) {
    emitPageModule(files, info, options, true, routeRewrites, nativeAssetNames, warn)
    files.set(routeFile, buildExpoRouteProxy(routeFile, info.moduleSlug))
  }
}

function uniqueFallbackRouteFile(
  slug: string,
  usedFiles: ReadonlySet<string>,
  usedSemantics: ReadonlySet<string>
): string {
  let suffix = 1
  let candidate = `app/${slug}.tsx`
  while (
    usedFiles.has(portableRouteFileKey(candidate)) ||
    usedSemantics.has(expoRouteSemanticKey(candidate))
  ) {
    suffix++
    candidate = `app/${slug}-${suffix}.tsx`
  }
  return candidate
}

function emitPageModule(
  files: Map<string, string | Uint8Array>,
  info: ExpoPagePathInfo,
  options: CompilerOptions,
  router: boolean,
  routeRewrites: ReadonlyMap<string, string>,
  nativeAssetNames: ReadonlySet<string>,
  warn: ExpoWarningSink
): void {
  files.set(
    `src/pages/${info.moduleSlug}.tsx`,
    emitExpoPage(info.ir, info.component, {
      assetPrefix: '../../assets/images/',
      componentImportPrefix: '../components/',
      devMode: options.devMode,
      router,
      routeRewrites,
      nativeAssetNames,
      warn
    })
  )
}

function emitComponents(
  files: Map<string, string | Uint8Array>,
  components: readonly ComponentDef[],
  options: CompilerOptions,
  router: boolean,
  routeRewrites: ReadonlyMap<string, string>,
  nativeAssetNames: ReadonlySet<string>,
  warn: ExpoWarningSink
): void {
  for (const definition of components) {
    files.set(
      `src/components/${definition.name}.tsx`,
      emitExpoComponent(definition, {
        assetPrefix: '../../assets/images/',
        componentImportPrefix: './',
        devMode: options.devMode,
        router,
        routeRewrites,
        nativeAssetNames,
        warn
      })
    )
  }
}

function expoRouteFile(info: ExpoPagePathInfo, warn: ExpoWarningSink): string {
  if (info.route === '/') return 'app/index.tsx'
  const segments = info.route
    .split('/')
    .filter(Boolean)
    .map((segment) => routeSegment(segment, info, warn))
  if (segments.length === 0) {
    warn({
      code: 'expo-route-pattern-unsupported',
      message: `Expo Router normalized empty route pattern ${JSON.stringify(info.route)} to the root route`,
      nodeId: info.pageId
    })
    return 'app/index.tsx'
  }
  // Expo Router omits a terminal index filename from the public route. Nest a
  // second index module so an authored literal `/foo/index` remains exactly
  // `/foo/index` instead of silently becoming `/foo`.
  if (segments.at(-1) === 'index') segments.push('index')
  return `app/${segments.join('/')}.tsx`
}

function routeSegment(segment: string, info: ExpoPagePathInfo, warn: ExpoWarningSink): string {
  const parameter = /^:([A-Za-z_$][\w$]*)$/.exec(segment)?.[1]
  if (parameter && segment.length <= 80 && !isUnsafeRouteSegment(parameter)) {
    return `[${parameter}]`
  }
  if (!isUnsafeRouteSegment(segment) && /^[A-Za-z0-9._-]+$/.test(segment)) {
    const portable = boundedPortableRouteSegment(segment)
    if (portable !== segment) {
      warn({
        code: 'expo-route-segment-truncated',
        message: `Expo shortened overlong route segment ${JSON.stringify(segment)} to ${JSON.stringify(portable)}`,
        nodeId: info.pageId
      })
    }
    return portable
  }
  warn({
    code: 'expo-route-pattern-unsupported',
    message: `Expo Router could not map route segment ${JSON.stringify(segment)}; used page slug instead`,
    nodeId: info.pageId
  })
  return safeFallbackRouteSegment(info.moduleSlug)
}

function safeFallbackRouteSegment(slug: string): string {
  return isUnsafeRouteSegment(slug) ? `page-${slug}` : slug
}

function isUnsafeRouteSegment(segment: string): boolean {
  return (
    UNSAFE_ROUTE_SEGMENTS.has(segment.toLowerCase()) || WINDOWS_DEVICE_ROUTE_SEGMENT.test(segment)
  )
}

function portableRouteFileKey(path: string): string {
  return path.normalize('NFC').toLowerCase()
}

function boundedPortableRouteSegment(value: string): string {
  if (value.length <= 80) return value
  return `${value.slice(0, 64)}-${stableNameSuffix(value)}`
}

function expoRouteSemanticKey(path: string): string {
  return expoRouteFromFile(path)
    .split('/')
    .map((segment) => (/^\[[^/\]]+\]$/.test(segment) ? '[]' : segment))
    .join('/')
    .normalize('NFC')
    .toLowerCase()
}

function expoRouteFromFile(path: string): string {
  const withoutExtension = path.replace(/^app\//, '').replace(/\.tsx$/, '')
  const withoutIndex = withoutExtension === 'index' ? '' : withoutExtension.replace(/\/index$/, '')
  return `/${withoutIndex}`
}

function collectExpoAssets(
  irs: readonly IRTree[],
  components: readonly ComponentDef[],
  warn: ExpoWarningSink
): ExpoAssetPlan {
  const candidates: IRAsset[] = []
  for (const ir of irs) candidates.push(...(ir.assets ?? []))
  for (const component of components) {
    candidates.push(...(component.assets ?? []))
  }
  const assets = new Map<string, IRAsset>()
  const blocked = new Set<string>()
  for (const asset of candidates.sort((a, b) => a.path.localeCompare(b.path))) {
    const name = asset.path.split('/').at(-1)
    if (!name || !EXPO_RASTER_ASSET_EXTENSION.test(name)) {
      warn({
        code: 'expo-image-asset-format-unsupported',
        message: `Expo static MVP omitted non-raster native image asset ${JSON.stringify(asset.path)}; PNG, JPEG, GIF, and WebP are supported`
      })
      continue
    }
    const key = portableRouteFileKey(name)
    if (blocked.has(key)) continue
    const existing = assets.get(key)
    if (!existing) {
      assets.set(key, asset)
      continue
    }
    if (bytesEqual(existing.bytes, asset.bytes)) continue
    assets.delete(key)
    blocked.add(key)
    warn({
      code: 'expo-image-asset-path-collision',
      message: `Expo omitted conflicting native image assets that map to ${JSON.stringify(name)}`
    })
  }
  const accepted = [...assets.values()]
  return {
    assets: accepted,
    names: new Set(accepted.flatMap((asset) => asset.path.split('/').at(-1) ?? []))
  }
}

function emitAssets(files: Map<string, string | Uint8Array>, assets: readonly IRAsset[]): void {
  for (const asset of assets) {
    const name = asset.path.split('/').at(-1)
    if (name) files.set(`assets/images/${name}`, asset.bytes)
  }
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false
  return left.every((byte, index) => byte === right[index])
}

function duplicateSlugWarnings(infos: readonly PagePathInfo[]): CompileWarning[] {
  return infos.flatMap((info) =>
    info.slug === info.originalSlug
      ? []
      : [
          {
            code: 'multi-page-duplicate-slug',
            message: `Page ${JSON.stringify(info.ir.pageName)} collided at ${JSON.stringify(info.originalSlug)} and was emitted as ${JSON.stringify(info.slug)}`,
            nodeId: info.pageId
          }
        ]
  )
}
