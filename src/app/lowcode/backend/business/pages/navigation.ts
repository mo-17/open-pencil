import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'
import type { Rect } from '@open-pencil/scene-graph/primitives'

import type { BusinessTemplateEditor } from '../types'
import { businessLabel } from '../types'
import { createBusinessLayout } from './layout'
import { businessMarkerData, readBusinessPageMarker } from './markers'
import type { BusinessNavigationEntry } from './module-types'
import { updateBusinessNavigationNode } from './navigation-history'

export interface BusinessNavigationAddition {
  readonly pageId: string
  readonly containerId?: string
  readonly entries: readonly BusinessNavigationEntry[]
  readonly knownKeys: readonly string[]
  readonly rect: Readonly<Rect>
  readonly startY: number
  readonly columns: number
}

function descendants(graph: SceneGraph, id: string): SceneNode[] {
  return graph.getChildren(id).flatMap((child) => [child, ...descendants(graph, child.id)])
}

function overlaps(left: Rect, right: Rect): boolean {
  return (
    left.x < right.x + right.width + 8 &&
    left.x + left.width + 8 > right.x &&
    left.y < right.y + right.height + 8 &&
    left.y + left.height + 8 > right.y
  )
}

function appendFits(
  graph: SceneGraph,
  page: SceneNode,
  container: SceneNode,
  rectangle: Rect
): boolean {
  const excluded = new Set(descendants(graph, container.id).map((node) => node.id))
  let parent: SceneNode | undefined = container
  while (parent) {
    excluded.add(parent.id)
    parent = parent.parentId ? graph.getNode(parent.parentId) : undefined
  }
  return descendants(graph, page.id).every(
    (node) => excluded.has(node.id) || !overlaps(rectangle, graph.getAbsoluteBounds(node.id))
  )
}

function markedAddition(
  graph: SceneGraph,
  page: SceneNode,
  applicationId: string,
  navigation: readonly BusinessNavigationEntry[]
): BusinessNavigationAddition | undefined {
  const candidates = descendants(graph, page.id)
    .flatMap((node) => {
      const marker = readBusinessPageMarker(node)
      return marker?.role === 'navigation' &&
        marker.applicationId === applicationId &&
        node.type === 'FRAME'
        ? [{ node, marker }]
        : []
    })
    .sort((left, right) => right.marker.knownKeys.length - left.marker.knownKeys.length)
  const candidate = candidates.at(0)
  if (!candidate) return undefined
  const { node, marker } = candidate
  const entries = navigation.filter((entry) => !marker.knownKeys.includes(entry.key))
  const columns = node.width >= 600 ? 3 : 1
  const startY =
    Math.max(0, ...graph.getChildren(node.id).map((child) => child.y + child.height)) + 12
  const height = startY + Math.ceil(entries.length / columns) * 56
  const absolute = graph.getAbsoluteBounds(node.id)
  if (
    entries.length &&
    !appendFits(graph, page, node, {
      x: absolute.x,
      y: absolute.y + startY,
      width: node.width,
      height: height - startY
    })
  )
    return undefined
  return {
    pageId: page.id,
    containerId: node.id,
    entries,
    knownKeys: [...marker.knownKeys, ...entries.map((entry) => entry.key)],
    rect: { x: node.x, y: node.y, width: node.width, height: Math.max(node.height, height) },
    startY,
    columns
  }
}

export function prepareBusinessNavigation(
  graph: SceneGraph,
  pageIds: readonly string[],
  applicationId: string,
  navigation: readonly BusinessNavigationEntry[]
): BusinessNavigationAddition[] {
  return [...new Set(pageIds)].map((pageId) => {
    const page = graph.getNode(pageId)
    if (page?.type !== 'CANVAS') throw new Error('The existing application page is unavailable.')
    const marked = markedAddition(graph, page, applicationId, navigation)
    if (marked) return marked
    const pageBounds = graph.getAbsoluteBounds(page.id)
    const bottom = Math.max(
      page.height,
      ...descendants(graph, page.id).map((node) => {
        const rect = graph.getAbsoluteBounds(node.id)
        return rect.y + rect.height - pageBounds.y
      })
    )
    const width = Math.max(120, page.width - 48)
    const columns = width >= 600 ? 3 : 1
    return {
      pageId,
      entries: navigation,
      knownKeys: navigation.map((entry) => entry.key),
      rect: {
        x: 24,
        y: bottom + 32,
        width,
        height: 60 + Math.ceil(navigation.length / columns) * 56
      },
      startY: 60,
      columns
    }
  })
}

/** Append only new links or an isolated footer; never rewrite an existing authored node. */
export function renderBusinessNavigation(
  editor: BusinessTemplateEditor,
  applicationId: string,
  additions: readonly BusinessNavigationAddition[],
  locale: string
): string[] {
  const layout = createBusinessLayout(editor)
  const touched: string[] = []
  for (const addition of additions) {
    if (!addition.entries.length) continue
    const page = editor.graph.getNode(addition.pageId)
    if (!page) throw new Error('The existing application page is unavailable.')
    const container =
      addition.containerId ??
      layout.shape(
        'FRAME',
        'Business module navigation',
        page.id,
        addition.rect.x,
        addition.rect.y,
        addition.rect.width,
        addition.rect.height
      )
    if (!addition.containerId)
      layout.text(
        container,
        locale.toLowerCase().startsWith('zh') ? '更多业务模块' : 'More business modules',
        { x: 0, y: 0, width: addition.rect.width, height: 36 },
        { fontSize: 20 }
      )
    const width = (addition.rect.width - (addition.columns - 1) * 16) / addition.columns
    for (const [index, entry] of addition.entries.entries())
      layout.button(
        container,
        businessLabel(entry.label, locale),
        {
          x: (index % addition.columns) * (width + 16),
          y: addition.startY + Math.floor(index / addition.columns) * 56,
          width,
          height: 44
        },
        [{ id: crypto.randomUUID(), kind: 'navigate', to: entry.path }]
      )
    const node = editor.graph.getNode(container)
    if (!node) throw new Error('The module navigation could not be created.')
    updateBusinessNavigationNode(
      editor,
      container,
      {
        height: addition.rect.height,
        pluginData: businessMarkerData(
          { version: 1, role: 'navigation', applicationId, knownKeys: addition.knownKeys },
          node.pluginData
        )
      },
      'Append business navigation'
    )
    const bounds = editor.graph.getAbsoluteBounds(container)
    const pageBounds = editor.graph.getAbsoluteBounds(page.id)
    const height = Math.max(page.height, bounds.y + addition.rect.height - pageBounds.y + 24)
    if (height !== page.height)
      updateBusinessNavigationNode(editor, page.id, { height }, 'Fit appended business navigation')
    touched.push(page.id)
  }
  return touched
}
