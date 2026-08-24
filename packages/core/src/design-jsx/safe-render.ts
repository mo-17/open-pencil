import { parse, type Node } from 'acorn'
import { transform } from 'sucrase'

import { backgroundBlur, dropShadow, foregroundBlur, innerShadow, layerBlur } from './effects'
import * as React from './mini-react'
import {
  angularGradient,
  diamondGradient,
  gradient,
  linearGradient,
  radialGradient,
  solid
} from './paints'
import { designVar, defineVars } from './vars'

type ASTNode = Node & Record<string, unknown>

interface SafeEvaluatedObject {
  [key: string]: unknown
}

const MAX_SAFE_EXPRESSION_DEPTH = 128
const RESERVED_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

const TAG_ALIASES = new Map<string, string>([
  ['Frame', 'frame'],
  ['Text', 'text'],
  ['Rectangle', 'rectangle'],
  ['Ellipse', 'ellipse'],
  ['Line', 'line'],
  ['Star', 'star'],
  ['Polygon', 'polygon'],
  ['Vector', 'vector'],
  ['Group', 'group'],
  ['Section', 'section'],
  ['View', 'frame'],
  ['Rect', 'rectangle'],
  ['Component', 'component'],
  ['ComponentSet', 'component-set'],
  ['Instance', 'instance'],
  ['Button', 'button'],
  ['Input', 'input'],
  ['Select', 'select'],
  ['Checkbox', 'checkbox'],
  ['Form', 'form'],
  ['List', 'list'],
  ['Radio', 'radio'],
  ['Textarea', 'textarea'],
  ['DatePicker', 'datepicker'],
  ['Switch', 'switch'],
  ['Icon', 'icon'],
  ['__frag', '']
])

const PURE_HELPERS = {
  backgroundBlur,
  designVar,
  defineVars,
  dropShadow,
  foregroundBlur,
  innerShadow,
  layerBlur,
  angularGradient,
  diamondGradient,
  gradient,
  linearGradient,
  radialGradient,
  solid
}

const TRANSFORM_OPTIONS = {
  transforms: ['typescript', 'jsx'] as Array<'typescript' | 'jsx'>,
  jsxPragma: '__h',
  jsxFragmentPragma: '__frag',
  production: true
}

function unsafe(reason: string): never {
  throw new TypeError(`Design JSX is unsafe: ${reason}`)
}

function isNode(value: unknown): value is ASTNode {
  return value !== null && typeof value === 'object' && typeof (value as ASTNode).type === 'string'
}

function requireNode(value: unknown, field: string): ASTNode {
  if (!isNode(value)) unsafe(`${field} is malformed`)
  return value
}

function identifierName(node: ASTNode): string {
  if (node.type !== 'Identifier' || typeof node.name !== 'string') {
    return unsafe('identifier is malformed')
  }
  return node.name
}

function literalValue(node: ASTNode): unknown {
  if (node.type !== 'Literal') unsafe('literal is malformed')
  const value = node.value
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return value
  }
  return unsafe('only finite JSON-like literals are allowed')
}

function objectKey(node: ASTNode): string {
  let value: unknown
  if (node.type === 'Identifier') {
    value = identifierName(node)
  } else if (node.type === 'Literal') {
    value = literalValue(node)
  } else {
    return unsafe('object key must be a literal or identifier')
  }
  if (typeof value !== 'string' && typeof value !== 'number') {
    return unsafe('object key must be text or a number')
  }
  const key = String(value)
  if (RESERVED_OBJECT_KEYS.has(key)) unsafe(`reserved object key "${key}" is not allowed`)
  return key
}

function transformedExpression(source: string): string {
  return transform(`return (${source})`, TRANSFORM_OPTIONS).code
}

function transformSafeInput(source: string): string {
  try {
    return transformedExpression(source)
  } catch (expressionError) {
    try {
      return transformedExpression(`<>${source}</>`)
    } catch {
      throw expressionError
    }
  }
}

class SafeExpressionEvaluator {
  #depth = 0

  evaluate(node: ASTNode): unknown {
    this.#depth++
    if (this.#depth > MAX_SAFE_EXPRESSION_DEPTH) unsafe('expression nesting is too deep')
    try {
      switch (node.type) {
        case 'Literal':
          return literalValue(node)
        case 'ArrayExpression':
          return this.#array(node)
        case 'ObjectExpression':
          return this.#object(node)
        case 'UnaryExpression':
          return this.#unary(node)
        case 'CallExpression':
          return this.#call(node)
        case 'MemberExpression':
          return this.#member(node)
        default:
          return unsafe(`expression type ${node.type} is not allowed`)
      }
    } finally {
      this.#depth--
    }
  }

  #array(node: ASTNode): unknown[] {
    if (!Array.isArray(node.elements)) unsafe('array is malformed')
    return node.elements.map((element) => {
      if (element === null) return unsafe('array holes are not allowed')
      const child = requireNode(element, 'array element')
      if (child.type === 'SpreadElement') return unsafe('array spreads are not allowed')
      return this.evaluate(child)
    })
  }

