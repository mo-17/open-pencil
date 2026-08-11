import {
  ACCORDION_MODULE_TYPE,
  ACCORDION_PLUGIN_ID,
  AUDIO_PLAYER_MODULE_TYPE,
  AUDIO_PLAYER_PLUGIN_ID,
  BUILTIN_PLUGIN_REGISTRY,
  CAROUSEL_MODULE_TYPE,
  CAROUSEL_PLUGIN_ID,
  CHART_MODULE_TYPE,
  CHART_PLUGIN_ID,
  CODE_BLOCK_MODULE_TYPE,
  CODE_BLOCK_PLUGIN_ID,
  DATA_GRID_MODULE_TYPE,
  DATA_GRID_PLUGIN_ID,
  DROPDOWN_MENU_MODULE_TYPE,
  DROPDOWN_MENU_PLUGIN_ID,
  HTML_MODULE_TYPE,
  HTML_PLUGIN_ID,
  MAP_MODULE_TYPE,
  MAP_PLUGIN_ID,
  MARKDOWN_MODULE_TYPE,
  MARKDOWN_PLUGIN_ID,
  MODAL_MODULE_TYPE,
  MODAL_PLUGIN_ID,
  LOTTIE_MODULE_TYPE,
  LOTTIE_PLUGIN_ID,
  PDF_VIEWER_MODULE_TYPE,
  PDF_VIEWER_PLUGIN_ID,
  QR_BARCODE_MODULE_TYPE,
  QR_BARCODE_PLUGIN_ID,
  RICH_TEXT_MODULE_TYPE,
  RICH_TEXT_PLUGIN_ID,
  SLIDE_MENU_MODULE_TYPE,
  SLIDE_MENU_PLUGIN_ID,
  TABLE_MODULE_TYPE,
  TABLE_PLUGIN_ID,
  TABS_MODULE_TYPE,
  TABS_PLUGIN_ID,
  UPLOAD_BUTTON_MODULE_TYPE,
  UPLOAD_BUTTON_PLUGIN_ID,
  VIDEO_MODULE_TYPE,
  VIDEO_PLUGIN_ID,
  type DeclarativeModuleContributionV1,
  type ModuleDefinition
} from '@open-pencil/core/plugins'

import type { EditorStore } from '@/app/editor/active-store'

import type { InstalledPluginModule } from './types'

const TRUSTED_MODULE_ADAPTERS = new Map([
  ['open-pencil.map', { pluginId: MAP_PLUGIN_ID, moduleType: MAP_MODULE_TYPE }],
  ['open-pencil.chart', { pluginId: CHART_PLUGIN_ID, moduleType: CHART_MODULE_TYPE }],
  ['open-pencil.rich-text', { pluginId: RICH_TEXT_PLUGIN_ID, moduleType: RICH_TEXT_MODULE_TYPE }],
  ['open-pencil.html', { pluginId: HTML_PLUGIN_ID, moduleType: HTML_MODULE_TYPE }],
  ['open-pencil.video', { pluginId: VIDEO_PLUGIN_ID, moduleType: VIDEO_MODULE_TYPE }],
  ['open-pencil.table', { pluginId: TABLE_PLUGIN_ID, moduleType: TABLE_MODULE_TYPE }],
  [
    'open-pencil.slide-menu',
    { pluginId: SLIDE_MENU_PLUGIN_ID, moduleType: SLIDE_MENU_MODULE_TYPE }
  ],
  [
    'open-pencil.dropdown-menu',
    { pluginId: DROPDOWN_MENU_PLUGIN_ID, moduleType: DROPDOWN_MENU_MODULE_TYPE }
  ],
  [
    'open-pencil.upload-button',
    { pluginId: UPLOAD_BUTTON_PLUGIN_ID, moduleType: UPLOAD_BUTTON_MODULE_TYPE }
  ],
  ['open-pencil.modal', { pluginId: MODAL_PLUGIN_ID, moduleType: MODAL_MODULE_TYPE }],
  ['open-pencil.lottie', { pluginId: LOTTIE_PLUGIN_ID, moduleType: LOTTIE_MODULE_TYPE }],
  ['open-pencil.carousel', { pluginId: CAROUSEL_PLUGIN_ID, moduleType: CAROUSEL_MODULE_TYPE }],
  ['open-pencil.data-grid', { pluginId: DATA_GRID_PLUGIN_ID, moduleType: DATA_GRID_MODULE_TYPE }],
  ['open-pencil.tabs', { pluginId: TABS_PLUGIN_ID, moduleType: TABS_MODULE_TYPE }],
  ['open-pencil.accordion', { pluginId: ACCORDION_PLUGIN_ID, moduleType: ACCORDION_MODULE_TYPE }],
  [
    'open-pencil.qr-barcode',
    { pluginId: QR_BARCODE_PLUGIN_ID, moduleType: QR_BARCODE_MODULE_TYPE }
  ],
  ['open-pencil.markdown', { pluginId: MARKDOWN_PLUGIN_ID, moduleType: MARKDOWN_MODULE_TYPE }],
  [
    'open-pencil.code-block',
    { pluginId: CODE_BLOCK_PLUGIN_ID, moduleType: CODE_BLOCK_MODULE_TYPE }
  ],
  [
    'open-pencil.pdf-viewer',
    { pluginId: PDF_VIEWER_PLUGIN_ID, moduleType: PDF_VIEWER_MODULE_TYPE }
  ],
  [
    'open-pencil.audio-player',
    { pluginId: AUDIO_PLAYER_PLUGIN_ID, moduleType: AUDIO_PLAYER_MODULE_TYPE }
  ]
])

