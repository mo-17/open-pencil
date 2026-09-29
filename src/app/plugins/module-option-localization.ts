const DROPDOWN_MENU_OPTION_PANEL_KEYS = Object.freeze({
  'lowcodeModuleFieldDropdownMenuTriggerMode:click':
    'lowcodeModuleFieldDropdownMenuTriggerModeClick',
  'lowcodeModuleFieldDropdownMenuTriggerMode:hover':
    'lowcodeModuleFieldDropdownMenuTriggerModeHover',
  'lowcodeModuleFieldDropdownMenuPlacement:bottomLeft':
    'lowcodeModuleFieldDropdownMenuPlacementBottomLeft',
  'lowcodeModuleFieldDropdownMenuPlacement:bottom': 'lowcodeModuleFieldDropdownMenuPlacementBottom',
  'lowcodeModuleFieldDropdownMenuPlacement:bottomRight':
    'lowcodeModuleFieldDropdownMenuPlacementBottomRight',
  'lowcodeModuleFieldDropdownMenuPlacement:topLeft':
    'lowcodeModuleFieldDropdownMenuPlacementTopLeft',
  'lowcodeModuleFieldDropdownMenuPlacement:top': 'lowcodeModuleFieldDropdownMenuPlacementTop',
  'lowcodeModuleFieldDropdownMenuPlacement:topRight':
    'lowcodeModuleFieldDropdownMenuPlacementTopRight',
  'lowcodeModuleFieldDropdownMenuPlacement:leftTop':
    'lowcodeModuleFieldDropdownMenuPlacementLeftTop',
  'lowcodeModuleFieldDropdownMenuPlacement:left': 'lowcodeModuleFieldDropdownMenuPlacementLeft',
  'lowcodeModuleFieldDropdownMenuPlacement:leftBottom':
    'lowcodeModuleFieldDropdownMenuPlacementLeftBottom',
  'lowcodeModuleFieldDropdownMenuPlacement:rightTop':
    'lowcodeModuleFieldDropdownMenuPlacementRightTop',
  'lowcodeModuleFieldDropdownMenuPlacement:right': 'lowcodeModuleFieldDropdownMenuPlacementRight',
  'lowcodeModuleFieldDropdownMenuPlacement:rightBottom':
    'lowcodeModuleFieldDropdownMenuPlacementRightBottom'
} as const)

export function dropdownMenuOptionPanelKey(
  fieldI18nLabelKey: string | undefined,
  option: string
): string | undefined {
  if (!fieldI18nLabelKey) return undefined
  const key = `${fieldI18nLabelKey}:${option}`
  return DROPDOWN_MENU_OPTION_PANEL_KEYS[key as keyof typeof DROPDOWN_MENU_OPTION_PANEL_KEYS]
}

const MODULE_OPTION_PANEL_KEYS = Object.freeze({
  'lowcodeModuleOrgChartDirection:vertical': 'lowcodeModuleOrgChartVertical',
  'lowcodeModuleOrgChartDirection:horizontal': 'lowcodeModuleOrgChartHorizontal',
  'lowcodeModuleDescriptionsLayout:horizontal': 'lowcodeModuleDescriptionsHorizontal',
  'lowcodeModuleDescriptionsLayout:vertical': 'lowcodeModuleDescriptionsVertical',
  'lowcodeModuleDescriptionsDensity:comfortable': 'lowcodeModuleDescriptionsComfortable',
  'lowcodeModuleDescriptionsDensity:compact': 'lowcodeModuleDescriptionsCompact',
  'lowcodeModuleFieldDataGridSelectionMode:none': 'lowcodeModuleDataGridSelectionNone',
  'lowcodeModuleFieldDataGridSelectionMode:single': 'lowcodeModuleDataGridSelectionSingle',
  'lowcodeModuleFieldDataGridSelectionMode:multiple': 'lowcodeModuleDataGridSelectionMultiple',
  'lowcodeModuleFieldDataGridDensity:compact': 'lowcodeModuleDataGridDensityCompact',
  'lowcodeModuleFieldDataGridDensity:comfortable': 'lowcodeModuleDataGridDensityComfortable'
} as const)

export function moduleOptionPanelKey(
  fieldI18nLabelKey: string | undefined,
  option: string
): string | undefined {
  const dropdownKey = dropdownMenuOptionPanelKey(fieldI18nLabelKey, option)
  if (dropdownKey || !fieldI18nLabelKey) return dropdownKey
  const key = `${fieldI18nLabelKey}:${option}`
  return MODULE_OPTION_PANEL_KEYS[key as keyof typeof MODULE_OPTION_PANEL_KEYS]
}
