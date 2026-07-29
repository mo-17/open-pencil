import { describe, expect, test } from 'bun:test'

import { createEditorStore } from '@/app/editor/session'
import {
  PrototypeAuthoringError,
  addPrototypeConnection,
  listPrototypeTargets,
  nextPrototypeConnectionId,
  removePrototypeConnection,
  replacePrototypeConnection,
  updateNodePrototypeWithUndo,
  updateNodeTransitionKeyWithUndo
} from '@/app/properties/prototype'

describe('Prototype property authoring', () => {
  test('adds, edits, removes, and undoes one strict connection snapshot', () => {
    const store = createEditorStore()
    const source = store.graph.createNode('RECTANGLE', store.state.currentPageId, {
      name: 'Source'
    })
    const target = store.graph.addPage('Destination')
    const first = addPrototypeConnection(undefined, {
      id: nextPrototypeConnectionId(undefined),
      trigger: { kind: 'click' },
      action: { kind: 'navigate', targetNodeId: target.id },
      transition: {
        kind: 'smartMatch',
        durationMs: 320,
        easing: 'ease-in-out',
        fallback: 'dissolve'
      },
      interruption: 'replace',
      playback: 'forward'
    })

    expect(updateNodePrototypeWithUndo(store, source.id, first, 'Update prototype')).toBe(true)
    expect(store.graph.getNode(source.id)?.prototype).toEqual(first)
    expect(store.undo.undoLabel).toBe('Update prototype')

    const edited = replacePrototypeConnection(first, {
      ...first.connections[0],
      playback: 'reverse'
    })
    expect(updateNodePrototypeWithUndo(store, source.id, edited, 'Update prototype')).toBe(true)
    expect(store.graph.getNode(source.id)?.prototype?.connections[0]?.playback).toBe('reverse')

    store.undo.undo()
    expect(store.graph.getNode(source.id)?.prototype?.connections[0]?.playback).toBe('forward')
    store.undo.undo()
    expect(store.graph.getNode(source.id)?.prototype).toBeUndefined()
    store.undo.redo()
    expect(store.graph.getNode(source.id)?.prototype).toEqual(first)

    expect(removePrototypeConnection(first, first.connections[0].id)).toBeUndefined()
    expect(updateNodePrototypeWithUndo(store, source.id, undefined, 'Clear prototype')).toBe(true)
    expect(store.graph.getNode(source.id)?.prototype).toBeUndefined()
  })

  test('fails closed for click conflicts and unresolved or non-frame destinations', () => {
    const store = createEditorStore()
    const source = store.graph.createNode('BUTTON', store.state.currentPageId, {
      events: { onClick: [{ id: 'existing', kind: 'navigate', to: '/existing' }] }
    })
    const rectangle = store.graph.createNode('RECTANGLE', store.state.currentPageId)
    const connection = {
      version: 1 as const,
      connections: [
        {
          id: 'navigate',
          trigger: { kind: 'click' as const },
          action: { kind: 'navigate' as const, targetNodeId: rectangle.id },
          transition: { kind: 'instant' as const }
        }
      ]
    }

    expect(() => updateNodePrototypeWithUndo(store, source.id, connection, 'Update')).toThrow(
      PrototypeAuthoringError
    )
    const delayed = {
      ...connection,
      connections: [
        { ...connection.connections[0], trigger: { kind: 'afterDelay' as const, delayMs: 100 } }
      ]
    }
    expect(() => updateNodePrototypeWithUndo(store, source.id, delayed, 'Update')).toThrow(
      'page or frame'
    )
    expect(store.graph.getNode(source.id)?.prototype).toBeUndefined()
    expect(store.undo.canUndo).toBe(false)
  })

  test('authors a stable Smart Match key and lists deterministic valid targets', () => {
    const store = createEditorStore()
    const source = store.graph.createNode('RECTANGLE', store.state.currentPageId, {
      name: 'Source'
    })
    const later = store.graph.createNode('FRAME', store.state.currentPageId, { name: 'Zeta' })
    const earlier = store.graph.createNode('FRAME', store.state.currentPageId, { name: 'Alpha' })
    store.graph.createNode('RECTANGLE', store.state.currentPageId, { name: 'Ignored' })

    expect(updateNodeTransitionKeyWithUndo(store, source.id, ' shared-hero ', 'Update')).toBe(
      'shared-hero'
    )
    expect(store.graph.getNode(source.id)?.transitionKey).toBe('shared-hero')
    expect(updateNodeTransitionKeyWithUndo(store, source.id, '', 'Clear')).toBeUndefined()
    expect(store.graph.getNode(source.id)?.transitionKey).toBeUndefined()
    store.undo.undo()
    expect(store.graph.getNode(source.id)?.transitionKey).toBe('shared-hero')

    const options = listPrototypeTargets(store)
    expect(options.some(({ id }) => id === later.id)).toBe(true)
    expect(options.some(({ id }) => id === earlier.id)).toBe(true)
    expect(
      options.filter(({ id }) => id === earlier.id || id === later.id).map(({ name }) => name)
    ).toEqual(['Alpha', 'Zeta'])
    expect(options.every(({ type }) => type === 'CANVAS' || type === 'FRAME')).toBe(true)
  })
})
