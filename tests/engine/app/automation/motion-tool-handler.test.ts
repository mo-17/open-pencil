import { describe, expect, test } from 'bun:test'

import { FigmaAPI } from '@open-pencil/core/figma-api'

import type { AutomationTarget } from '@/app/automation/bridge/target'
import { createAutomationToolHandler } from '@/app/automation/bridge/tool-handlers'
import { createEditorStore } from '@/app/editor/session'

function setup() {
  const store = createEditorStore()
  const page = store.graph.getNode(store.state.currentPageId)
  if (!page) throw new Error('Expected current page')
  const ids = [0, 1].map(
    (index) =>
      store.graph.createNode('RECTANGLE', page.id, {
        x: index * 120,
        y: 0,
        width: 100,
        height: 80
      }).id
  )
  const flashed: string[][] = []
  store.flashNodes = (nodeIds) => flashed.push([...nodeIds])
  const target: AutomationTarget = {
    store,
    documentId: 'motion-automation-test',
    documentName: 'Motion automation test',
    pageId: page.id,
    pageName: page.name
  }
  const handle = createAutomationToolHandler((currentStore) => new FigmaAPI(currentStore.graph))
  return { flashed, handle, ids, store, target }
}

describe('automation Motion tool handler', () => {
  test('applies and flashes nested Motion tool result ids in one undo step', async () => {
    const { flashed, handle, ids, store, target } = setup()
    const response = await handle(target, {
      name: 'apply_motion_preset',
      args: { nodeIds: ids, preset: 'slide-up', staggerMs: 40 }
    })

    expect(response).toEqual({
      ok: true,
      result: { ok: true, data: { nodeIds: ids, preset: 'slide-up' } }
    })
    expect(flashed).toEqual([ids])
    expect(ids.map((id) => store.graph.getNode(id)?.motion?.tracks[0]?.timing.delayMs)).toEqual([
      0, 40
    ])
    expect(store.undo.undoLabel).toBe('AI: apply_motion_preset')

    store.undo.undo()
    expect(ids.map((id) => store.graph.getNode(id)?.motion)).toEqual([undefined, undefined])
  })

  test('returns an explicit nested tool failure without flashing or mutating', async () => {
    const { flashed, handle, ids, store, target } = setup()
    const response = await handle(target, {
      name: 'apply_motion_spec',
      args: { nodeIds: ids, specJson: '{invalid' }
    })

    expect(response).toMatchObject({
      ok: true,
      result: { ok: false, error: expect.stringContaining('valid JSON') }
    })
    expect(flashed).toEqual([[]])
    expect(ids.map((id) => store.graph.getNode(id)?.motion)).toEqual([undefined, undefined])
    expect(store.undo.canUndo).toBe(false)
  })
})
