import type { SceneGraph } from '@open-pencil/scene-graph'

import { throwIfAborted, yieldToHost } from '#core/async-work'
import { DESIGN_JSX_SUPPORTED_PROPERTIES } from '#core/design-jsx/schema'
import type { RenderOptions as RenderJSXOptions } from '#core/design-jsx/types'

import * as React from './mini-react'
import { renderTree, type RenderResult, validateTreeForRenderAsync } from './renderer'
import { parseSafeDesignJSX } from './safe-render'
import { isTreeNode, resolveToTreeAsync, type TreeNode } from './tree'

const JSX_RENDER_ABORT_MESSAGE = 'JSX render cancelled'

/** Build a component from the declarative Design JSX subset. */
const SUPPORTED_PROPS = DESIGN_JSX_SUPPORTED_PROPERTIES

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
  const value = parseSafeDesignJSX(trimmed)
  return () => value as React.ReactNode
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
