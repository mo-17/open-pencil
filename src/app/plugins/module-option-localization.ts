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
