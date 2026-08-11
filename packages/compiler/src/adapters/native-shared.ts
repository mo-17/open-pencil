import type { IRAttrValue, IRElement, IRNode, IRStateDecl, IRTree } from '#compiler/ir/types'
import type { CompileWarning, CompilerOptions } from '#compiler/types'

import {
  DROPDOWN_MENU_MODULE_CONFIG_VERSION,
  DROPDOWN_MENU_MODULE_TYPE,
  DROPDOWN_MENU_PLUGIN_ID,
  MODAL_MODULE_CONFIG_VERSION,
  MODAL_MODULE_TYPE,
  MODAL_PLUGIN_ID,
  SLIDE_MENU_MODULE_CONFIG_VERSION,
  SLIDE_MENU_MODULE_TYPE,
  SLIDE_MENU_PLUGIN_ID,
  UPLOAD_BUTTON_MODULE_CONFIG_VERSION,
  UPLOAD_BUTTON_MODULE_TYPE,
  UPLOAD_BUTTON_PLUGIN_ID
} from '@open-pencil/core/plugins'

const NATIVE_BORDER_RADII: Readonly<Partial<Record<string, number>>> = {
  none: 0,
  sm: 2,
  DEFAULT: 4,
  md: 6,
  lg: 8,
  xl: 12,
  '2xl': 16,
  '3xl': 24,
  full: 9999
}

export function createCompileWarningSink(
  warnings: CompileWarning[]
): (warning: CompileWarning) => void {
  const keys = new Set<string>()
  return (warning) => {
    const key = `${warning.code}\0${warning.nodeId ?? ''}\0${warning.message}`
    if (keys.has(key)) return
    keys.add(key)
    warnings.push(warning)
  }
}

export function safeNativeStateDefault(state: IRStateDecl): unknown {
  const value = state.defaultValue
  if (state.type === 'string') return typeof value === 'string' ? value : ''
  if (state.type === 'number') {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0
  }
  if (state.type === 'boolean') return value === true
  if (state.type === 'array') return Array.isArray(value) ? value : []
  return value && typeof value === 'object' ? value : {}
}

export function nativeBorderRadius(token: string): number | undefined {
  return NATIVE_BORDER_RADII[token]
}

export function isNativeSwitch(node: IRElement): boolean {
  if (node.controlKind === 'switch' || node.controlKind === 'checkbox') return true
  if (node.attrs.role === 'switch') return true
  return node.tag === 'input' && node.attrs.type === 'checkbox'
}

export function isNativeTextInput(node: IRElement): boolean {
  return node.tag === 'input' || node.tag === 'textarea'
}

export function staticNativeAttr(value: IRAttrValue | undefined): string | undefined {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (value && typeof value === 'object' && value.kind === 'intlMessage') {
    return value.defaultMessage
  }
  return undefined
}

export interface NativeSlideMenuTrigger {
  label: string
  showIcon: boolean
  showLabel: boolean
}

export type NativeModalTrigger = NativeSlideMenuTrigger
export type NativeDropdownMenuTrigger = NativeSlideMenuTrigger
export type NativeUploadButtonTrigger = NativeSlideMenuTrigger

interface NativeTriggerContract {
  pluginId: string
  moduleType: string
  versions: readonly number[]
  allowChildren?: boolean
  legacyDefaultsVersion?: number
  iconKey?: 'showTriggerIcon' | 'showTriggerChevron'
}

