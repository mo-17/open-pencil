import {
  DEFAULT_LOWCODE_SELECT_PLACEHOLDER,
  isIsoDate,
  isIsoTime,
  isIsoLocalDateTime,
  isLowcodeNumberValue,
  isHexColorInputValue,
  lowcodeSelectOptions,
  type LowcodeSelectOption
} from '@open-pencil/lowcode'
import type { SceneNode } from '@open-pencil/scene-graph'

export type LowcodeTextContentKind =
  | 'button_label'
  | 'input_value'
  | 'input_placeholder'
  | 'textarea_value'
  | 'textarea_placeholder'
  | 'radio_options'
  | 'checkbox_options'
  | 'datepicker_value'
  | 'datepicker_placeholder'
  | 'select_value'
  | 'select_placeholder'

export interface LowcodeTextProjection {
  node: SceneNode
  contentKind: LowcodeTextContentKind
}

function projectedTextNode(
  node: SceneNode,
  text: string,
  overrides: Partial<SceneNode>
): SceneNode {
  return {
    ...node,
    type: 'TEXT',
    childIds: [],
    text,
    textAutoResize: 'NONE',
    textPicture: null,
    derivedTextGlyphs: null,
    textPathData: null,
    textPathBox: null,
    ...overrides
  }
}

/**
 * Project a lowcode BUTTON label into the regular text model without adding a
 * synthetic child to the scene graph. Keeping this helper in the text domain
 * lets both font preflight and CanvasKit rendering observe the same content.
 */
export function buttonLabelTextNode(node: SceneNode): SceneNode | null {
  const text = node.interactiveProps?.text
  if (node.type !== 'BUTTON' || typeof text !== 'string' || text.length === 0) return null

  return projectedTextNode(node, text, {
    textAlignHorizontal: 'CENTER',
    textAlignVertical: 'CENTER',
    width: node.width,
    height: node.height
  })
}

export interface TextInputDesignContent {
  value?: string
  unresolved?: boolean
}

function textInputDisplayValue(
  node: SceneNode,
  content: TextInputDesignContent
): string | undefined {
  const unresolved = content.unresolved ?? node.bindings?.value !== undefined
  const candidate = unresolved ? undefined : (content.value ?? node.interactiveProps?.value)
  if (typeof candidate !== 'string') return undefined
  if (node.type !== 'INPUT') return candidate
  return scalarInputDisplayValue(node.interactiveProps?.inputType, candidate)
}

function scalarInputDisplayValue(type: unknown, candidate: string): string | undefined {
  const value = candidate.replace(/[\r\n]/g, '')
  if (type === 'color') return isHexColorInputValue(candidate) ? candidate.toLowerCase() : value
  if (type === 'time' && !isIsoTime(candidate)) return undefined
  if (type === 'datetime-local')
    return isIsoLocalDateTime(candidate) ? candidate.replace('T', ' ') : undefined
  if (type === 'number' && !isLowcodeNumberValue(value)) return undefined
  return type === 'password' ? '•'.repeat(Array.from(value).length) : value
}

function temporalInputPlaceholder(node: SceneNode): string {
  const ip = node.interactiveProps
  const dateTime = ip?.inputType === 'datetime-local'
  const valid = dateTime ? isIsoLocalDateTime : isIsoTime
  const seconds =
    (typeof ip?.step === 'number' && ip.step % 60 !== 0) ||
    [ip?.value, ip?.min, ip?.max].some(
      (value) => valid(value) && value.length === (dateTime ? 19 : 8)
    )
  return (dateTime ? 'YYYY-MM-DD ' : '') + (seconds ? 'HH:mm:ss' : 'HH:mm')
}

function textInputPlaceholder(node: SceneNode): unknown {
  if (node.type !== 'INPUT') return node.interactiveProps?.placeholder
  if (node.interactiveProps?.inputType === 'color') return '—'
  if (['time', 'datetime-local'].includes(String(node.interactiveProps?.inputType)))
    return temporalInputPlaceholder(node)
  return node.interactiveProps?.placeholder
}

export function textInputProjection(
  node: SceneNode,
  content: TextInputDesignContent = {}
): LowcodeTextProjection | null {
  if (node.type !== 'INPUT' && node.type !== 'TEXTAREA') return null
  const value = textInputDisplayValue(node, content)
  const placeholder = textInputPlaceholder(node)
  const showsValue = typeof value === 'string' && value.length > 0
  let text = ''
  if (showsValue) text = value
  else if (typeof placeholder === 'string') text = placeholder
  if (node.type === 'INPUT') text = text.replace(/[\r\n]/g, '')
  const prefix = node.type === 'INPUT' ? 'input' : 'textarea'
  const width = Math.max(0, node.width - node.paddingLeft - node.paddingRight)
  const height = Math.max(0, node.height - node.paddingTop - node.paddingBottom)

  return {
    node: projectedTextNode(node, text, {
      width,
      height,
      textAlignVertical: node.type === 'INPUT' ? 'CENTER' : node.textAlignVertical,
      ...(node.type === 'INPUT' ? { textTruncation: 'ENDING', maxLines: 1 } : {})
    }),
    contentKind: `${prefix}_${showsValue ? 'value' : 'placeholder'}` as LowcodeTextContentKind
  }
}

