import { expect, test } from 'bun:test'

import { getTool, setupToolTest } from '#tests/helpers/tools'

test('mutation tool retains explicit navigation history and Back fallback inside branches', () => {
  const { figma, graph } = setupToolTest()
  const owner = figma.createRectangle()
  const action = {
    id: 'condition',
    kind: 'condition',
    condExpr: '1 === 1',
    consequent: [
      { id: 'replace', kind: 'navigate', to: '/details/42?mode=edit#form', history: 'replace' }
    ],
    alternate: [{ id: 'back', kind: 'back', fallback: '/list?status=active#top' }]
  }
  const result = getTool('update_lowcode_node').execute(figma, {
    id: owner.id,
    patch_json: JSON.stringify({ events: { onClick: [action] } })
  })
  expect(result.ok).toBe(true)
  expect(graph.getNode(owner.id)?.events?.onClick).toEqual([action])
})

test('mutation tool rejects unsafe fallback and unknown history atomically', () => {
  const { figma, graph } = setupToolTest()
  const owner = figma.createRectangle()
  for (const action of [
    { id: 'back', kind: 'back', fallback: 'https://example.test' },
    { id: 'back', kind: 'back', fallback: '/:id' },
    { id: 'back', kind: 'back', fallback: '/\n' },
    { id: 'replace', kind: 'navigate', to: '/list', history: 'unknown' }
  ]) {
    const result = getTool('update_lowcode_node').execute(figma, {
      id: owner.id,
      patch_json: JSON.stringify({
        interactiveProps: { text: 'Should not persist' },
        events: { onClick: [action] }
      })
    })
    expect(result.ok).toBe(false)
    expect(graph.getNode(owner.id)?.events).toBeUndefined()
    expect(graph.getNode(owner.id)?.interactiveProps).toBeUndefined()
  }
})