function trustedNativeModuleTrigger(
  node: IRElement,
  contract: NativeTriggerContract
): NativeSlideMenuTrigger | undefined {
  const module = node.module
  if (
    (!contract.allowChildren && node.children.length > 0) ||
    module?.pluginId !== contract.pluginId ||
    module.moduleType !== contract.moduleType ||
    !contract.versions.includes(module.configVersion)
  ) {
    return undefined
  }
  const label = module.payload.triggerLabel
  const icon = module.payload[contract.iconKey ?? 'showTriggerIcon']
  const text = module.payload.showTriggerLabel
  const legacyDefaults = module.configVersion === contract.legacyDefaultsVersion
  if (
    typeof label !== 'string' ||
    (!legacyDefaults && (typeof icon !== 'boolean' || typeof text !== 'boolean')) ||
    (legacyDefaults && typeof icon !== 'boolean' && icon !== undefined) ||
    (legacyDefaults && typeof text !== 'boolean' && text !== undefined)
  ) {
    return undefined
  }
  return {
    label,
    showIcon: typeof icon === 'boolean' ? icon : true,
    showLabel: typeof text === 'boolean' ? text : true
  }
}

/** Return only the registered lowerer's validated trigger; authored children remain authoritative. */
export function trustedNativeSlideMenuTrigger(node: IRElement): NativeSlideMenuTrigger | undefined {
  return trustedNativeModuleTrigger(node, {
    pluginId: SLIDE_MENU_PLUGIN_ID,
    moduleType: SLIDE_MENU_MODULE_TYPE,
    versions: [1, SLIDE_MENU_MODULE_CONFIG_VERSION],
    legacyDefaultsVersion: 1
  })
}

/** Modal runtime is web-only in v1; native targets expose only its validated static trigger. */
export function trustedNativeModalTrigger(node: IRElement): NativeModalTrigger | undefined {
  return trustedNativeModuleTrigger(node, {
    pluginId: MODAL_PLUGIN_ID,
    moduleType: MODAL_MODULE_TYPE,
    versions: [MODAL_MODULE_CONFIG_VERSION]
  })
}

/** Dropdown behavior is web-only in v1; native targets expose only its validated trigger. */
export function trustedNativeDropdownMenuTrigger(
  node: IRElement
): NativeDropdownMenuTrigger | undefined {
  return trustedNativeModuleTrigger(node, {
    pluginId: DROPDOWN_MENU_PLUGIN_ID,
    moduleType: DROPDOWN_MENU_MODULE_TYPE,
    versions: [DROPDOWN_MENU_MODULE_CONFIG_VERSION],
    iconKey: 'showTriggerChevron'
  })
}

/**
 * File selection is web-only in v1. Native targets always replace a validated Upload Button
 * module with a disabled static trigger, including when the web trigger has authored children.
 */
export function trustedNativeUploadButtonTrigger(
  node: IRElement
): NativeUploadButtonTrigger | undefined {
  return trustedNativeModuleTrigger(node, {
    allowChildren: true,
    pluginId: UPLOAD_BUTTON_PLUGIN_ID,
    moduleType: UPLOAD_BUTTON_MODULE_TYPE,
    versions: [UPLOAD_BUTTON_MODULE_CONFIG_VERSION]
  })
}

export function walkNativeNodes(nodes: readonly IRNode[], visit: (node: IRNode) => void): void {
  for (const node of nodes) {
    visit(node)
    if (node.kind === 'element') walkNativeNodes(node.children, visit)
    else if (node.kind === 'conditional') walkNativeNodes([node.consequent], visit)
    else if (node.kind === 'list') walkNativeNodes([node.template], visit)
  }
}

export function selectNativePages(
  irs: readonly IRTree[],
  router: boolean,
  omitted: (ir: IRTree) => void
): readonly IRTree[] {
  if (router || irs.length <= 1) return irs
  for (const ir of irs.slice(1)) omitted(ir)
  return irs.slice(0, 1)
}

export function nativeUnsupportedOptionNames(options: CompilerOptions): string[] {
  const names: string[] = []
  if (options.uiKit) names.push('uiKit')
  if (options.metadata) names.push('metadata')
  if (options.themeCss?.trim()) names.push('themeCss')
  if (options.themeSwitch) names.push('themeSwitch')
  if (options.i18n) names.push('i18n runtime')
  return names
}
