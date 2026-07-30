import type { Effect, Fill } from '@open-pencil/scene-graph'
import type { Color } from '@open-pencil/scene-graph/primitives'

import { throwIfAborted, yieldToHost, type CooperativeExecution } from '#core/async-work'

import type { DesignVariable } from './vars'

const JSX_RENDER_ABORT_MESSAGE = 'JSX render cancelled'

export interface TreeNode {
  type: string
  props: Record<string, unknown>
  children: (TreeNode | string)[]
}

export function isTreeNode(x: unknown): x is TreeNode {
  if (x === null || typeof x !== 'object') return false
  return (
    'type' in x &&
    typeof x.type === 'string' &&
    'props' in x &&
    'children' in x &&
    Array.isArray(x.children)
  )
}

type FunctionComponent = (props: Record<string, unknown>) => unknown

interface ReactElement {
  type: unknown
  props: Record<string, unknown>
}

function isReactElement(x: unknown): x is ReactElement {
  return x !== null && typeof x === 'object' && 'type' in x && 'props' in x
}

/**
 * Resolve any element-like value (ReactElement, TreeNode, function component)
 * into a TreeNode. Handles recursive function components up to depth 100.
 */
export function resolveToTree(element: unknown, depth = 0): TreeNode | null {
  if (depth > 100) throw new Error('Component resolution depth exceeded')
  if (element == null) return null
  if (isTreeNode(element)) return element
  if (!isReactElement(element)) return null

  if (typeof element.type === 'function') {
    const component = element.type as FunctionComponent
    return resolveToTree(component(element.props), depth + 1)
  }

  if (typeof element.type === 'string') {
    const children: (TreeNode | string)[] = []
    const elChildren = element.props.children
    if (elChildren != null) {
      const childArray = Array.isArray(elChildren) ? elChildren : [elChildren]
      for (const child of childArray.flat()) {
        if (child == null) continue
        if (typeof child === 'string' || typeof child === 'number') {
          children.push(String(child))
        } else {
          const resolved = resolveToTree(child, depth + 1)
          if (resolved) children.push(resolved)
        }
      }
    }
    const { children: _, ...props } = element.props
    return { type: element.type, props, children }
  }

  return null
}

export interface ResolveTreeOptions {
  signal?: AbortSignal
  /** Number of resolved values between browser task yields. */
  yieldEvery?: number
}

/**
 * Cooperative counterpart to `resolveToTree` for untrusted/generated JSX.
 * The synchronous API remains available for callers that already own a small
 * tree, while AI/automation render paths can yield as component output is
 * expanded and flattened.
 */
export async function resolveToTreeAsync(
  element: unknown,
  options: ResolveTreeOptions = {}
): Promise<TreeNode | null> {
  const execution: CooperativeExecution = {
    signal: options.signal,
    yieldEvery: Math.max(1, options.yieldEvery ?? 32),
    workSinceYield: 0
  }
  const tree = await resolveToTreeCooperatively(element, 0, execution)
  throwIfAborted(execution.signal, JSX_RENDER_ABORT_MESSAGE)
  return tree
}

async function resolveToTreeCooperatively(
  element: unknown,
  depth: number,
  execution: CooperativeExecution
): Promise<TreeNode | null> {
  if (depth > 100) throw new Error('Component resolution depth exceeded')
  await checkpointResolution(execution)
  if (element == null) return null
  if (isTreeNode(element)) return element
  if (!isReactElement(element)) return null

  if (typeof element.type === 'function') {
    const component = element.type as FunctionComponent
    const rendered = component(element.props)
    throwIfAborted(execution.signal, JSX_RENDER_ABORT_MESSAGE)
    return resolveToTreeCooperatively(rendered, depth + 1, execution)
  }

  if (typeof element.type !== 'string') return null

  const children: (TreeNode | string)[] = []
  const pending = element.props.children == null ? [] : [element.props.children]
  while (pending.length > 0) {
    await checkpointResolution(execution)
    const child = pending.pop()
    if (Array.isArray(child)) {
      for (let index = child.length - 1; index >= 0; index--) pending.push(child[index])
      continue
    }
    if (child == null) continue
    if (typeof child === 'string' || typeof child === 'number') {
      children.push(String(child))
      continue
    }
    const resolved = await resolveToTreeCooperatively(child, depth + 1, execution)
    if (resolved) children.push(resolved)
  }

  const { children: _, ...props } = element.props
  return { type: element.type, props, children }
}

