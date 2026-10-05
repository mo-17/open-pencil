import type { NodeType } from '@open-pencil/scene-graph'

export type LowcodeNodeType = Extract<
  NodeType,
  | 'BUTTON'
  | 'INPUT'
  | 'SELECT'
  | 'CHECKBOX'
  | 'FORM'
  | 'LIST'
  | 'RADIO'
  | 'TEXTAREA'
  | 'DATEPICKER'
  | 'SWITCH'
>

export const LOWCODE_TYPE_MAP: Readonly<Record<string, LowcodeNodeType>> = {
  button: 'BUTTON',
  input: 'INPUT',
  select: 'SELECT',
  checkbox: 'CHECKBOX',
  form: 'FORM',
  list: 'LIST',
  radio: 'RADIO',
  textarea: 'TEXTAREA',
  datepicker: 'DATEPICKER',
  'date-picker': 'DATEPICKER',
  switch: 'SWITCH'
}

const LOWCODE_NODE_TYPES = new Set<LowcodeNodeType>(Object.values(LOWCODE_TYPE_MAP))

export function isLowcodeNodeType(nodeType: NodeType): nodeType is LowcodeNodeType {
  return LOWCODE_NODE_TYPES.has(nodeType as LowcodeNodeType)
}

export const LOWCODE_INTRINSIC_ELEMENTS = [
  'button',
  'input',
  'select',
  'checkbox',
  'form',
  'list',
  'radio',
  'textarea',
  'datepicker',
  'date-picker',
  'switch'
] as const

export const INTERACTIVE_PROP_NAMES: Record<LowcodeNodeType, readonly string[]> = {
  BUTTON: ['text', 'textColor'],
  INPUT: ['placeholder', 'value', 'textColor', 'placeholderColor'],
  SELECT: ['options', 'value'],
  CHECKBOX: ['options', 'checked'],
  FORM: [],
  LIST: [],
  RADIO: ['options', 'value', 'groupName'],
  TEXTAREA: ['placeholder', 'value', 'textColor', 'placeholderColor'],
  DATEPICKER: ['value', 'min', 'max'],
  SWITCH: ['checked']
}

export const LOWCODE_SUPPORTED_PROP_NAMES: readonly string[] = [
  'interactiveProps',
  ...new Set(Object.values(INTERACTIVE_PROP_NAMES).flat())
]
