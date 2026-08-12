import { transform } from 'sucrase'

import type { SceneGraph } from '@open-pencil/scene-graph'

import { throwIfAborted, yieldToHost } from '#core/async-work'
import type { RenderOptions as RenderJSXOptions } from '#core/design-jsx/types'

import { backgroundBlur, dropShadow, foregroundBlur, innerShadow, layerBlur } from './effects'
import { LOWCODE_SUPPORTED_PROP_NAMES } from './lowcode'
import * as React from './mini-react'
import {
  angularGradient,
  diamondGradient,
  gradient,
  linearGradient,
  radialGradient,
  solid
} from './paints'
import { renderTree, type RenderResult, validateTreeForRenderAsync } from './renderer'
import { isTreeNode, resolveToTreeAsync, type TreeNode } from './tree'

const JSX_RENDER_ABORT_MESSAGE = 'JSX render cancelled'

/**
 * Build a component function from a JSX string using sucrase.
 * Works in both Node/Bun and the browser (no native bindings).
 */
const SUPPORTED_PROPS = new Set([
  'name',
  'key',
  'flex',
  'flow',
  'dir',
  'gap',
  'wrap',
  'rowGap',
  'columnGap',
  'justify',
  'justifyContent',
  'items',
  'align',
  'alignItems',
  'grow',
  'w',
  'h',
  'width',
  'height',
  'minW',
  'maxW',
  'minH',
  'maxH',
  'x',
  'y',
  'top',
  'left',
  'position',
  'p',
  'padding',
  'px',
  'py',
  'pt',
  'pr',
  'pb',
  'pl',
  'bg',
  'fill',
  'fills',
  'background',
  'backgroundColor',
  'stroke',
  'border',
  'borderColor',
  'strokeWidth',
  'borderWidth',
  'strokeAlign',
  'strokeDash',
  'rounded',
  'borderRadius',
  'roundedTL',
  'roundedTR',
  'roundedBL',
  'roundedBR',
  'cornerRadius',
  'cornerSmoothing',
  'opacity',
  'blendMode',
  'rotate',
  'rotation',
  'overflow',
  'shadow',
  'blur',
  'effects',
  'size',
  'fontSize',
  'font',
  'fontFamily',
  'weight',
  'fontWeight',
  'color',
  'text',
  'characters',
  'content',
  'value',
  'title',
  'textAlign',
  'textAlignHorizontal',
  'textHorizontalAlignment',
  'textAlignVertical',
  'textVerticalAlignment',
  'textAutoResize',
  'lineHeight',
  'letterSpacing',
  'textDecoration',
  'textCase',
  'maxLines',
  'truncate',
  'grid',
  'columns',
  'rows',
  'colStart',
  'rowStart',
  'col',
  'row',
  'colSpan',
  'rowSpan',
  'points',
  'pointCount',
  'innerRadius',
  'label',
  'style',
  'bind',
  'component',
  'componentId',
  'of',
  ...LOWCODE_SUPPORTED_PROP_NAMES
])

function stripHTMLComments(jsxString: string): string {
  return jsxString.replace(/<!--[\s\S]*?-->/g, '')
}

const SVG_ROOT_PROPS = new Set([...SUPPORTED_PROPS, 'viewBox', 'body'])

async function unsupportedPropWarnings(tree: TreeNode, signal?: AbortSignal): Promise<string[]> {
  const warnings: string[] = []
  const pending = [tree]
  let work = 0

  while (pending.length > 0) {
    throwIfAborted(signal, JSX_RENDER_ABORT_MESSAGE)
    const current = pending.pop()
    if (!current) continue
    const supportedProps = current.type === 'svg' ? SVG_ROOT_PROPS : SUPPORTED_PROPS
    for (const key of Object.keys(current.props)) {
      if (!supportedProps.has(key)) {
        warnings.push(`Unsupported prop "${key}" on <${current.type}> is ignored.`)
      }
    }

    // SVG descendants are parsed as markup by renderSVGNode rather than as
    // Design JSX nodes. Only the SVG root participates in prop diagnostics.
    if (current.type !== 'svg') {
      for (let index = current.children.length - 1; index >= 0; index--) {
        const child = current.children[index]
        if (isTreeNode(child)) pending.push(child)
      }
    }
    if (++work % 32 === 0) await yieldToHost(signal, JSX_RENDER_ABORT_MESSAGE)
  }
  throwIfAborted(signal, JSX_RENDER_ABORT_MESSAGE)
  return warnings
}

