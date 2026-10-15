import { expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { collectTree } from '@open-pencil/compiler/ir/collect/tree'
import type { IRElement } from '@open-pencil/compiler/ir/types'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

type AuthoredType = string | number | boolean | null | undefined

function buttonFixture(type: AuthoredType, inForm: boolean, configured: boolean) {
  const graph = makeSceneGraph()
  const pageId = firstPageId(graph)
  graph.updateNode(pageId, {
    state: [{ id: 'status', name: 'status', type: 'string', defaultValue: '' }]
  })
  const parentId = inForm ? graph.createNode('FORM', pageId).id : pageId
  const button = graph.createNode('BUTTON', parentId, {
    interactiveProps: { text: 'Contract button', ...(type === undefined ? {} : { type }) },
    ...(configured
      ? {
          events: {
            onClick: [
              {
                id: 'set-value',
                kind: 'setState' as const,
                targetStateId: 'status',
                valueExpr: '"clicked"'
              }
            ]
          }
        }
      : {})
  })
  const tree = collectTree(graph, pageId)
  const root = tree.children[0] as IRElement
  const element = inForm ? (root.children[0] as IRElement) : root
  expect(element.sourceId).toBe(button.id)
  expect(tree.warnings).toEqual([])
  return element
}

for (const inForm of [true, false]) {
  for (const configured of [false, true]) {
    test.each(['button', 'submit', 'reset'] as const)(
      `explicit BUTTON type %s survives FORM=${inForm} configured=${configured}`,
      (type) => {
        const button = buttonFixture(type, inForm, configured)
        expect(button.attrs.type).toBe(type)
        expect(button.events?.onClick?.length ?? 0).toBe(configured ? 1 : 0)
      }
    )

    test.each([undefined, 'invalid', null, 0, false])(
      `omitted or invalid BUTTON type %j preserves implicit FORM=${inForm} configured=${configured}`,
      (type) => {
        expect(buttonFixture(type, inForm, configured).attrs.type).toBe(
          inForm && !configured ? 'submit' : 'button'
        )
      }
    )
  }
}

test.each(['react', 'vue'] as const)(
  '%s emits all explicit native BUTTON types in a FORM',
  (target) => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const form = graph.createNode('FORM', pageId)
    for (const type of ['button', 'submit', 'reset'] as const)
      graph.createNode('BUTTON', form.id, {
        interactiveProps: { text: `Type ${type}`, type }
      })
    const output = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ target, router: 'none', sourceLocale: 'en', devMode: false })
    })
    expect(output.warnings).toEqual([])
    const source = String(
      output.files.get(target === 'react' ? 'src/App.tsx' : 'src/pages/index.vue')
    )
    for (const type of ['button', 'submit', 'reset'] as const) {
      expect(source).toMatch(
        new RegExp(String.raw`<button\b[^>]*\btype="${type}"[^>]*>\s*Type ${type}\s*</button>`)
      )
    }
  }
)
