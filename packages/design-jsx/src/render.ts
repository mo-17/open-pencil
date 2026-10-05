import { uniq } from 'es-toolkit/array'

import type { SceneGraph } from '@open-pencil/scene-graph'

import { throwIfAborted, yieldToHost } from './async-work'
import * as React from './mini-react'
import { renderRoots, renderTree, type RenderResult } from './renderer'
import { parseSafeDesignJSX } from './safe-render'
import { DESIGN_JSX_SUPPORTED_PROPERTIES } from './schema'
import type { DesignJSXServices } from './services'
import { isTreeNode, resolveToTreeAsync, type TreeNode } from './tree'
import type { RenderOptions as RenderJSXOptions } from './types'

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

export function buildComponent(jsxString: string, warnings: string[] = []): React.ComponentType {
  const trimmed = stripHTMLComments(jsxString).trim()
  const value = parseSafeDesignJSX(trimmed, warnings)
  return () => value as React.ReactNode
}

/**
 * Render a JSX string into the scene graph.
 * Works in both Node/Bun and the browser.
 */
async function renderJSX<Artwork>(
  services: DesignJSXServices<Artwork>,
  graph: SceneGraph,
  jsxString: string,
  options?: RenderJSXOptions
): Promise<RenderResult[]> {
  throwIfAborted(options?.signal, JSX_RENDER_ABORT_MESSAGE)
  const helperWarnings: string[] = []
  const Component = buildComponent(jsxString, helperWarnings)
  throwIfAborted(options?.signal, JSX_RENDER_ABORT_MESSAGE)
  const element = React.createElement(Component, null)
  throwIfAborted(options?.signal, JSX_RENDER_ABORT_MESSAGE)
  const tree = await resolveToTreeAsync(element, { signal: options?.signal })
  throwIfAborted(options?.signal, JSX_RENDER_ABORT_MESSAGE)

  if (!tree) {
    throw new Error('JSX must return a Figma element (Frame, Text, etc)')
  }

  const warnings = uniq([
    ...helperWarnings,
    ...(await unsupportedPropWarnings(tree, options?.signal))
  ])
  const results = await renderRoots(services, graph, tree, options)
  if (warnings.length) results[0].warnings = uniq([...(results[0].warnings ?? []), ...warnings])
  return results
}

/**
 * A Design JSX renderer bound to an engine. Rendering needs `services` for icons, inline
 * SVG, and layout; OpenPencil's engine provides them through `@open-pencil/core/design-jsx`.
 */
export function createDesignJSXRenderer<Artwork>(services: DesignJSXServices<Artwork>) {
  return {
    /** Render a Design JSX string into the graph, one result per top-level element. */
    renderJSX: (graph: SceneGraph, jsxString: string, options?: RenderJSXOptions) =>
      renderJSX(services, graph, jsxString, options),
    /** Render a tree built with the element functions into the graph. */
    renderTree: (graph: SceneGraph, tree: TreeNode, options?: RenderJSXOptions) =>
      renderTree(services, graph, tree, options)
  }
}

export type DesignJSXRenderer = ReturnType<typeof createDesignJSXRenderer>