export function buildComponent(jsxString: string): React.ComponentType {
  const trimmed = stripHTMLComments(jsxString).trim()

  const aliases = `
    const __h = React.createElement
    const __frag = ''
    const Frame = 'frame', Text = 'text', Rectangle = 'rectangle', Ellipse = 'ellipse'
    const Line = 'line', Star = 'star', Polygon = 'polygon', Vector = 'vector'
    const Group = 'group', Section = 'section', View = 'frame', Rect = 'rectangle'
    const Component = 'component', ComponentSet = 'component-set', Instance = 'instance'
    const Button = 'button', Input = 'input', Select = 'select', Checkbox = 'checkbox'
    const Form = 'form', List = 'list', Radio = 'radio', Textarea = 'textarea'
    const DatePicker = 'datepicker', Switch = 'switch'
    const Icon = 'icon'
    const svg = 'svg'
    const dropShadow = __helpers.dropShadow
    const innerShadow = __helpers.innerShadow
    const layerBlur = __helpers.layerBlur
    const backgroundBlur = __helpers.backgroundBlur
    const foregroundBlur = __helpers.foregroundBlur
    const solid = __helpers.solid
    const gradient = __helpers.gradient
    const linearGradient = __helpers.linearGradient
    const radialGradient = __helpers.radialGradient
    const angularGradient = __helpers.angularGradient
    const diamondGradient = __helpers.diamondGradient
    const __varSymbol = Symbol.for('open-pencil.variable')
    const designVar = (def, value) => typeof def === 'string'
      ? ({ [__varSymbol]: true, id: def, name: def, value })
      : ({ [__varSymbol]: true, id: def.id, name: def.name ?? def.id ?? '', value: def.value })
    const defineVars = (vars) => Object.fromEntries(
      Object.entries(vars).map(([key, def]) => [key, designVar(def)])
    )
  `
  const opts = {
    transforms: ['typescript', 'jsx'] as Array<'typescript' | 'jsx'>,
    jsxPragma: '__h',
    jsxFragmentPragma: '__frag',
    production: true
  }

  let code: string
  try {
    code = transform(`${aliases}\nreturn function __render() { return ${trimmed} }`, opts).code
  } catch {
    code = transform(`${aliases}\nreturn function __render() { return <>${trimmed}</> }`, opts).code
  }

  // eslint-disable-next-line typescript-eslint/no-implied-eval -- sucrase output must be evaluated at runtime
  return new Function('React', '__helpers', code)(React, {
    backgroundBlur,
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
  }) as React.ComponentType
}

/**
 * Render a JSX string into the scene graph.
 * Works in both Node/Bun and the browser.
 */
export async function renderJSX(
  graph: SceneGraph,
  jsxString: string,
  options?: RenderJSXOptions
): Promise<RenderResult[]> {
  throwIfAborted(options?.signal, JSX_RENDER_ABORT_MESSAGE)
  const Component = buildComponent(jsxString)
  throwIfAborted(options?.signal, JSX_RENDER_ABORT_MESSAGE)
  const element = React.createElement(Component, null)
  throwIfAborted(options?.signal, JSX_RENDER_ABORT_MESSAGE)
  const tree = await resolveToTreeAsync(element, { signal: options?.signal })
  throwIfAborted(options?.signal, JSX_RENDER_ABORT_MESSAGE)

  if (!tree) {
    throw new Error('JSX must return a Figma element (Frame, Text, etc)')
  }

  // Preflight the complete resolved tree before rendering fragment roots one
  // by one, so a later invalid lowcode control cannot leave earlier siblings.
  await validateTreeForRenderAsync(tree, options?.signal)
  throwIfAborted(options?.signal, JSX_RENDER_ABORT_MESSAGE)

  const warnings = await unsupportedPropWarnings(tree, options?.signal)
  throwIfAborted(options?.signal, JSX_RENDER_ABORT_MESSAGE)

  if (tree.type === '' && tree.children.length > 0) {
    return renderFragment(graph, tree, warnings, options)
  }

  const result = await renderTree(graph, tree, options)
  if (warnings.length > 0) result.warnings = [...(result.warnings ?? []), ...warnings]
  return [result]
}

async function renderFragment(
  graph: SceneGraph,
  tree: TreeNode,
  warnings: string[],
  options?: RenderJSXOptions
): Promise<RenderResult[]> {
  const results: RenderResult[] = []
  const roots = tree.children.filter(isTreeNode)
  try {
    for (const [index, child] of roots.entries()) {
      throwIfAborted(options?.signal, JSX_RENDER_ABORT_MESSAGE)
      results.push(
        await renderTree(graph, child, {
          ...options,
          layout: options?.layout !== false && index === roots.length - 1
        })
      )
    }
  } catch (error) {
    for (const result of results.toReversed()) graph.deleteNode(result.id)
    throw error
  }
  if (results.length === 0) {
    throw new Error('JSX must return a Figma element (Frame, Text, etc)')
  }
  if (warnings.length > 0) {
    results[0].warnings = [...(results[0].warnings ?? []), ...warnings]
  }
  return results
}

export { renderTree as renderTreeNode }