  #object(node: ASTNode): SafeEvaluatedObject {
    if (!Array.isArray(node.properties)) unsafe('object is malformed')
    const result = Object.create(null) as SafeEvaluatedObject
    for (const rawProperty of node.properties) {
      const property = requireNode(rawProperty, 'object property')
      if (
        property.type !== 'Property' ||
        property.kind !== 'init' ||
        property.method === true ||
        property.computed === true ||
        property.shorthand === true
      ) {
        unsafe('only plain object fields are allowed')
      }
      const key = objectKey(requireNode(property.key, 'object key'))
      if (Object.hasOwn(result, key)) unsafe(`duplicate object key "${key}" is not allowed`)
      result[key] = this.evaluate(requireNode(property.value, 'object value'))
    }
    return result
  }

  #unary(node: ASTNode): number {
    if (node.operator !== '-' && node.operator !== '+') {
      return unsafe(`unary operator ${String(node.operator)} is not allowed`)
    }
    const value = this.evaluate(requireNode(node.argument, 'unary argument'))
    if (typeof value !== 'number') unsafe('unary signs require a numeric literal')
    const result = node.operator === '-' ? -value : value
    if (!Number.isFinite(result)) unsafe('number must be finite')
    return result
  }

  #call(node: ASTNode): unknown {
    if (node.optional === true) unsafe('optional calls are not allowed')
    const callee = requireNode(node.callee, 'call target')
    if (callee.type !== 'Identifier') unsafe('only approved helper calls are allowed')
    if (!Array.isArray(node.arguments)) unsafe('call arguments are malformed')
    const name = identifierName(callee)
    if (name === '__h') return this.#createElement(node.arguments)

    if (!Object.hasOwn(PURE_HELPERS, name)) {
      return unsafe(`call to ${name} is not allowed`)
    }
    const args = node.arguments.map((argument) => {
      const value = requireNode(argument, 'helper argument')
      if (value.type === 'SpreadElement') unsafe('argument spreads are not allowed')
      return this.evaluate(value)
    })
    const helper = PURE_HELPERS[name as keyof typeof PURE_HELPERS] as (
      ...values: unknown[]
    ) => unknown
    return helper(...args)
  }

  #createElement(rawArguments: unknown[]): React.ReactElement {
    if (rawArguments.length < 2) unsafe('JSX element is malformed')
    const tagNode = requireNode(rawArguments[0], 'JSX tag')
    let tagName: string
    if (tagNode.type === 'Literal') {
      const value = literalValue(tagNode)
      if (typeof value !== 'string') unsafe('JSX tag must be text')
      tagName = value
    } else if (tagNode.type === 'Identifier') {
      const alias = TAG_ALIASES.get(identifierName(tagNode))
      if (alias === undefined) unsafe(`JSX tag ${identifierName(tagNode)} is not allowed`)
      tagName = alias
    } else {
      return unsafe('dynamic JSX tags are not allowed')
    }

    const propsNode = requireNode(rawArguments[1], 'JSX props')
    const rawProps = this.evaluate(propsNode)
    if (rawProps !== null && (typeof rawProps !== 'object' || Array.isArray(rawProps))) {
      unsafe('JSX props must be a plain object')
    }
    const props = rawProps as SafeEvaluatedObject | null
    const children = rawArguments.slice(2).map((argument) => {
      const child = requireNode(argument, 'JSX child')
      if (child.type === 'SpreadElement') unsafe('JSX child spreads are not allowed')
      return this.evaluate(child) as React.ReactNode
    })
    return React.createElement(tagName, props, ...children)
  }

  #member(node: ASTNode): unknown {
    if (node.optional === true) unsafe('optional member access is not allowed')
    const ownerNode = requireNode(node.object, 'member owner')
    if (
      ownerNode.type !== 'CallExpression' ||
      identifierName(requireNode(ownerNode.callee, 'member call target')) !== 'defineVars'
    ) {
      return unsafe('member access is only allowed on defineVars(...)')
    }

    const propertyNode = requireNode(node.property, 'member property')
    const key = node.computed === true ? objectKey(propertyNode) : identifierName(propertyNode)
    if (RESERVED_OBJECT_KEYS.has(key)) unsafe(`reserved member "${key}" is not allowed`)
    const owner = this.#call(ownerNode)
    if (owner === null || typeof owner !== 'object' || !Object.hasOwn(owner, key)) {
      return unsafe(`defineVars(...) has no own member "${key}"`)
    }
    return (owner as SafeEvaluatedObject)[key]
  }
}

export function parseSafeDesignJSX(source: string): unknown {
  const code = transformSafeInput(source)
  const program = parse(code, {
    allowReturnOutsideFunction: true,
    ecmaVersion: 'latest',
    sourceType: 'script'
  })
  if (program.body.length !== 1 || program.body[0]?.type !== 'ReturnStatement') {
    return unsafe('input must contain one JSX expression')
  }
  const argument = (program.body[0] as ASTNode).argument
  return new SafeExpressionEvaluator().evaluate(requireNode(argument, 'return value'))
}
