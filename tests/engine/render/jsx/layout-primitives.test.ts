import { describe, expect, test } from 'bun:test'

import { renderJSX, SceneGraph } from '@open-pencil/core'
import { collectLayoutPrimitiveClasses, selectionToJSX } from '@open-pencil/core/io/formats/jsx'

function paragraph(interactiveProps: Record<string, unknown>) {
  const graph = new SceneGraph()
  const node = graph.createNode('TEXT', graph.getPages()[0].id, {
    name: 'Article body',
    text: 'Plain text body',
    width: 320,
    height: 160,
    interactiveProps
  })
  return { graph, node }
}

describe('bounded JSX layout whitespace', () => {
  test('emits only fixed whitespace utilities alongside existing layout primitives', () => {
    for (const whiteSpace of ['normal', 'pre-wrap']) {
      const { node } = paragraph({ layout: { overflowY: 'auto', whiteSpace } })
      expect(collectLayoutPrimitiveClasses(node)).toEqual([
        'overflow-y-auto',
        whiteSpace === 'normal' ? 'whitespace-normal' : 'whitespace-pre-wrap'
      ])
    }
    const { node } = paragraph({ whiteSpace: 'pre-wrap' })
    expect(collectLayoutPrimitiveClasses(node)).toEqual(['whitespace-pre-wrap'])
  })

  test('ignores unsupported values without coercion or arbitrary CSS output', () => {
    for (const whiteSpace of [
      undefined,
      null,
      true,
      1,
      'nowrap',
      'pre-line',
      'pre-wrap ',
      'pre-wrap; color:red',
      'pre-wrap bg-[url(https://attacker.invalid)]',
      '</style><script>alert(1)</script>',
      ['pre-wrap'],
      {
        toString: () => {
          throw new Error('Do not coerce layout values')
        }
      }
    ]) {
      const { node } = paragraph({ layout: { overflowY: 'auto', whiteSpace } })
      expect(collectLayoutPrimitiveClasses(node)).toEqual(['overflow-y-auto'])
    }
  })

  test('copying a paragraph to editable JSX retains its bounded layout configuration', () => {
    const layout = { position: 'sticky', top: 0, overflowY: 'auto', whiteSpace: 'pre-wrap' }
    const { graph, node } = paragraph({ layout })
    const jsx = selectionToJSX([node.id], graph)
    expect(jsx).toContain('interactiveProps={{"layout":' + JSON.stringify(layout) + '}}')
    expect(jsx).toContain('Plain text body')
  })

  test('existing lowcode JSX import retains new whitespace and previous layout settings', async () => {
    const layout = { position: 'sticky', top: 0, overflowY: 'auto', whiteSpace: 'pre-wrap' }
    const graph = new SceneGraph()
    const node = graph.createNode('FORM', graph.getPages()[0].id, {
      name: 'Scrollable form',
      interactiveProps: { layout }
    })
    const jsx = selectionToJSX([node.id], graph)
    const target = new SceneGraph()
    const [imported] = await renderJSX(target, jsx)
    const result = target.getNode(imported.id)
    if (!result) throw new Error('Missing copied form')
    expect(result.interactiveProps?.layout).toEqual(layout)
    expect(collectLayoutPrimitiveClasses(result)).toEqual([
      'sticky',
      'top-[0px]',
      'overflow-y-auto',
      'whitespace-pre-wrap'
    ])
    expect(result.type).toBe('FORM')
  })
})
