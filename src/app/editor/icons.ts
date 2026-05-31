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
import IconLayoutList from '~icons/lucide/layout-list'
import IconSection from '~icons/lucide/layout-grid'
import IconList from '~icons/lucide/list'
import IconMinus from '~icons/lucide/minus'
import IconMousePointer from '~icons/lucide/mouse-pointer'
import IconMousePointerSquare from '~icons/lucide/mouse-pointer-square'
import IconPenTool from '~icons/lucide/pen-tool'
import IconRows from '~icons/lucide/rows-3'
import IconSquare from '~icons/lucide/square'
import IconStar from '~icons/lucide/star'
import IconText from '~icons/lucide/text'
import IconToggleLeft from '~icons/lucide/toggle-left'
import IconTriangle from '~icons/lucide/triangle'
import IconType from '~icons/lucide/type'

import { isAutoLayoutMode, type LayoutMode } from '@open-pencil/core/scene-graph'

import type { Tool } from '@/app/editor/session'

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
  SWITCH: IconToggleLeft
}

export const NODE_ICONS: Partial<Record<string, typeof IconSquare>> = {
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
  RECTANGLE: IconSquare
}

export const AUTO_LAYOUT_ICONS: Partial<Record<string, typeof IconSquare>> = {
  VERTICAL: IconRows,
  HORIZONTAL: IconColumns,
  GRID: IconGrid
}

export const COMPONENT_TYPES = new Set(['COMPONENT', 'COMPONENT_SET', 'INSTANCE'])

export { IconFrame, IconSquare }

export function nodeIcon(node: { type: string; layoutMode: LayoutMode }) {
  // Phase 2 §6: only auto-layout frames pick from AUTO_LAYOUT_ICONS;
  // FREE (and any future non-auto-layout mode) falls back to IconFrame.
  if (node.type === 'FRAME' && isAutoLayoutMode(node.layoutMode))
    return AUTO_LAYOUT_ICONS[node.layoutMode] ?? IconFrame
  return NODE_ICONS[node.type] ?? IconSquare
}
