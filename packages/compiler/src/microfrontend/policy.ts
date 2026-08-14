import type { ComponentDef, IREventHandler, IRNode, IRTree } from '#compiler/ir/types'
import type {
  CompilerMicrofrontendPackaging,
  CompilerOptions,
  HTMLMetadata,
  HTMLMetadataOptions
} from '#compiler/types'

import { parseStableSemver, validateModuleIdentity } from '@open-pencil/scene-graph'

interface RawCompilerMicrofrontendPackaging {
  kind?: unknown
  appId?: unknown
  version?: unknown
}

function isRawCompilerMicrofrontendPackaging(
  value: unknown
): value is RawCompilerMicrofrontendPackaging {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function parseCompilerMicrofrontendPackaging(
  value: unknown
): CompilerMicrofrontendPackaging | undefined {
  if (value === undefined) return undefined
  if (!isRawCompilerMicrofrontendPackaging(value)) {
    throw new TypeError('CompilerOptions.packaging must be an object')
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('CompilerOptions.packaging must be a plain object')
  }
  const keys = Reflect.ownKeys(value)
  if (
    keys.some(
      (key) => typeof key !== 'string' || (key !== 'kind' && key !== 'appId' && key !== 'version')
    ) ||
    !keys.includes('kind') ||
    !keys.includes('appId')
  ) {
    throw new TypeError(
      'CompilerOptions.packaging must contain exactly kind, appId, and optional version'
    )
  }
  if (value.kind !== 'microfrontend') {
    throw new TypeError('CompilerOptions.packaging.kind must be microfrontend')
  }
  if (typeof value.appId !== 'string') {
    throw new TypeError('CompilerOptions.packaging.appId must be a string')
  }
  const appIdReason = validateModuleIdentity(value.appId, 'CompilerOptions.packaging.appId')
  if (appIdReason) throw new TypeError(appIdReason)
  if (value.version !== undefined && typeof value.version !== 'string') {
    throw new TypeError('CompilerOptions.packaging.version must be a string')
  }
  if (value.version !== undefined) {
    parseStableSemver(value.version, 'CompilerOptions.packaging.version')
  }
  return Object.freeze({
    kind: 'microfrontend',
    appId: value.appId,
    ...(value.version === undefined ? {} : { version: value.version })
  })
}

const OVERLAY_MODULE_IDENTITIES = new Set([
  'open-pencil.dropdown-menu/dropdown-menu',
  'open-pencil.modal/modal',
  'open-pencil.slide-menu/slide-menu',
  'open-pencil.upload-button/upload-button'
])

const FEATURE_ORDER = [
  'development preview bridge',
  'internationalization runtime',
  'runtime theme or design-token CSS',
  'standalone HTML metadata',
  'non-default document locale',
  'Motion runtime',
  'prototype runtime',
  'generated-effect runtime',
  'analytics runtime',
  'server workflows',
  'persisted document state',
  'overlay actions',
  'overlay modules'
] as const

type UnsupportedMicrofrontendFeature = (typeof FEATURE_ORDER)[number]

function hasText(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim() !== ''
}

function hasHTMLMetadata(value: HTMLMetadata | undefined): boolean {
  if (!value) return false
  return (
    hasText(value.title) ||
    hasText(value.description) ||
    hasText(value.image) ||
    hasText(value.canonicalUrl) ||
    hasText(value.customCss) ||
    (value.head?.meta?.length ?? 0) > 0 ||
    (value.head?.link?.length ?? 0) > 0 ||
    (value.head?.styles?.length ?? 0) > 0
  )
}

function hasAnyHTMLMetadata(value: HTMLMetadataOptions | undefined): boolean {
  if (hasHTMLMetadata(value)) return true
  return Object.values(value?.pages ?? {}).some(hasHTMLMetadata)
}

function addPrototypeFeature(
  value: {
    prototype?: unknown
    transitionKey?: string
    prototypeTarget?: true
    prototypeOverlayTarget?: true
    prototypeScope?: true
  },
  features: Set<UnsupportedMicrofrontendFeature>
): void {
  if (
    value.prototype !== undefined ||
    hasText(value.transitionKey) ||
    value.prototypeTarget === true ||
    value.prototypeOverlayTarget === true ||
    value.prototypeScope === true
  ) {
    features.add('prototype runtime')
  }
}

function visitHandlers(
  handlers: readonly IREventHandler[] | undefined,
  features: Set<UnsupportedMicrofrontendFeature>
): void {
  for (const handler of handlers ?? []) {
    if (
      handler.kind === 'playMotion' ||
      handler.kind === 'stopMotion' ||
      handler.kind === 'toggleMotion' ||
      handler.kind === 'awaitMotion'
    ) {
      features.add('Motion runtime')
    } else if (handler.kind === 'trackEvent') {
      features.add('analytics runtime')
    } else if (handler.kind === 'invokeServerWorkflow') {
      features.add('server workflows')
    } else if (handler.kind === 'toast' || handler.kind === 'confirm') {
      features.add('overlay actions')
    }

    if (handler.kind === 'condition' || handler.kind === 'confirm') {
      visitHandlers(handler.consequent, features)
      visitHandlers(handler.alternate, features)
    } else if (
      handler.kind === 'apiCall' ||
      handler.kind === 'supabaseQuery' ||
      handler.kind === 'supabaseMutation' ||
      handler.kind === 'invokeServerWorkflow'
    ) {
      visitHandlers(handler.onSuccess, features)
      visitHandlers(handler.onError, features)
    }
  }
}

function visitEvents(
  events: Partial<Record<string, IREventHandler[]>> | undefined,
  features: Set<UnsupportedMicrofrontendFeature>
): void {
  for (const handlers of Object.values(events ?? {})) visitHandlers(handlers, features)
}

function visitNode(node: IRNode, features: Set<UnsupportedMicrofrontendFeature>): void {
  if (node.kind === 'conditional') {
    visitNode(node.consequent, features)
    return
  }
  if (node.kind === 'list') {
    visitNode(node.template, features)
    return
  }
  if (node.kind === 'text' || node.kind === 'expression') return

  if (node.motion || node.motionDrivers || node.motionDriverMarker === true) {
    features.add('Motion runtime')
  }
  addPrototypeFeature(node, features)
  visitEvents(node.events, features)
  if (node.kind === 'componentRef') {
    if (node.prototypeBody === true) features.add('prototype runtime')
    return
  }

  if (node.motionScene) features.add('Motion runtime')
  if (node.generatedEffect) features.add('generated-effect runtime')
  if (node.overlay) features.add('overlay actions')
  if (
    node.module &&
    OVERLAY_MODULE_IDENTITIES.has(`${node.module.pluginId}/${node.module.moduleType}`)
  ) {
    features.add('overlay modules')
  }
  for (const child of node.children) visitNode(child, features)
}

function collectTreeFeatures(tree: IRTree, features: Set<UnsupportedMicrofrontendFeature>): void {
  if (tree.motion || tree.motionDrivers || tree.motionDriverMarker === true || tree.motionScene) {
    features.add('Motion runtime')
  }
  addPrototypeFeature(tree, features)
  if (tree.analyticsConfig) features.add('analytics runtime')
  if ((tree.serverWorkflows?.length ?? 0) > 0) features.add('server workflows')
  if (tree.docStates.some((state) => state.persist === true)) {
    features.add('persisted document state')
  }
  for (const node of tree.children) visitNode(node, features)
}

function collectComponentFeatures(
  component: ComponentDef,
  features: Set<UnsupportedMicrofrontendFeature>
): void {
  if (component.prototypeBody === true) features.add('prototype runtime')
  for (const node of component.children) visitNode(node, features)
  for (const variant of component.variants ?? []) {
    for (const node of variant.children) visitNode(node, features)
  }
}

/**
 * The first composition runtime deliberately supports a small, isolated
 * surface. Advanced generated runtimes still own document/window singletons
 * or document-level UI and therefore fail closed only for explicit
 * microfrontend packaging. Standalone compilation never calls this policy.
 */
export function unsupportedMicrofrontendFeatures(
  options: CompilerOptions,
  trees: readonly IRTree[],
  components: readonly ComponentDef[]
): UnsupportedMicrofrontendFeature[] {
  if (!options.packaging) return []
  const features = new Set<UnsupportedMicrofrontendFeature>()
  if (options.devMode) features.add('development preview bridge')
  if (options.i18n === true) features.add('internationalization runtime')
  if (hasText(options.themeCss)) features.add('runtime theme or design-token CSS')
  if (hasAnyHTMLMetadata(options.metadata)) features.add('standalone HTML metadata')
  const sourceLocale = options.sourceLocale?.trim().toLowerCase()
  if (sourceLocale && sourceLocale !== 'en') features.add('non-default document locale')
  for (const tree of trees) collectTreeFeatures(tree, features)
  for (const component of components) collectComponentFeatures(component, features)
  return FEATURE_ORDER.filter((feature) => features.has(feature))
}

export function assertMicrofrontendFeaturePolicy(
  options: CompilerOptions,
  trees: readonly IRTree[],
  components: readonly ComponentDef[]
): void {
  const unsupported = unsupportedMicrofrontendFeatures(options, trees, components)
  if (unsupported.length === 0) return
  throw new TypeError(
    `Microfrontend packaging v1 cannot safely compose: ${unsupported.join(', ')}. ` +
      'Remove these features or use standalone packaging.'
  )
}
