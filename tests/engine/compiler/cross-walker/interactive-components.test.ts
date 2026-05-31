import { beforeAll, describe, expect, test } from 'bun:test'

import { SceneGraph, initCodec } from '@open-pencil/core'

import { compile, withDefaults } from '@open-pencil/compiler'

/**
 * Phase 2 §8 step 4 — cross-walker regression (经验 A).
 *
 * The four new NodeTypes are dispatched by `node.type` switches with a
 * `default` arm (`TAG_BY_TYPE`, `applyInteractiveProps`) — a missing entry
 * would NOT be a tsgo error, the node would just silently vanish from the
 * output (`collectTree` returns null when `TAG_BY_TYPE` has no tag). This
 * pins that all four survive a full compile into native HTML elements.
 */
describe('cross-walker — §8 interactive components survive a full compile', () => {
  beforeAll(async () => {
    await initCodec()
  })

  test('TEXTAREA / DATEPICKER / SWITCH / RADIO all emit native elements', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.updateNode(page.id, { name: 'Home' })

    graph.createNode('TEXTAREA', page.id, {
      interactiveProps: { placeholder: 'Notes', value: '' }
    })
    graph.createNode('DATEPICKER', page.id, { interactiveProps: { value: '' } })
    graph.createNode('SWITCH', page.id, { interactiveProps: { checked: true } })
    graph.createNode('RADIO', page.id, {
      interactiveProps: { options: ['Yes', 'No'], value: 'Yes', groupName: 'answer' }
    })

    const out = compile({
      graph,
      pageIds: [page.id],
      options: withDefaults({ packageName: 'cross-walker-interactive' })
    })
    const app = out.files.get('src/App.tsx') as string

    expect(app).toContain('<textarea')
    expect(app).toContain('placeholder="Notes"')
    expect(app).toContain('type="date"')
    expect(app).toContain('role="switch"')
    expect(app).toContain('type="radio"')
    expect(app).toContain('name="answer"')
    // RADIO option labels render their text.
    expect(app).toContain('Yes')
    expect(app).toContain('No')
    expect(out.warnings).toEqual([])
  })
})
