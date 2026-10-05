import { describe, expect, test } from 'bun:test'

import {
  sceneNodeToDesignDocument,
  sceneNodesToTailwindJSXWithLayers,
  serializeHTML
} from '#dom-css/export'
import { fromUint8Array, toUint8Array } from 'js-base64'

import { makeGraph, pageId, tw } from './helpers'

const BUTTON_PNG = toUint8Array(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
)

describe('Tailwind JSX buttons', () => {
  for (const imageScaleMode of ['FIT', 'FILL'] as const)
    test.each([false, true])(
      `preserves IMAGE ${imageScaleMode} fill under native button content (disabled=%p)`,
      (disabled) => {
        const graph = makeGraph()
        graph.images.set('button-image', BUTTON_PNG)
        const button = graph.createNode('BUTTON', pageId(graph), {
          width: 140,
          height: 40,
          interactiveProps: { text: 'Image <action> & {total}', disabled },
          fills: [
            {
              type: 'IMAGE',
              imageHash: 'button-image',
              imageScaleMode,
              color: { r: 0, g: 0, b: 0, a: 1 },
              opacity: 0.75,
              visible: true
            }
          ]
        })
        const before = structuredClone([...graph.nodes]),
          imagesBefore = structuredClone([...graph.images])
        const document = sceneNodeToDesignDocument(graph, button.id)
        const root = document.children[0]
        if (root?.type !== 'element') throw new Error('Expected native button')
        const image = root.children[0]
        if (image?.type !== 'element') throw new Error('Expected decorative image')
        expect(root.tagName).toBe('button')
        expect(root.attrs).toMatchObject({ type: 'button' })
        expect(root.attrs.src).toBeUndefined()
        expect(root.inlineStyle).toMatchObject({
          width: '140px',
          height: '40px',
          isolation: 'isolate'
        })
        expect(image.tagName).toBe('img')
        expect(image.attrs).toMatchObject({
          src: `data:image/png;base64,${fromUint8Array(BUTTON_PNG)}`,
          'aria-hidden': 'true'
        })
        expect(image.inlineStyle).toMatchObject({
          width: '100%',
          height: '100%',
          position: 'absolute',
          'object-fit': imageScaleMode === 'FIT' ? 'contain' : 'cover',
          opacity: '0.75',
          'pointer-events': 'none'
        })
        expect(root.children[1]).toEqual({ type: 'text', text: 'Image <action> & {total}' })
        const html = serializeHTML(document),
          result = sceneNodesToTailwindJSXWithLayers(graph, [button.id])
        expect(html).toContain('data:image/png;base64,')
        expect(html).toContain('Image &lt;action&gt; &amp; {total}')
        expect(html.includes('disabled="disabled"')).toBe(disabled)
        expect(result.code).toStartWith('<button ')
        expect(result.code).toContain('data:image/png;base64,')
        expect(result.code).toContain(imageScaleMode === 'FIT' ? 'object-contain' : 'object-cover')
        expect(/\sdisabled(?:\s|>)/.test(result.code)).toBe(disabled)
        expect(result.layerIds).toEqual([button.id, null])
        expect([...graph.nodes]).toEqual(before)
        expect([...graph.images]).toEqual(imagesBefore)
      }
    )

  test('keeps authored child layers and their identities above the button image', () => {
    const graph = makeGraph()
    graph.images.set('button-image', BUTTON_PNG)
    const button = graph.createNode('BUTTON', pageId(graph), {
      interactiveProps: { text: 'Unused fallback' },
      fills: [
        {
          type: 'IMAGE',
          imageHash: 'button-image',
          imageScaleMode: 'FILL',
          color: { r: 0, g: 0, b: 0, a: 1 },
          opacity: 1,
          visible: true
        }
      ]
    })
    const child = graph.createNode('TEXT', button.id, { text: 'Authored label' })
    const result = sceneNodesToTailwindJSXWithLayers(graph, [button.id])
    expect(result.code).toContain('data:image/png;base64,')
    expect(result.code).toContain('Authored label')
    expect(result.code).not.toContain('Unused fallback')
    expect(result.layerIds).toEqual([button.id, null, child.id])
  })

  test('does not invent an image for hidden fills or missing assets, and keeps plain button output', () => {
    const graph = makeGraph()
    graph.images.set('button-image', BUTTON_PNG)
    for (const [imageHash, visible] of [
      ['button-image', false],
      ['missing', true]
    ] as const) {
      const button = graph.createNode('BUTTON', pageId(graph), {
        interactiveProps: { text: 'Continue' },
        fills: [
          {
            type: 'IMAGE',
            imageHash,
            imageScaleMode: 'FIT',
            color: { r: 0, g: 0, b: 0, a: 1 },
            opacity: 1,
            visible
          }
        ]
      })
      expect(tw(graph, button.id)).not.toContain('<img')
      expect(tw(graph, button.id)).toContain('>Continue</button>')
    }
    const plain = graph.createNode('BUTTON', pageId(graph), { interactiveProps: { text: 'Plain' } })
    expect(tw(graph, plain.id)).not.toContain('<img')
    expect(tw(graph, plain.id)).not.toContain('isolate')
  })

  test('exports the native button and its authored label without submitting a form', () => {
    const graph = makeGraph()
    const button = graph.createNode('BUTTON', pageId(graph), {
      name: 'Primary Button',
      width: 140,
      height: 40,
      interactiveProps: { text: 'Continue' }
    })
    const result = sceneNodesToTailwindJSXWithLayers(graph, [button.id])
    expect(result.code).toStartWith('<button ')
    expect(result.code).toContain('type="button"')
    expect(result.code).toContain('>Continue</button>')
    expect(result.code).toContain('w-35 h-10')
    expect(result.layerIds).toEqual([button.id])
  })

  test.each([undefined, '', ' \t ', 0])('uses the existing fallback for label %p', (text) => {
    const graph = makeGraph()
    const button = graph.createNode('BUTTON', pageId(graph), { interactiveProps: { text } })
    expect(tw(graph, button.id)).toContain('>Button</button>')
  })

  test('keeps special characters in labels as text rather than JSX', () => {
    const graph = makeGraph()
    const text = ' {amount} < Continue & "save" >\n'
    const button = graph.createNode('BUTTON', pageId(graph), { interactiveProps: { text } })
    expect(tw(graph, button.id)).toContain(`{${JSON.stringify(text)}}</button>`)
    const html = serializeHTML(sceneNodeToDesignDocument(graph, button.id))
    expect(html).toContain(' {amount} &lt; Continue &amp; "save" &gt;\n</button>')
  })

  test('preserves visible authored children and their layer mapping instead of adding a label', () => {
    const graph = makeGraph()
    const button = graph.createNode('BUTTON', pageId(graph), {
      interactiveProps: { text: 'Fallback label' }
    })
    const label = graph.createNode('TEXT', button.id, { text: 'Authored child' })
    const result = sceneNodesToTailwindJSXWithLayers(graph, [button.id])
    expect(result.code).toStartWith('<button ')
    expect(result.code).toContain('>Authored child</p>')
    expect(result.code).not.toContain('Fallback label')
    expect(result.layerIds).toEqual([button.id, label.id])
  })

  test('hidden children do not erase the visible button label', () => {
    const graph = makeGraph()
    const button = graph.createNode('BUTTON', pageId(graph), {
      interactiveProps: { text: 'Continue' }
    })
    graph.createNode('TEXT', button.id, { text: 'Hidden', visible: false })
    expect(tw(graph, button.id)).toContain('>Continue</button>')
    expect(tw(graph, button.id)).not.toContain('Hidden')
  })

  test('exports disabled as a native boolean in JSX and HTML without mutating lowcode data', () => {
    const graph = makeGraph()
    const button = graph.createNode('BUTTON', pageId(graph), {
      interactiveProps: { text: 'Continue', disabled: true },
      events: { onClick: [{ id: 'next', kind: 'navigate', to: '/done' }] }
    })
    const before = structuredClone(button)
    const code = tw(graph, button.id)
    expect(code).toMatch(/\sdisabled(?:\s|>)/)
    expect(code).not.toContain('disabled="')
    expect(code).not.toContain('onClick')
    const html = serializeHTML(sceneNodeToDesignDocument(graph, button.id))
    expect(html).toContain('type="button"')
    expect(html).toContain('disabled="disabled"')
    expect(html).toContain('>Continue</button>')
    expect(graph.getNode(button.id)).toEqual(before)
  })

  test.each([undefined, false, 'true'])(
    'only a boolean true disables the button (%p)',
    (disabled) => {
      const graph = makeGraph()
      const button = graph.createNode('BUTTON', pageId(graph), {
        interactiveProps: { text: 'Continue', disabled }
      })
      expect(tw(graph, button.id)).not.toMatch(/\sdisabled(?:=|\s|>)/)
      expect(serializeHTML(sceneNodeToDesignDocument(graph, button.id))).not.toContain('disabled=')
    }
  )

  test('does not interpret non-button interactive data as a button or label', () => {
    const graph = makeGraph()
    const frame = graph.createNode('FRAME', pageId(graph), {
      interactiveProps: { text: 'Continue', disabled: true }
    })
    const code = tw(graph, frame.id)
    expect(code).toStartWith('<div ')
    expect(code).not.toContain('Continue')
    expect(code).not.toContain('disabled')
    expect(code).not.toContain('type="button"')
  })
})
