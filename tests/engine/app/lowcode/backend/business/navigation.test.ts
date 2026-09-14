import { describe, expect, test } from 'bun:test'

import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { prepareBusinessModuleInstallation } from '@/app/lowcode/backend/business/installation'
import {
  BUSINESS_PAGE_PLUGIN_ID,
  readBusinessPageMarker
} from '@/app/lowcode/backend/business/pages/markers'
import {
  prepareBusinessNavigation,
  renderBusinessNavigation
} from '@/app/lowcode/backend/business/pages/navigation'

import { moduleInstallationFixture } from './installation/helpers'

function descendants(graph: SceneGraph, id: string): SceneNode[] {
  return graph.getChildren(id).flatMap((node) => [node, ...descendants(graph, node.id)])
}

function navigationFrame(graph: SceneGraph, pageId: string): SceneNode {
  const node = descendants(graph, pageId).find(
    (entry) => readBusinessPageMarker(entry)?.role === 'navigation'
  )
  if (!node) throw new Error('Missing owned navigation marker')
  return node
}

describe('business module navigation', () => {
  test('preserves edited and deleted existing links and appends only the newly installed module', async () => {
    const value = await moduleInstallationFixture()
    const pageId = value.pages.pageIds.find(
      (id) => value.editor.graph.getNode(id)?.lowcodeRoutePattern === value.pages.paths.customers
    )
    if (!pageId) throw new Error('Missing CRM entry')
    const graph = value.editor.graph
    const navigation = navigationFrame(graph, pageId)
    const [deleted, edited] = graph.getChildren(navigation.id)
    graph.deleteNode(deleted.id)
    graph.updateNode(edited.id, {
      name: 'My customer shortcut',
      x: 5,
      y: 65,
      interactiveProps: { text: 'My clients' }
    })
    const original = structuredClone(edited)
    const prepared = prepareBusinessModuleInstallation({ ...value, kind: 'service-desk' })
    expect(prepared.review.status).toBe('ready')
    prepared.apply()
    expect(graph.getNode(edited.id)).toEqual(original)
    expect(graph.getNode(deleted.id)).toBeUndefined()
    const links = graph.getChildren(navigation.id)
    expect(links).toHaveLength(3)
    expect(
      links.filter((node) =>
        node.events?.onClick?.some(
          (action) => action.kind === 'navigate' && action.to === value.pages.paths.account
        )
      )
    ).toHaveLength(0)
    expect(
      links
        .filter((node) => node.id !== edited.id)
        .every((node) => node.events?.onClick?.every((action) => action.kind === 'navigate'))
    ).toBe(true)
  })

  test('isolates legacy navigation outside existing content and restores exact source metadata over repeated undo/redo', async () => {
    const value = await moduleInstallationFixture()
    const graph = value.editor.graph
    const pageId = value.pages.pageIds[0]
    for (const node of [graph.getNode(pageId), ...descendants(graph, pageId)]) {
      if (node)
        graph.updateNode(node.id, {
          pluginData: node.pluginData.filter((entry) => entry.pluginId !== BUSINESS_PAGE_PLUGIN_ID)
        })
    }
    const custom = graph.createNode('TEXT', pageId, {
      name: 'Custom footer',
      x: 40,
      y: 2000,
      width: 400,
      height: 100,
      text: 'Keep this design'
    })
    const before = value.editor.snapshotDocument()
    const original = structuredClone(custom)
    const prepared = prepareBusinessModuleInstallation({ ...value, kind: 'service-desk' })
    expect(prepared.review.status).toBe('ready')
    prepared.apply()
    const appended = navigationFrame(graph, pageId)
    expect(appended.y).toBeGreaterThanOrEqual(custom.y + custom.height + 32)
    expect(graph.getNode(custom.id)).toEqual(original)
    const after = value.editor.snapshotDocument()
    for (let repeat = 0; repeat < 2; repeat++) {
      value.editor.undo.undo()
      expect(value.editor.documentSnapshotChanged(before)).toBe(false)
      value.editor.undo.redo()
      expect(value.editor.documentSnapshotChanged(after)).toBe(false)
    }
  })

  test('uses a separate footer when expanding a marked sidebar would overlap authored content', async () => {
    const value = await moduleInstallationFixture()
    const graph = value.editor.graph
    const pageId = value.pages.pageIds[0]
    const navigation = navigationFrame(graph, pageId)
    const bounds = graph.getAbsoluteBounds(navigation.id)
    const pageBounds = graph.getAbsoluteBounds(pageId)
    const custom = graph.createNode('TEXT', pageId, {
      name: 'Sidebar note',
      x: bounds.x - pageBounds.x,
      y: bounds.y - pageBounds.y + navigation.height,
      width: navigation.width,
      height: 150,
      text: 'Keep the sidebar note'
    })
    const originalNavigation = structuredClone(navigation)
    const originalCustom = structuredClone(custom)
    const prepared = prepareBusinessModuleInstallation({ ...value, kind: 'service-desk' })
    prepared.apply()
    expect(graph.getNode(navigation.id)).toEqual(originalNavigation)
    expect(graph.getNode(custom.id)).toEqual(originalCustom)
    expect(
      descendants(graph, pageId).filter(
        (node) => readBusinessPageMarker(node)?.role === 'navigation'
      )
    ).toHaveLength(2)
  })

  test('does not trust marker extra fields and never imports actions from them', async () => {
    const value = await moduleInstallationFixture()
    const graph = value.editor.graph
    const pageId = value.pages.pageIds[0]
    const navigation = navigationFrame(graph, pageId)
    const marker = readBusinessPageMarker(navigation)
    graph.updateNode(navigation.id, {
      pluginData: [
        {
          pluginId: BUSINESS_PAGE_PLUGIN_ID,
          key: 'navigation/v1',
          value: JSON.stringify({
            ...marker,
            actions: [{ kind: 'apiCall', url: 'https://invalid.example.com' }]
          })
        }
      ]
    })
    expect(readBusinessPageMarker(navigation)).toBeUndefined()
    const additions = prepareBusinessNavigation(graph, [pageId], value.application.applicationId, [
      { key: '/new', label: { en: 'New module', zh: '新模块' }, path: '/new' }
    ])
    expect(additions[0].containerId).toBeUndefined()
    value.editor.undo.runBatch('Owned navigation test', () =>
      renderBusinessNavigation(value.editor, value.application.applicationId, additions, 'en')
    )
    const appended = navigationFrame(graph, pageId)
    const actions = graph.getChildren(appended.id).flatMap((node) => node.events?.onClick ?? [])
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({ kind: 'navigate', to: '/new' })
  })

  test('maps only the new module directory bindings while preserving existing resource reads', async () => {
    const value = await moduleInstallationFixture()
    const graph = value.editor.graph
    const oldLists = [...graph.getAllNodes()]
      .filter((node) => node.type === 'LIST')
      .map((node) => ({
        id: node.id,
        source: structuredClone(node.interactiveProps?.dataSourceRef)
      }))
    const prepared = prepareBusinessModuleInstallation({ ...value, kind: 'service-desk' })
    const result = prepared.apply()
    for (const old of oldLists)
      expect(graph.getNode(old.id)?.interactiveProps?.dataSourceRef).toEqual(old.source)
    const sources = result.pageIds
      .flatMap((id) => descendants(graph, id))
      .filter((node) => node.type === 'LIST')
      .map((node) => node.interactiveProps?.dataSourceRef)
    expect(
      sources.some(
        (source) => source?.kind === 'backendResource' && source.resourceId === 'service-desk-users'
      )
    ).toBe(true)
    expect(
      sources.some((source) => source?.kind === 'backendResource' && source.resourceId === 'users')
    ).toBe(false)
  })
})