export type AppPluginModuleCompatibilityStatus =
  | 'compatible'
  | 'untrusted-adapter'
  | 'plugin-identity-mismatch'
  | 'module-identity-mismatch'
  | 'host-adapter-unavailable'
  | 'config-version-mismatch'
  | 'invalid-default-config'

export type AppPluginModuleCompatibility =
  | Readonly<{
      ok: true
      status: 'compatible'
      definition: ModuleDefinition
    }>
  | Readonly<{
      ok: false
      status: Exclude<AppPluginModuleCompatibilityStatus, 'compatible'>
      reason: string
    }>

export type AppPluginModuleCompatibilityFailure = Readonly<{
  moduleType: string
  status: Exclude<AppPluginModuleCompatibilityStatus, 'compatible'>
  reason: string
}>

function incompatible(
  status: Exclude<AppPluginModuleCompatibilityStatus, 'compatible'>,
  reason: string
): AppPluginModuleCompatibility {
  return { ok: false, status, reason }
}

export function inspectPluginModuleCompatibility(
  pluginId: string,
  contribution: DeclarativeModuleContributionV1
): AppPluginModuleCompatibility {
  const adapter = TRUSTED_MODULE_ADAPTERS.get(contribution.adapterId)
  if (!adapter) {
    return incompatible(
      'untrusted-adapter',
      `Plugin module adapter is not trusted: ${contribution.adapterId}`
    )
  }
  if (adapter.pluginId !== pluginId) {
    return incompatible(
      'plugin-identity-mismatch',
      `Plugin ${pluginId} is not authorized to use adapter ${contribution.adapterId}`
    )
  }
  if (adapter.moduleType !== contribution.moduleType) {
    return incompatible(
      'module-identity-mismatch',
      `Adapter ${contribution.adapterId} does not authorize module ${contribution.moduleType}`
    )
  }
  const definition = BUILTIN_PLUGIN_REGISTRY.getModule(adapter.pluginId, adapter.moduleType)
  if (!definition) {
    return incompatible(
      'host-adapter-unavailable',
      `Trusted module adapter is unavailable: ${adapter.pluginId}`
    )
  }
  if (definition.configVersion !== contribution.configVersion) {
    return incompatible(
      'config-version-mismatch',
      `Plugin module config version ${contribution.configVersion} is incompatible with host version ${definition.configVersion}: ${pluginId}`
    )
  }
  try {
    const instance = definition.createInstance(contribution.defaultConfig)
    if (
      instance.pluginId !== adapter.pluginId ||
      instance.moduleType !== adapter.moduleType ||
      instance.configVersion !== definition.configVersion
    ) {
      return incompatible(
        'host-adapter-unavailable',
        `Trusted module adapter returned an incompatible module identity: ${contribution.adapterId}`
      )
    }
  } catch (cause) {
    return incompatible(
      'invalid-default-config',
      cause instanceof Error ? cause.message : String(cause)
    )
  }
  return { ok: true, status: 'compatible', definition }
}

export function inspectInstalledPluginModuleCompatibility(
  module: InstalledPluginModule
): AppPluginModuleCompatibility {
  return inspectPluginModuleCompatibility(
    module.plugin.package.manifest.plugin.id,
    module.contribution
  )
}

export function inspectPluginModuleContributionsCompatibility(
  pluginId: string,
  contributions: readonly DeclarativeModuleContributionV1[]
): readonly AppPluginModuleCompatibilityFailure[] {
  const failures: AppPluginModuleCompatibilityFailure[] = []
  for (const contribution of contributions) {
    const compatibility = inspectPluginModuleCompatibility(pluginId, contribution)
    if (compatibility.ok) continue
    failures.push({
      moduleType: contribution.moduleType,
      status: compatibility.status,
      reason: compatibility.reason
    })
  }
  return failures
}

function trustedDefinition(module: InstalledPluginModule): ModuleDefinition {
  const compatibility = inspectInstalledPluginModuleCompatibility(module)
  if (!compatibility.ok) throw new Error(compatibility.reason)
  return compatibility.definition
}

export function addInstalledPluginModuleToCanvas(
  editor: EditorStore,
  module: InstalledPluginModule
): string {
  const definition = trustedDefinition(module)
  const canvasCenter = editor.viewportCanvasCenter()
  const center = editor.screenToCanvas(canvasCenter.x, canvasCenter.y)
  const parentId = editor.state.enteredContainerId ?? editor.state.currentPageId
  const parentOffset =
    parentId === editor.state.currentPageId
      ? { x: 0, y: 0 }
      : editor.graph.getAbsolutePosition(parentId)
  const overrides = definition.createFrameOverrides(module.contribution.defaultConfig)
  const initialOverrides = { ...overrides }
  delete initialOverrides.x
  delete initialOverrides.y
  delete initialOverrides.width
  delete initialOverrides.height
  delete initialOverrides.name
  const width = module.contribution.defaultSize.width
  const height = module.contribution.defaultSize.height
  const id = editor.createShape(
    'FRAME',
    center.x - parentOffset.x - width / 2,
    center.y - parentOffset.y - height / 2,
    width,
    height,
    parentId,
    module.contribution.name,
    initialOverrides
  )
  editor.select([id])
  editor.requestRender()
  return id
}
