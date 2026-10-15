import type { Component } from 'vue'
import IconCalendar from '~icons/lucide/calendar'
import IconCheckSquare from '~icons/lucide/check-square'
import IconChevronDown from '~icons/lucide/chevron-down'
import IconCircle from '~icons/lucide/circle'
import IconCircleDot from '~icons/lucide/circle-dot'
import IconColumns from '~icons/lucide/columns-3'
import IconComponentSet from '~icons/lucide/component'
import IconComponent from '~icons/lucide/diamond'
import IconFormInput from '~icons/lucide/form-input'
import IconFrame from '~icons/lucide/frame'
import IconGrid from '~icons/lucide/grid-3x3'
import IconGroup from '~icons/lucide/group'
import IconHand from '~icons/lucide/hand'
import IconSection from '~icons/lucide/layout-grid'
import IconLayoutList from '~icons/lucide/layout-list'
import IconList from '~icons/lucide/list'
import IconMap from '~icons/lucide/map'
import IconMessageCircle from '~icons/lucide/message-circle'
import IconMinus from '~icons/lucide/minus'
import IconMousePointer from '~icons/lucide/mouse-pointer'
import IconMousePointerSquare from '~icons/lucide/mouse-pointer-square'
import IconPalette from '~icons/lucide/palette'
import IconPenTool from '~icons/lucide/pen-tool'
import IconPencil from '~icons/lucide/pencil'
import IconRows from '~icons/lucide/rows-3'
import IconSmile from '~icons/lucide/smile'
import IconSquare from '~icons/lucide/square'
import IconSlot from '~icons/lucide/square-dashed'
import IconStar from '~icons/lucide/star'
import IconText from '~icons/lucide/text'
import IconToggleLeft from '~icons/lucide/toggle-left'
import IconTriangle from '~icons/lucide/triangle'
import IconType from '~icons/lucide/type'

import {
  isAutoLayoutMode,
  readModuleInstance,
  readIcon,
  slotPropertyId,
  type SceneNode,
  type LayoutMode,
  type ModuleInstanceV1
} from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import type { Tool } from '@/app/editor/session'

import { moduleIcon } from './module-icons'

export const toolIcons: Record<Tool, Component> = {
  SELECT: IconMousePointer,
  FRAME: IconFrame,
  SECTION: IconSection,
  RECTANGLE: IconSquare,
  ELLIPSE: IconCircle,
  LINE: IconMinus,
  POLYGON: IconTriangle,
  STAR: IconStar,
  PEN: IconPenTool,
  PENCIL: IconPencil,
  TEXT: IconType,
  HAND: IconHand,
  INPUT: IconFormInput,
  BUTTON: IconMousePointerSquare,
  SELECT_FIELD: IconChevronDown,
  CHECKBOX: IconCheckSquare,
  FORM: IconLayoutList,
  LIST: IconList,
  RADIO: IconCircleDot,
  TEXTAREA: IconText,
  DATEPICKER: IconCalendar,
  SWITCH: IconToggleLeft,
  MAP: IconMap,
  COMMENT: IconMessageCircle
}

export const NODE_ICONS: Partial<Record<string, Component>> = {
  SECTION: IconSection,
  ELLIPSE: IconCircle,
  FRAME: IconFrame,
  GROUP: IconGroup,
  COMPONENT: IconComponent,
  COMPONENT_SET: IconComponentSet,
  INSTANCE: IconComponent,
  LINE: IconMinus,
  TEXT: IconType,
  VECTOR: IconPenTool,
  RECTANGLE: IconSquare,
  INPUT: toolIcons.INPUT,
  BUTTON: toolIcons.BUTTON,
  SELECT: toolIcons.SELECT_FIELD,
  CHECKBOX: toolIcons.CHECKBOX,
  FORM: toolIcons.FORM,
  LIST: toolIcons.LIST,
  RADIO: toolIcons.RADIO,
  TEXTAREA: toolIcons.TEXTAREA,
  DATEPICKER: toolIcons.DATEPICKER,
  SWITCH: toolIcons.SWITCH
}

export const AUTO_LAYOUT_ICONS: Partial<Record<string, typeof IconSquare>> = {
  VERTICAL: IconRows,
  HORIZONTAL: IconColumns,
  GRID: IconGrid
}

export const COMPONENT_TYPES = new Set(['COMPONENT', 'COMPONENT_SET', 'INSTANCE'])

export { IconFrame, IconSquare }

interface NodeIconSource {
  type: string
  layoutMode: LayoutMode
  interactiveProps?: JSONObject
  moduleIdentity?: Pick<ModuleInstanceV1, 'pluginId' | 'moduleType'>
  slot?: boolean
  icon?: boolean
}

export function nodeIcon(node: NodeIconSource) {
  if (node.slot) return IconSlot
  if (node.icon && node.type === 'FRAME') return IconSmile
  if (node.type === 'INPUT' && node.interactiveProps?.inputType === 'color') return IconPalette
  if (node.type === 'FRAME') {
    const module = node.moduleIdentity ?? readModuleInstance(node.interactiveProps?.module)
    if (module) return moduleIcon(module.pluginId, module.moduleType)
  }
  if (node.type === 'FRAME' && isAutoLayoutMode(node.layoutMode))
    return AUTO_LAYOUT_ICONS[node.layoutMode] ?? IconFrame
  return NODE_ICONS[node.type] ?? IconSquare
}

/** `nodeIcon` for a scene node, which carries slot and icon identity in its data. */
export function sceneNodeIcon(node: SceneNode) {
  return nodeIcon({ ...node, slot: !!slotPropertyId(node), icon: !!readIcon(node) })
}
