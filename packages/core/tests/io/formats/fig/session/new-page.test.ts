import { expect, test } from 'bun:test'

import { createFigRecordSession, parseFigBuffer } from '@open-pencil/fig'
import { OPEN_PENCIL_PLUGIN_ID } from '@open-pencil/fig/node-change'
import { initCodec } from '@open-pencil/kiwi/fig/codec'
import type { NodeChange } from '@open-pencil/kiwi/fig/codec'
import { resolveLowcodeApplicationPages } from '@open-pencil/lowcode'
import { SceneGraph, createMotionPreset } from '@open-pencil/scene-graph'

import { createEditor } from '#core/editor'
import { exportFigFile, parseFigFile, populateFigPage } from '#core/io/formats/fig'
import { importNodeChanges } from '#core/kiwi/fig/import'
import { snapshotReaderState, restoreReaderState } from '#core/kiwi/fig/session/document-state'
import { readerSessionOptions } from '#core/kiwi/fig/session/options'

test('new pages in reader-backed graphs are live and never queried from the archive', async () => {
  await initCodec()
  const source = new SceneGraph()
  source.createNode('RECTANGLE', source.getPages()[0].id)
  const graph = await parseFigFile((await exportFigFile(source)).slice().buffer as ArrayBuffer, {
    populate: 'none'
  })
  const page = graph.addPage('New page')
  expect(populateFigPage(graph, page.id)).toBe(false)
  const editor = createEditor({ graph })
  await expect(editor.switchPage(page.id)).resolves.toBeUndefined()
  expect(editor.state.currentPageId).toBe(page.id)
})

function applicationSource(zeroSession = false, enabled = true) {
  let nextId = 1
  const graph = zeroSession
    ? new SceneGraph({ idGenerator: () => `0:${nextId++}` })
    : new SceneGraph()
  const reference = graph.getPages()[0]
  graph.updateNode(reference.id, {
    name: 'Reference',
    lowcodeApplicationPage: { version: 1, role: 'reference' }
  })
  const home = graph.addPage('Home')
  const products = graph.addPage('Products')
  const unrelated = graph.addPage('Unrelated')
  const homeEntry = graph.createNode('FRAME', home.id, {
    name: 'Home entry',
    width: 320,
    height: 240
  })
  const productsEntry = graph.createNode('FRAME', products.id, {
    name: 'Products entry',
    width: 320,
    height: 240
  })
  const shell = graph.createNode('FRAME', reference.id, {
    name: 'Shared shell',
    layoutMode: 'VERTICAL',
    width: 400,
    height: 300
  })
  const slot = graph.createNode('FRAME', shell.id, {
    name: 'Page slot',
    layoutMode: 'VERTICAL',
    width: 320,
    height: 240
  })
  graph.createNode('RECTANGLE', unrelated.id, { name: 'Unrelated lazy content' })
  graph.updateNode(home.id, {
    lowcodeRoutePattern: '/home',
    lowcodeApplicationPage: { version: 1, role: 'application', entryNodeId: homeEntry.id }
  })
  graph.updateNode(products.id, {
    lowcodeRoutePattern: '/products',
    lowcodeApplicationPage: {
      version: 1,
      role: 'application',
      entryNodeId: productsEntry.id,
      enterGuard: { conditionExpr: 'hasAccess', fallback: '/home' },
      leaveConfirm: { dirtyExpr: 'false', message: 'Leave?' }
    }
  })
  graph.updateNode(graph.rootId, {
    lowcodeDocumentState: [
      { id: 'access', name: 'hasAccess', type: 'boolean', defaultValue: true }
    ],
    lowcodeApplication: {
      version: 1,
      enabled,
      startPageId: home.id,
      shell: { frameNodeId: shell.id, slotNodeId: slot.id }
    },
    pluginData: [{ pluginId: 'future-plugin', key: 'policy', value: '{"version":9}' }]
  })
  return graph
}

function named(graph: SceneGraph, name: string) {
  const node = [...graph.getAllNodes()].find((node) => node.name === name)
  if (!node) throw new Error(`Missing ${name}`)
  return node
}

