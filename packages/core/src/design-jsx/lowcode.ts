import { isInteractivePropsObject, validateInteractiveProps } from '@open-pencil/lowcode'
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

const INTERACTIVE_PROP_NAMES: Record<LowcodeNodeType, readonly string[]> = {
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

export interface PreparedLowcodeProps {
  interactiveProps?: Record<string, unknown>
  warnings: string[]
}

function validateConvenienceProp(elementName: string, key: string, value: unknown): void {
  if (key === 'options') {
    if (!Array.isArray(value) || !value.every((option) => typeof option === 'string')) {
      throw new TypeError(`<${elementName}> options must be an array of strings`)
    }
    return
  }
  if (key === 'checked') {
    if (typeof value !== 'boolean') {
      throw new TypeError(`<${elementName}> checked must be a boolean`)
    }
    return
  }
  if (typeof value !== 'string') {
    throw new TypeError(`<${elementName}> ${key} must be a string`)
  }
}

/**
 * Convert Design JSX's convenient lowcode props into SceneNode fields. The
 * caller merges `interactiveProps` with the type-specific defaults after
 * `createNode`, so an authored subset never removes defaults owned by the
 * scene graph.
 */
export function prepareLowcodeProps(
  nodeType: LowcodeNodeType,
  elementName: string,
  props: Record<string, unknown>,
  buttonText?: string
): PreparedLowcodeProps {
  const rawInteractiveProps = props.interactiveProps
  let hasInteractivePatch = rawInteractiveProps !== undefined

  if (rawInteractiveProps !== undefined && !isInteractivePropsObject(rawInteractiveProps)) {
    throw new Error(`<${elementName}> interactiveProps must be an object`)
  }

  const interactiveProps: Record<string, unknown> = rawInteractiveProps
    ? { ...rawInteractiveProps }
    : {}
  for (const key of INTERACTIVE_PROP_NAMES[nodeType]) {
    if (props[key] === undefined) continue
    validateConvenienceProp(elementName, key, props[key])
    interactiveProps[key] = props[key]
    hasInteractivePatch = true
  }
  if (nodeType === 'BUTTON' && buttonText !== undefined) {
    interactiveProps.text = buttonText
    hasInteractivePatch = true
  }

  const issues = validateInteractiveProps(nodeType, interactiveProps)
  const firstError = issues.find((issue) => issue.severity === 'error')
  if (firstError) throw new Error(`<${elementName}> ${firstError.reason}`)

  return {
    interactiveProps: hasInteractivePatch ? interactiveProps : undefined,
    warnings: issues
      .filter((issue) => issue.severity === 'warning')
      .map((issue) => `<${elementName}> ${issue.reason}`)
  }
}
