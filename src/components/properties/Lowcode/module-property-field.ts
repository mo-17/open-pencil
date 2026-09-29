import {
  ACCORDION_MODULE_TYPE,
  ACCORDION_PLUGIN_ID,
  CAROUSEL_MODULE_TYPE,
  CAROUSEL_PLUGIN_ID,
  CODE_BLOCK_MODULE_TYPE,
  CODE_BLOCK_PLUGIN_ID,
  DATA_GRID_MODULE_TYPE,
  DATA_GRID_PLUGIN_ID,
  DROPDOWN_MENU_MODULE_TYPE,
  DROPDOWN_MENU_PLUGIN_ID,
  HTML_MODULE_TYPE,
  HTML_PLUGIN_ID,
  MARKDOWN_MODULE_TYPE,
  MARKDOWN_PLUGIN_ID,
  MODAL_MODULE_TYPE,
  MODAL_PLUGIN_ID,
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
  VR_TOUR_MODULE_TYPE,
  VR_TOUR_PLUGIN_ID,
  type ModuleDefinition,
  type ModulePropertyField
} from '@open-pencil/core/plugins'

export type SpecializedModuleFieldKind =
  | 'walktour-steps'
  | 'org-chart-items'
  | 'descriptions-items'
  | 'chart-data'
  | 'navigation-items'
  | 'timeline-items'
  | 'tree-items'
  | 'accordion-items'
  | 'carousel-slides'
  | 'code-block-code'
  | 'data-grid-data'
  | 'dropdown-menu-items'
  | 'html-content'
  | 'markdown-source'
  | 'modal-content'
  | 'rich-text-content'
  | 'slide-menu-items'
  | 'table-content'
  | 'tabs-items'
  | 'upload-accept'
  | 'vr-tour-scenes'
  | 'vr-tour-initial-scene'

interface SpecializedFieldIdentity {
  readonly pluginId: string
  readonly moduleType: string
  readonly path: string
  readonly kind: SpecializedModuleFieldKind
}

const SPECIALIZED_FIELDS: readonly SpecializedFieldIdentity[] = Object.freeze([
  {
    pluginId: 'open-pencil.walktour',
    moduleType: 'walktour',
    path: 'steps',
    kind: 'walktour-steps'
  },
  {
    pluginId: 'open-pencil.org-chart',
    moduleType: 'org-chart',
    path: 'items',
    kind: 'org-chart-items'
  },
  {
    pluginId: 'open-pencil.descriptions',
    moduleType: 'descriptions',
    path: 'items',
    kind: 'descriptions-items'
  },
  { pluginId: 'open-pencil.tree', moduleType: 'tree', path: 'items', kind: 'tree-items' },
  { pluginId: 'open-pencil.cascader', moduleType: 'cascader', path: 'items', kind: 'tree-items' },
  {
    pluginId: 'open-pencil.popover',
    moduleType: 'popover',
    path: 'content',
    kind: 'modal-content'
  },
  { pluginId: 'open-pencil.chart', moduleType: 'chart', path: 'values', kind: 'chart-data' },
  {
    pluginId: 'open-pencil.timeline',
    moduleType: 'timeline',
    path: 'items',
    kind: 'timeline-items'
  },
  {
    pluginId: 'open-pencil.stepper',
    moduleType: 'stepper',
    path: 'items',
    kind: 'navigation-items'
  },
  {
    pluginId: 'open-pencil.breadcrumb',
    moduleType: 'breadcrumb',
    path: 'items',
    kind: 'navigation-items'
  },

  {
    pluginId: CAROUSEL_PLUGIN_ID,
    moduleType: CAROUSEL_MODULE_TYPE,
    path: 'slides',
    kind: 'carousel-slides'
  },
  {
    pluginId: VR_TOUR_PLUGIN_ID,
    moduleType: VR_TOUR_MODULE_TYPE,
    path: 'scenes',
    kind: 'vr-tour-scenes'
  },
  {
    pluginId: VR_TOUR_PLUGIN_ID,
    moduleType: VR_TOUR_MODULE_TYPE,
    path: 'initialSceneId',
    kind: 'vr-tour-initial-scene'
  },
  {
    pluginId: RICH_TEXT_PLUGIN_ID,
    moduleType: RICH_TEXT_MODULE_TYPE,
    path: 'content',
    kind: 'rich-text-content'
  },
  { pluginId: HTML_PLUGIN_ID, moduleType: HTML_MODULE_TYPE, path: 'html', kind: 'html-content' },
  {
    pluginId: TABLE_PLUGIN_ID,
    moduleType: TABLE_MODULE_TYPE,
    path: 'table',
    kind: 'table-content'
  },
  {
    pluginId: DATA_GRID_PLUGIN_ID,
    moduleType: DATA_GRID_MODULE_TYPE,
    path: 'data',
    kind: 'data-grid-data'
  },
  {
    pluginId: DROPDOWN_MENU_PLUGIN_ID,
    moduleType: DROPDOWN_MENU_MODULE_TYPE,
    path: 'items',
    kind: 'dropdown-menu-items'
  },
  {
    pluginId: UPLOAD_BUTTON_PLUGIN_ID,
    moduleType: UPLOAD_BUTTON_MODULE_TYPE,
    path: 'accept',
    kind: 'upload-accept'
  },
  {
    pluginId: SLIDE_MENU_PLUGIN_ID,
    moduleType: SLIDE_MENU_MODULE_TYPE,
    path: 'items',
    kind: 'slide-menu-items'
  },
  {
    pluginId: MODAL_PLUGIN_ID,
    moduleType: MODAL_MODULE_TYPE,
    path: 'content',
    kind: 'modal-content'
  },
  {
    pluginId: TABS_PLUGIN_ID,
    moduleType: TABS_MODULE_TYPE,
    path: 'tabs',
    kind: 'tabs-items'
  },
  {
    pluginId: ACCORDION_PLUGIN_ID,
    moduleType: ACCORDION_MODULE_TYPE,
    path: 'items',
    kind: 'accordion-items'
  },
  {
    pluginId: MARKDOWN_PLUGIN_ID,
    moduleType: MARKDOWN_MODULE_TYPE,
    path: 'source',
    kind: 'markdown-source'
  },
  {
    pluginId: CODE_BLOCK_PLUGIN_ID,
    moduleType: CODE_BLOCK_MODULE_TYPE,
    path: 'code',
    kind: 'code-block-code'
  }
])

export function specializedModuleFieldKind(
  definition: ModuleDefinition | undefined,
  field: ModulePropertyField
): SpecializedModuleFieldKind | undefined {
  if (!definition || field.path.length !== 1 || typeof field.path[0] !== 'string') return undefined
  return SPECIALIZED_FIELDS.find(
    (candidate) =>
      candidate.pluginId === definition.pluginId &&
      candidate.moduleType === definition.moduleType &&
      candidate.path === field.path[0]
  )?.kind
}