async function checkpointResolution(execution: CooperativeExecution): Promise<void> {
  throwIfAborted(execution.signal, JSX_RENDER_ABORT_MESSAGE)
  execution.workSinceYield++
  if (execution.workSinceYield < execution.yieldEvery) return
  execution.workSinceYield = 0
  await yieldToHost(execution.signal, JSX_RENDER_ABORT_MESSAGE)
}

function resolveChild(child: unknown): TreeNode | string | null {
  if (child == null) return null
  if (typeof child === 'string' || typeof child === 'number') return String(child)
  return resolveToTree(child)
}

export function node(
  type: string,
  props: { children?: unknown; [key: string]: unknown }
): TreeNode {
  const { children, ...rest } = props
  const processed = [children]
    .flat(Infinity)
    .map(resolveChild)
    .filter((c): c is TreeNode | string => c !== null)
  return { type, props: rest, children: processed }
}

export type PaintProp = string | Color | Fill | DesignVariable

export type StyleProps = {
  flex?: 'row' | 'col' | 'column'
  flow?: 'auto' | 'ltr' | 'rtl'
  dir?: 'auto' | 'ltr' | 'rtl'
  gap?: number
  wrap?: boolean
  rowGap?: number
  justify?: 'start' | 'end' | 'center' | 'between'
  justifyContent?: 'start' | 'end' | 'center' | 'between'
  items?: 'start' | 'end' | 'center' | 'stretch'
  align?: 'start' | 'end' | 'center' | 'stretch'
  alignItems?: 'start' | 'end' | 'center' | 'stretch'
  grow?: number

  w?: number | 'fill' | 'hug'
  h?: number | 'fill' | 'hug'
  minW?: number
  maxW?: number
  minH?: number
  maxH?: number

  x?: number
  y?: number

  p?: number
  px?: number
  py?: number
  pt?: number
  pr?: number
  pb?: number
  pl?: number

  bg?: PaintProp
  fill?: PaintProp
  fills?: PaintProp[]
  stroke?: PaintProp
  strokeWidth?: number
  strokeAlign?: 'inside' | 'outside' | 'center'
  strokeDash?: number[] | boolean
  rounded?: number
  roundedTL?: number
  roundedTR?: number
  roundedBL?: number
  roundedBR?: number
  cornerSmoothing?: number
  opacity?: number
  blendMode?: string
  mask?: boolean | 'alpha' | 'luminance' | 'vector'
  rotate?: number
  rotation?: number
  overflow?: 'hidden' | 'visible'
  shadow?: string
  blur?: number
  effects?: Effect[]

  size?: number
  fontSize?: number
  font?: string
  fontFamily?: string
  weight?: number | 'bold' | 'medium' | 'normal'
  fontWeight?: number | 'bold' | 'medium' | 'normal'
  color?: PaintProp
  text?: string
  characters?: string
  textAlign?: 'left' | 'center' | 'right' | 'justified'
  textAlignHorizontal?: 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED'
  textHorizontalAlignment?: 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED'
  textAlignVertical?: 'TOP' | 'CENTER' | 'BOTTOM'
  textVerticalAlignment?: 'TOP' | 'CENTER' | 'BOTTOM'
  textAutoResize?: 'none' | 'width' | 'height'
}

export type BaseProps = StyleProps & {
  name?: string
  key?: string | number
  children?: unknown
  bind?: Record<string, unknown>
  [key: string]: unknown
}

export type TextProps = BaseProps
