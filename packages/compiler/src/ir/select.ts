import { uniq } from 'es-toolkit'

import {
  DEFAULT_LOWCODE_PLACEHOLDER_COLOR,
  DEFAULT_LOWCODE_SELECT_PLACEHOLDER,
  DEFAULT_LOWCODE_TEXT_COLOR,
  normalizeLowcodeTextColor
} from '@open-pencil/lowcode'
import type { SceneNode } from '@open-pencil/scene-graph'

import type { IRElement, IRList, IRNode } from './types'

export function selectFeatures(
  node: SceneNode
): Pick<IRElement, 'selectFeatures' | 'selectDefaultValues'> {
  if (node.type !== 'SELECT') return {}
  const showSearch = node.interactiveProps?.showSearch === true
  const virtual = node.interactiveProps?.virtual === true
  const multiple = node.interactiveProps?.multiple === true
  if (!showSearch && !virtual && !multiple) return {}
  const value = node.interactiveProps?.value
  return {
    selectFeatures: { showSearch, virtual },
    ...(multiple
      ? {
          selectDefaultValues: Array.isArray(value)
            ? uniq(value.filter((item): item is string => typeof item === 'string'))
            : []
        }
      : {})
  }
}

export function selectPlaceholder(props: Record<string, unknown>): string | undefined {
  if (typeof props.placeholder === 'string' && props.placeholder !== '') return props.placeholder
  return props.allowClear === true ? DEFAULT_LOWCODE_SELECT_PLACEHOLDER : undefined
}

/** Only compiler-created empty options are placeholders; authored empty values keep their label. */
export function selectPlaceholderOption(node: SceneNode, text: IRNode, list?: IRList): IRElement {
  const option: IRElement = {
    kind: 'element',
    sourceId: node.id,
    tag: 'option',
    className: '',
    attrs: {
      value: '',
      'data-op-select-placeholder': '',
      ...(node.interactiveProps?.allowClear === true ? {} : { disabled: true })
    },
    children: [text]
  }
  if (list?.template.kind === 'element') {
    const value = list.template.attrs.value
    if (typeof value === 'object' && value.kind === 'exprAttr') {
      option.selectEmptyOptionGuard = {
        arrayName: list.arrayName,
        itemName: list.itemName,
        indexName: list.indexName,
        value: value.ast
      }
    }
  }
  return option
}

export function selectClassName(classes: readonly string[], node: SceneNode): string {
  const props = node.interactiveProps ?? {}
  const base = [...classes, ...selectIndicatorClasses(node)]
  const placeholder = selectPlaceholder(props)
  if (
    placeholder === undefined &&
    props.textColor === undefined &&
    props.placeholderColor === undefined
  )
    return base.join(' ')
  const text = normalizeLowcodeTextColor(props.textColor, DEFAULT_LOWCODE_TEXT_COLOR)
  const hint = normalizeLowcodeTextColor(props.placeholderColor, DEFAULT_LOWCODE_PLACEHOLDER_COLOR)
  return [
    ...base,
    `text-[${text}]`,
    `[&>option]:text-[${text}]`,
    ...(props.showSearch === true || props.virtual === true || props.multiple === true
      ? [`[&[data-op-select-placeholder]]:text-[${hint}]`]
      : []),
    `[&:has(>option[data-op-select-placeholder]:checked)]:text-[${hint}]`
  ].join(' ')
}

/** Native menu arrows ignore CSS padding. Scope the inset indicator to actual
 * selects: Radix triggers already own an icon. Complex authored backgrounds
 * retain their system indicator instead of losing image/gradient layers. */
function selectIndicatorClasses(node: SceneNode): string[] {
  const fills = [
    node.fills,
    ...Object.values(node.stateOverrides ?? {}).map((state) => state.fills)
  ]
  if (
    fills.some(
      (paints) => paints && (paints.length > 1 || paints.some((fill) => fill.type !== 'SOLID'))
    ) ||
    Object.keys(node.boundVariables).some(
      (key) => key.startsWith('fills/') || key === 'paddingRight'
    ) ||
    Object.values(node.responsiveOverrides ?? {}).some(
      (override) => override.paddingRight !== undefined
    )
  )
    return []
  const inset = Math.max(12, node.paddingRight)
  const svg = encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12" fill="none"><path d="m2.4 4.2 3.6 3.6 3.6-3.6" stroke="#6B7280" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  )
  const native = '[&:is(select):dir(ltr)]'
  return [
    `${native}:appearance-none`,
    `${native}:[background-image:url('data:image/svg+xml,${svg}')]`,
    `${native}:[background-position:right_${inset}px_center]`,
    `${native}:[background-size:12px_12px]`,
    `${native}:bg-no-repeat`,
    `${native}:[padding-right:${inset + 20}px]`,
    `forced-colors:${native}:appearance-auto`,
    `forced-colors:${native}:[background-image:none]`
  ]
}

export function selectOptionClassName(node: SceneNode): string {
  if (node.interactiveProps?.textColor === undefined) return ''
  return `text-[${normalizeLowcodeTextColor(node.interactiveProps.textColor, DEFAULT_LOWCODE_TEXT_COLOR)}]`
}