function expectApplicationReferences(graph: SceneGraph, enabled = true) {
  const root = graph.getNode(graph.rootId)
  expect(root?.lowcodeApplication).toEqual({
    version: 1,
    enabled,
    startPageId: named(graph, 'Home').id,
    shell: {
      frameNodeId: named(graph, 'Shared shell').id,
      slotNodeId: named(graph, 'Page slot').id
    }
  })
  expect(named(graph, 'Page slot').parentId).toBe(named(graph, 'Shared shell').id)
  expect(named(graph, 'Home').lowcodeApplicationPage?.entryNodeId).toBe(
    named(graph, 'Home entry').id
  )
  expect(named(graph, 'Products').lowcodeApplicationPage).toEqual({
    version: 1,
    role: 'application',
    entryNodeId: named(graph, 'Products entry').id,
    enterGuard: { conditionExpr: 'hasAccess', fallback: '/home' },
    leaveConfirm: { dirtyExpr: 'false', message: 'Leave?' }
  })
  expect(root?.pluginData).toEqual([
    { pluginId: 'future-plugin', key: 'policy', value: '{"version":9}' }
  ])
  if (enabled) {
    const scope = resolveLowcodeApplicationPages(graph)
    expect(scope.pages).toHaveLength(2)
    expect(scope.warnings).toEqual([])
  }
}

for (const populate of ['none', 'first-page', 'all'] as const) {
  test(`application references are complete without importing unrelated content (${populate})`, async () => {
    await initCodec()
    const bytes = await exportFigFile(applicationSource())
    const graph = await parseFigFile(Uint8Array.from(bytes).buffer, { populate })
    expectApplicationReferences(graph)
    if (populate !== 'all')
      expect([...graph.getAllNodes()].some((node) => node.name === 'Unrelated lazy content')).toBe(
        false
      )
  })
}

test('disabled application metadata survives lazy opening before mode is enabled', async () => {
  await initCodec()
  const graph = await parseFigFile(
    Uint8Array.from(await exportFigFile(applicationSource(false, false))).buffer,
    { populate: 'none' }
  )
  expectApplicationReferences(graph, false)
  const policy = graph.getNode(graph.rootId)?.lowcodeApplication
  if (!policy) throw new Error('Missing disabled application policy')
  graph.updateNode(graph.rootId, { lowcodeApplication: { ...policy, enabled: true } })
  expectApplicationReferences(graph)
})

test('ordinary design files keep unrelated pages lazy with no host metadata', async () => {
  await initCodec()
  const source = new SceneGraph()
  source.createNode('RECTANGLE', source.addPage('Unvisited').id, { name: 'Unvisited content' })
  const graph = await parseFigFile(Uint8Array.from(await exportFigFile(source)).buffer, {
    populate: 'none'
  })
  expect(graph.getPages().every((page) => page.childIds.length === 0)).toBe(true)
  expect(graph.getNode(graph.rootId)?.lowcodeApplication).toBeUndefined()
})

test('source/runtime GUID collisions do not remap application references twice', async () => {
  await initCodec()
  const graph = await parseFigFile(
    Uint8Array.from(await exportFigFile(applicationSource(true))).buffer,
    { populate: 'none' }
  )
  expectApplicationReferences(graph)
  const editor = createEditor({ graph })
  try {
    for (const page of graph.getPages()) {
      await editor.loadPageNodes(page.id)
      expectApplicationReferences(graph)
    }
  } finally {
    editor.dispose()
  }
})

test('later page hydration preserves authored application policies and entry edits', async () => {
  await initCodec()
  const graph = await parseFigFile(
    Uint8Array.from(await exportFigFile(applicationSource(true))).buffer,
    { populate: 'none' }
  )
  const policy = graph.getNode(graph.rootId)?.lowcodeApplication
  const home = named(graph, 'Home')
  const pagePolicy = home.lowcodeApplicationPage
  if (!policy || !pagePolicy) throw new Error('Missing application policies')
  const replacement = graph.createNode('FRAME', home.id, {
    name: 'Authored replacement',
    width: 200,
    height: 100
  })
  const editedRoot = { ...policy, enabled: false, startPageId: named(graph, 'Products').id }
  const editedPage = { ...pagePolicy, entryNodeId: replacement.id }
  graph.updateNode(graph.rootId, { lowcodeApplication: editedRoot })
  graph.updateNode(home.id, { lowcodeApplicationPage: editedPage })
  const editor = createEditor({ graph })
  try {
    await editor.loadPageNodes(named(graph, 'Unrelated').id)
    expect(graph.getNode(graph.rootId)?.lowcodeApplication).toEqual(editedRoot)
    expect(home.lowcodeApplicationPage).toEqual(editedPage)
    expect(named(graph, 'Authored replacement').id).toBe(replacement.id)
  } finally {
    editor.dispose()
  }
})

