import { describe, expect, test } from 'bun:test'

import {
  lowcodeApplicationShellFrameEligible,
  lowcodeApplicationShellSlotEligible,
  resolveLowcodeApplicationShell,
  resolveLowcodeApplicationPages,
  validateLowcodeApplication
} from '#lowcode/application-mode'

import { SceneGraph } from '@open-pencil/scene-graph'

function fixture() {
  const graph = new SceneGraph()
  const root = graph.getNode(graph.rootId)
  if (!root) throw new Error('Missing fixture root')
  const page = graph.getPages()[0]
  const entry = graph.createNode('FRAME', page.id, { width: 320, height: 500 })
  page.lowcodeApplicationPage = { version: 1, role: 'application', entryNodeId: entry.id }
  const source = graph.addPage('Shared layouts')
  source.lowcodeApplicationPage = { version: 1, role: 'reference' }
  const frame = graph.createNode('FRAME', source.id, {
    width: 1000,
    height: 720,
    layoutMode: 'HORIZONTAL'
  })
  const column = graph.createNode('FRAME', frame.id, {
    width: 800,
    height: 720,
    layoutMode: 'VERTICAL'
  })
  const slot = graph.createNode('FRAME', column.id, {
    width: 800,
    height: 600,
    layoutMode: 'VERTICAL'
  })
  const shell = { frameNodeId: frame.id, slotNodeId: slot.id }
  root.lowcodeApplication = { version: 1, enabled: true, startPageId: page.id, shell }
  return { graph, root, page, source, frame, column, slot, shell }
}

describe('shared application shell contract', () => {
  test('old policies stay valid; nested shell is detached and closed', () => {
    expect(validateLowcodeApplication({ version: 1, enabled: false }).ok).toBe(true)
    const value = {
      version: 1 as const,
      enabled: true,
      shell: { frameNodeId: 'frame', slotNodeId: 'slot' }
    }
    const result = validateLowcodeApplication(value)
    expect(result).toEqual({ ok: true, value })
    if (result.ok) {
      value.shell.slotNodeId = 'changed'
      expect(result.value.shell?.slotNodeId).toBe('slot')
    }
    for (const shell of [
      undefined,
      null,
      {},
      { frameNodeId: 'frame' },
      { frameNodeId: 'frame', slotNodeId: 'slot', extra: true },
      { frameNodeId: '', slotNodeId: 'slot' },
      { frameNodeId: 'frame', slotNodeId: 'x'.repeat(513) },
      Object.create({ frameNodeId: 'frame', slotNodeId: 'slot' })
    ])
      expect(validateLowcodeApplication({ version: 1, enabled: true, shell }).ok).toBe(false)
    let reads = 0
    const shell = {
      frameNodeId: 'frame',
      get slotNodeId() {
        reads++
        return 'slot'
      }
    }
    expect(validateLowcodeApplication({ version: 1, enabled: true, shell }).ok).toBe(false)
    expect(reads).toBe(0)
    expect(
      validateLowcodeApplication({
        version: 1,
        enabled: true,
        shell: { frameNodeId: 'frame', slotNodeId: 'slot', [Symbol('bad')]: true }
      }).ok
    ).toBe(false)
  })

  test('nested empty flow slot on a reference page resolves without mutation', () => {
    const { graph, frame, slot, source, shell } = fixture()
    const before = JSON.stringify(graph.getAllNodes())
    expect(lowcodeApplicationShellFrameEligible(graph, frame.id)).toBe(true)
    expect(lowcodeApplicationShellSlotEligible(graph, frame.id, slot.id)).toBe(true)
    expect(resolveLowcodeApplicationShell(graph, shell)).toEqual({
      ok: true,
      ...shell,
      pageId: source.id
    })
    expect(resolveLowcodeApplicationPages(graph).shell).toEqual(shell)
    expect(JSON.stringify(graph.getAllNodes())).toBe(before)
  })

  test('role, source context, empty slot and ancestor edits invalidate the configured shell', () => {
    for (const mutate of [
      (f: ReturnType<typeof fixture>) => {
        f.source.lowcodeApplicationPage = { version: 1, role: 'application' }
      },
      (f: ReturnType<typeof fixture>) => {
        f.source.state = []
      },
      (f: ReturnType<typeof fixture>) => {
        f.source.events = {}
      },
      (f: ReturnType<typeof fixture>) => {
        f.source.lowcodeWorkflows = []
      },
      (f: ReturnType<typeof fixture>) => {
        f.column.locked = true
      },
      (f: ReturnType<typeof fixture>) => {
        f.slot.layoutMode = 'NONE'
      },
      (f: ReturnType<typeof fixture>) => {
        f.column.interactiveProps = { module: {} }
      },
      (f: ReturnType<typeof fixture>) => {
        f.slot.interactiveProps = { image: { src: 'https://example.com/test.png' } }
      },
      (f: ReturnType<typeof fixture>) => {
        f.column.interactiveProps = { image: { src: 'https://example.com/test.png' } }
      },
      (f: ReturnType<typeof fixture>) => {
        f.column.interactiveProps = { dataSourceRef: {} }
      },
      (f: ReturnType<typeof fixture>) => {
        f.column.parentId = f.slot.id
        f.slot.childIds = [f.column.id]
      },
      (f: ReturnType<typeof fixture>) => {
        f.slot.renderCondition = 'true'
      },
      (f: ReturnType<typeof fixture>) => {
        f.graph.createNode('TEXT', f.slot.id)
      },
      (f: ReturnType<typeof fixture>) => {
        f.frame.width = Infinity
      },
      (f: ReturnType<typeof fixture>) => {
        f.column.childIds = []
      }
    ]) {
      const f = fixture()
      mutate(f)
      expect(resolveLowcodeApplicationShell(f.graph, f.shell).ok).toBe(false)
      expect(
        resolveLowcodeApplicationPages(f.graph).warnings.some(
          (w) => w.code === 'application-shell-invalid'
        )
      ).toBe(true)
      expect(f.root.lowcodeApplication?.shell).toEqual(f.shell)
      if (!f.root.lowcodeApplication) throw new Error('Missing fixture policy')
      f.root.lowcodeApplication.enabled = false
      expect(resolveLowcodeApplicationPages(f.graph).mode).toBe('legacy')
    }
  })
})