/** Use the authored ISO day without a timezone-dependent display conversion. */
export function datePickerTextProjection(
  node: SceneNode,
  value?: string
): LowcodeTextProjection | null {
  if (node.type !== 'DATEPICKER') return null
  const candidate = value ?? node.interactiveProps?.value
  const valid = typeof candidate === 'string' && isIsoDate(candidate)
  return {
    node: singleLineControlText(node, valid ? candidate : 'YYYY-MM-DD'),
    contentKind: valid ? 'datepicker_value' : 'datepicker_placeholder'
  }
}

export interface SelectDesignContent {
  value?: string | string[]
  options?: LowcodeSelectOption[]
  unresolved?: boolean
}

function singleLineControlText(node: SceneNode, text: string): SceneNode {
  return projectedTextNode(node, text, {
    width: Math.max(0, node.width - node.paddingLeft - node.paddingRight),
    height: Math.max(0, node.height - node.paddingTop - node.paddingBottom),
    textAlignHorizontal: 'LEFT',
    textAlignVertical: 'CENTER',
    textTruncation: 'ENDING',
    maxLines: 1
  })
}

function selectPlaceholder(node: SceneNode): string {
  const ip = node.interactiveProps
  if (typeof ip?.placeholder === 'string' && ip.placeholder !== '') return ip.placeholder
  return ip?.allowClear === true ? DEFAULT_LOWCODE_SELECT_PLACEHOLDER : ''
}

function selectedOption(
  node: SceneNode,
  content: SelectDesignContent,
  placeholder: string
): LowcodeSelectOption | undefined {
  const ip = node.interactiveProps
  const unresolved =
    content.unresolved ?? (node.bindings?.value !== undefined || !!ip?.optionsSource)
  if (unresolved) return undefined
  const options = content.options ?? lowcodeSelectOptions(ip?.options)
  const value = content.value ?? ip?.value
  if (typeof value === 'string') {
    const match = options.find((option) => option.value === value)
    if (match || node.bindings?.value || placeholder !== '') return match
    // Legacy uncontrolled selects without a matching default use the native first option.
    return options.find((option) => !option.disabled)
  }
  return placeholder !== ''
    ? options.find((option) => option.value === '')
    : options.find((option) => !option.disabled)
}

/** Resolve a closed select's display label, preserving the distinct submitted value. */
export function selectTextProjection(
  node: SceneNode,
  content: SelectDesignContent = {}
): LowcodeTextProjection | null {
  if (node.type !== 'SELECT') return null
  const placeholder = selectPlaceholder(node)
  if (node.interactiveProps?.multiple === true) {
    const raw = content.value ?? node.interactiveProps.value
    const options = content.options ?? lowcodeSelectOptions(node.interactiveProps.options)
    const values = !content.unresolved && Array.isArray(raw) ? raw : []
    const labels = options
      .filter((option) => values.includes(option.value))
      .map((option) => option.label)
    return {
      node: singleLineControlText(node, labels.join(' · ') || placeholder),
      contentKind: labels.length ? 'select_value' : 'select_placeholder'
    }
  }
  const selected = selectedOption(node, content, placeholder)
  return {
    node: singleLineControlText(node, selected?.label ?? placeholder),
    contentKind: selected ? 'select_value' : 'select_placeholder'
  }
}

/** Project every lowcode control that owns visible text into the regular text model. */
export function lowcodeTextProjection(node: SceneNode): LowcodeTextProjection | null {
  const button = buttonLabelTextNode(node)
  if (button) return { node: button, contentKind: 'button_label' }
  if (
    (node.type === 'RADIO' || node.type === 'CHECKBOX') &&
    Array.isArray(node.interactiveProps?.options)
  ) {
    const text = node.interactiveProps.options
      .filter((option): option is string => typeof option === 'string')
      .join('\n')
    return {
      node: projectedTextNode(node, text, {}),
      contentKind: node.type === 'RADIO' ? 'radio_options' : 'checkbox_options'
    }
  }
  return selectTextProjection(node) ?? datePickerTextProjection(node) ?? textInputProjection(node)
}

export function lowcodeTextNode(node: SceneNode): SceneNode | null {
  return lowcodeTextProjection(node)?.node ?? null
}