test('checkpoint recovery recreates host dependency handling without transferring callbacks', async () => {
  await initCodec()
  const graph = await parseFigFile(
    Uint8Array.from(await exportFigFile(applicationSource())).buffer,
    { populate: 'none' }
  )
  const state = snapshotReaderState(graph)
  if (!state) throw new Error('Missing reader state')
  const clone = new SceneGraph()
  clone.nodes.clear()
  for (const [id, node] of graph.nodes) clone.nodes.set(id, structuredClone(node))
  clone.rootId = graph.rootId
  restoreReaderState(clone, structuredClone(state))
  const editor = createEditor({ graph: clone })
  try {
    await editor.loadPageNodes(named(clone, 'Unrelated').id)
    expectApplicationReferences(clone)
    expect(named(clone, 'Unrelated lazy content').parentId).toBe(named(clone, 'Unrelated').id)
    expect([...graph.getAllNodes()].some((node) => node.name === 'Unrelated lazy content')).toBe(
      false
    )
  } finally {
    editor.dispose()
  }
})

function savedPolicyRecords(policy: string): NodeChange[] {
  const guid = (localID: number) => ({ sessionID: 77, localID })
  const plugin = (key: string, value: string) => ({ pluginID: OPEN_PENCIL_PLUGIN_ID, key, value })
  return [
    { type: 'DOCUMENT', guid: guid(0), pluginData: [plugin('lowcode/application', policy)] },
    {
      type: 'CANVAS',
      guid: guid(1),
      name: 'Reference',
      parentIndex: { guid: guid(0), position: '!' },
      pluginData: [plugin('lowcode/applicationPage', '{"version":1,"role":"reference"}')]
    },
    {
      type: 'CANVAS',
      guid: guid(2),
      name: 'Home',
      parentIndex: { guid: guid(0), position: '"' },
      pluginData: [
        plugin('lowcode/applicationPage', '{"version":1,"role":"application","entryNodeId":"77:4"}')
      ]
    },
    {
      type: 'FRAME',
      guid: guid(3),
      name: 'Shared shell',
      parentIndex: { guid: guid(1), position: '!' },
      size: { x: 400, y: 300 }
    },
    {
      type: 'FRAME',
      guid: guid(4),
      name: 'Home entry',
      parentIndex: { guid: guid(2), position: '!' },
      size: { x: 320, y: 240 }
    }
  ]
}

test('missing application references remain inert rather than rebinding to another available node', () => {
  const policy = {
    version: 1,
    enabled: true,
    startPageId: '77:2',
    shell: { frameNodeId: '77:3', slotNodeId: '77:99' }
  }
  const session = createFigRecordSession(
    savedPolicyRecords(JSON.stringify(policy)),
    [],
    readerSessionOptions([])
  )
  const root = session.graph.getNode(session.graph.rootId)
  expect(root?.lowcodeApplication).toBeUndefined()
  expect(root?.pluginData).toContainEqual({
    pluginId: OPEN_PENCIL_PLUGIN_ID,
    key: 'lowcode/application',
    value: JSON.stringify({ version: 1, unsupportedReason: 'incomplete-reference-remap', policy })
  })
  expect(resolveLowcodeApplicationPages(session.graph)).toMatchObject({
    mode: 'invalid',
    pages: []
  })
  expect([...session.graph.getAllNodes()].some((node) => node.source.id === '77:99')).toBe(false)
})

test('future application policies remain opaque and do not become executable after page loading', () => {
  const value = '{"version":9,"enabled":true,"startPageId":"77:2","future":true}'
  const session = createFigRecordSession(savedPolicyRecords(value), [], readerSessionOptions([]))
  for (const page of session.pages) session.loadPage(page.id)
  expect(session.graph.getNode(session.graph.rootId)?.lowcodeApplication).toBeUndefined()
  expect(session.graph.getNode(session.graph.rootId)?.pluginData).toContainEqual({
    pluginId: OPEN_PENCIL_PLUGIN_ID,
    key: 'lowcode/application',
    value
  })
  expect(resolveLowcodeApplicationPages(session.graph)).toMatchObject({
    mode: 'invalid',
    pages: []
  })
})

