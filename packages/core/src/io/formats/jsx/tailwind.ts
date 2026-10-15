import { compact } from 'es-toolkit'

import { escapeJSXText, formatProp } from '@open-pencil/design-jsx'
import type { SceneGraph, SceneNode, NodeType } from '@open-pencil/scene-graph'

import { collectTailwindClasses } from './tailwind-classes'

const NODE_TYPE_TO_TW_TAG: Partial<Record<NodeType, string>> = {
  FRAME: 'div',
  RECTANGLE: 'div',
  ROUNDED_RECTANGLE: 'div',
  ELLIPSE: 'div',
  TEXT: 'p',
  LINE: 'div',
  STAR: 'div',
  POLYGON: 'div',
  VECTOR: 'div',
  GROUP: 'div',
  SECTION: 'section',
  COMPONENT: 'div',
  COMPONENT_SET: 'div',
  INSTANCE: 'div',
  BUTTON: 'button',
  INPUT: 'input',
  SELECT: 'select',
  CHECKBOX: 'input',
  FORM: 'form',
  LIST: 'div',
  RADIO: 'div',
  TEXTAREA: 'textarea',
  DATEPICKER: 'input',
  SWITCH: 'input'
}

function buttonLabel(node: SceneNode): string {
  const text = node.interactiveProps?.text
  return typeof text === 'string' && text.trim() ? text : 'Button'
}

function selectOptions(node: SceneNode): string[] {
  const options = node.interactiveProps?.options
  if (!Array.isArray(options)) return []
  return options.filter((option): option is string => typeof option === 'string')
}

function isCheckboxGroup(node: SceneNode): boolean {
  if (node.type !== 'CHECKBOX') return false
  const options = node.interactiveProps?.options
  if (Array.isArray(options) && options.length > 0) return true
  const source = node.interactiveProps?.optionsSource
  return typeof source === 'object' && source !== null
}

function nodeTag(node: SceneNode): string | undefined {
  return isCheckboxGroup(node) ? 'div' : NODE_TYPE_TO_TW_TAG[node.type]
}

function collectTailwindAttrs(node: SceneNode, graph: SceneGraph): [string, unknown][] {
  const classes = collectTailwindClasses(node, graph)
  const attrs: [string, unknown][] = []
  if (node.name && node.name !== node.type) attrs.push(['data-name', node.name])
  if (classes.length > 0) attrs.push(['className', classes.join(' ')])

  collectTailwindInteractiveAttrs(node, attrs)
  return attrs
}

function pushStringInteractiveAttr(
  node: SceneNode,
  prop: string,
  attr: string,
  attrs: [string, unknown][]
): void {
  const value = node.interactiveProps?.[prop]
  if (typeof value === 'string' && value !== '') attrs.push([attr, value])
}

function pushDefaultChecked(node: SceneNode, attrs: [string, unknown][]): void {
  if (node.interactiveProps?.checked === true) attrs.push(['defaultChecked', true])
}

function collectTailwindInteractiveAttrs(node: SceneNode, attrs: [string, unknown][]): void {
  switch (node.type) {
    case 'BUTTON':
      attrs.push(['type', 'button'])
      return
    case 'INPUT':
      attrs.push(['type', 'text'])
      pushStringInteractiveAttr(node, 'placeholder', 'placeholder', attrs)
      pushStringInteractiveAttr(node, 'value', 'defaultValue', attrs)
      return
    case 'SELECT':
      pushStringInteractiveAttr(node, 'value', 'defaultValue', attrs)
      return
    case 'CHECKBOX':
      if (isCheckboxGroup(node)) attrs.push(['role', 'group'])
      else {
        attrs.push(['type', 'checkbox'])
        pushDefaultChecked(node, attrs)
      }
      return
    case 'RADIO':
      attrs.push(['role', 'radiogroup'])
      return
    case 'TEXTAREA':
      pushStringInteractiveAttr(node, 'placeholder', 'placeholder', attrs)
      pushStringInteractiveAttr(node, 'value', 'defaultValue', attrs)
      return
    case 'DATEPICKER':
      attrs.push(['type', 'date'])
      pushStringInteractiveAttr(node, 'value', 'defaultValue', attrs)
      pushStringInteractiveAttr(node, 'min', 'min', attrs)
      pushStringInteractiveAttr(node, 'max', 'max', attrs)
      return
    case 'SWITCH':
      attrs.push(['type', 'checkbox'], ['role', 'switch'])
      pushDefaultChecked(node, attrs)
  }
}

function tailwindOptionGroup(node: SceneNode, opening: string, prefix: string): string | null {
  if (node.type !== 'RADIO' && !isCheckboxGroup(node)) return null
  const options = selectOptions(node)
  if (options.length === 0) return null

  const inputType = node.type === 'RADIO' ? 'radio' : 'checkbox'
  const groupName = inputType === 'radio' ? node.interactiveProps?.groupName : undefined
  const selected = inputType === 'radio' ? node.interactiveProps?.value : undefined
  const rows = options.map((option) => {
    const attrs: [string, unknown][] = [
      ['type', inputType],
      ['value', option]
    ]
    if (typeof groupName === 'string' && groupName !== '') attrs.push(['name', groupName])
    if (selected === option) attrs.push(['defaultChecked', true])
    const inputAttrs = attrs.map(([key, value]) => formatProp(key, value)).join(' ')
    return `${prefix}  <label><input ${inputAttrs} />${escapeJSXText(option)}</label>`
  })
  return [`${prefix}${opening}>`, ...rows, `${prefix}</div>`].join('\n')
}

function nodeToJSX(node: SceneNode, graph: SceneGraph, indent: number): string {
  const tag = nodeTag(node)
  if (!tag) return ''

  const prefix = '  '.repeat(indent)
  let attrsStr: string

  {
    attrsStr = collectTailwindAttrs(node, graph)
      .map(([k, v]) => formatProp(k, v))
      .join(' ')
  }

  const children = graph.getChildren(node.id)
  const opening = attrsStr ? `<${tag} ${attrsStr}` : `<${tag}`

  if (node.type === 'TEXT') {
    const text = node.text
    if (!text) return `${prefix}${opening} />`
    const escaped = escapeJSXText(text)
    if (!escaped.includes('\n')) {
      return `${prefix}${opening}>${escaped}</${tag}>`
    }
    return [
      `${prefix}${opening}>`,
      ...escaped.split('\n').map((l) => `${prefix}  ${l}`),
      `${prefix}</${tag}>`
    ].join('\n')
  }

  if (node.type === 'BUTTON' && children.length === 0) {
    return `${prefix}${opening}>${escapeJSXText(buttonLabel(node))}</${tag}>`
  }

  if (node.type === 'SELECT' && children.length === 0) {
    const options = selectOptions(node)
    if (options.length === 0) return `${prefix}${opening} />`
    return [
      `${prefix}${opening}>`,
      ...options.map(
        (option) =>
          `${prefix}  <option ${formatProp('value', option)}>${escapeJSXText(option)}</option>`
      ),
      `${prefix}</${tag}>`
    ].join('\n')
  }

  if (children.length === 0) {
    const optionGroup = tailwindOptionGroup(node, opening, prefix)
    if (optionGroup) return optionGroup
  }

  if (children.length === 0) return `${prefix}${opening} />`

  const childJSX = compact(
    children.filter((c) => c.visible).map((c) => nodeToJSX(c, graph, indent + 1))
  )

  if (childJSX.length === 0) return `${prefix}${opening} />`

  return [`${prefix}${opening}>`, ...childJSX, `${prefix}</${tag}>`].join('\n')
}

export function sceneNodeToTailwindJSX(nodeId: string, graph: SceneGraph): string {
  const node = graph.getNode(nodeId)
  if (!node) return ''
  return nodeToJSX(node, graph, 0)
}

export function selectionToTailwindJSX(nodeIds: string[], graph: SceneGraph): string {
  return compact(nodeIds.map((id) => sceneNodeToTailwindJSX(id, graph))).join('\n\n')
}