test('zero-session checkpoint recovery keeps authored root and page policies while a later page arrives', async () => {
  await initCodec()
  const graph = await parseFigFile(
    Uint8Array.from(await exportFigFile(applicationSource(true))).buffer,
    { populate: 'none' }
  )
  expectApplicationReferences(graph)
  const policy = graph.getNode(graph.rootId)?.lowcodeApplication
  const home = named(graph, 'Home')
  const pagePolicy = home.lowcodeApplicationPage
  if (!policy || !pagePolicy) throw new Error('Missing application policies')
  const editedRoot = { ...policy, enabled: false, startPageId: named(graph, 'Products').id }
  const editedPage = {
    ...pagePolicy,
    entryNodeId: named(graph, 'Home entry').id,
    leaveConfirm: { dirtyExpr: 'true', message: 'Authored before checkpoint' }
  }
  graph.updateNode(graph.rootId, { lowcodeApplication: editedRoot })
  graph.updateNode(home.id, { lowcodeApplicationPage: editedPage })
  const state = snapshotReaderState(graph)
  if (!state) throw new Error('Missing reader checkpoint')
  const clone = new SceneGraph()
  clone.nodes.clear()
  for (const [id, node] of graph.nodes) clone.nodes.set(id, structuredClone(node))
  clone.rootId = graph.rootId
  restoreReaderState(clone, structuredClone(state))
  const editor = createEditor({ graph: clone })
  try {
    for (const page of clone.getPages()) {
      await editor.loadPageNodes(page.id)
      expect(clone.getNode(clone.rootId)?.lowcodeApplication).toEqual(editedRoot)
      expect(named(clone, 'Home').lowcodeApplicationPage).toEqual(editedPage)
    }
    expect([...graph.getAllNodes()].some((node) => node.name === 'Unrelated lazy content')).toBe(
      false
    )
  } finally {
    editor.dispose()
  }
})

test('decoded zero-session records apply raw references once before later occurrence population', async () => {
  await initCodec()
  const archive = parseFigBuffer(
    Uint8Array.from(await exportFigFile(applicationSource(true))).buffer
  )
  const graph = importNodeChanges(archive.nodeChanges, archive.blobs, undefined, {
    populate: 'none'
  })
  expectApplicationReferences(graph)
  const editor = createEditor({ graph })
  try {
    for (const page of graph.getPages()) {
      await editor.loadPageNodes(page.id)
      expectApplicationReferences(graph)
    }
  } finally {
    editor.dispose()
  }
})

test('application-only scope preserves late cross-page Motion action and workflow resolution', async () => {
  await initCodec()
  const source = applicationSource()
  const target = named(source, 'Unrelated lazy content')
  source.updateNode(target.id, { motion: createMotionPreset('fade-in') })
  source.createNode('BUTTON', named(source, 'Reference').id, {
    name: 'Cross-page trigger',
    events: {
      onClick: [{ id: 'play', kind: 'playMotion', targetNodeId: target.id, trackId: 'fade-in' }]
    }
  })
  source.updateNode(source.rootId, {
    lowcodeWorkflows: [
      {
        id: 'stop-workflow',
        name: 'Stop later target',
        actions: [{ id: 'stop', kind: 'stopMotion', targetNodeId: target.id }]
      }
    ]
  })
  const graph = await parseFigFile(Uint8Array.from(await exportFigFile(source)).buffer, {
    populate: 'first-page'
  })
  const trigger = named(graph, 'Cross-page trigger')
  expect([...graph.getAllNodes()].some((node) => node.name === target.name)).toBe(false)
  const pendingAction = trigger.events?.onClick?.[0]
  const pendingWorkflow = graph.getNode(graph.rootId)?.lowcodeWorkflows?.[0]?.actions[0]
  if (pendingAction?.kind !== 'playMotion' || pendingWorkflow?.kind !== 'stopMotion')
    throw new Error('Missing pending cross-page Motion actions')
  expect(pendingAction.targetNodeId).toBe(target.id)
  expect(pendingWorkflow.targetNodeId).toBe(target.id)
  expectApplicationReferences(graph)
  const editor = createEditor({ graph })
  try {
    await editor.loadPageNodes(named(graph, 'Unrelated').id)
    const loaded = named(graph, target.name)
    const action = trigger.events?.onClick?.[0]
    const workflow = graph.getNode(graph.rootId)?.lowcodeWorkflows?.[0]?.actions[0]
    if (action?.kind !== 'playMotion' || workflow?.kind !== 'stopMotion')
      throw new Error('Missing loaded cross-page Motion actions')
    expect(action.targetNodeId).toBe(loaded.id)
    expect(workflow.targetNodeId).toBe(loaded.id)
    expect(loaded.motion).toEqual(target.motion)
    expectApplicationReferences(graph)
  } finally {
    editor.dispose()
  }
})
