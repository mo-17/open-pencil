import { expect, test } from 'bun:test'

import { sceneNodesToTailwindJSXWithLayers, serializeHTML } from '#dom-css/export'
import {
  createStaticHTMLShowcaseFragment,
  sceneGraphToDesignDocument
} from '#dom-css/static-export'
import type { DesignDocument, DesignElement, DesignNode } from '#dom-css/types'
import { parseFragment } from 'parse5'

import { SceneGraph } from '@open-pencil/scene-graph'

test('image button URL and label serialization cannot create attributes or executable JSX', () => {
  const graph = new SceneGraph(),
    page = graph.getPages()[0]
  const source = 'https://images.example.invalid/preview.png?caption="<logo>&onError={danger}'
  const button = graph.createNode('BUTTON', page.id, {
    interactiveProps: { text: '<script> & {total}' },
    pluginData: [{ pluginId: 'open-pencil-dom-css', key: 'image-source-url', value: source }]
  })
  const document = sceneGraphToDesignDocument(graph, { rootId: page.id })
  for (const html of [serializeHTML(document), createStaticHTMLShowcaseFragment(document).html]) {
    const pending = [...parseFragment(html).childNodes]
    const images: Array<Record<string, string>> = []
    for (const node of pending) {
      if ('childNodes' in node) pending.push(...node.childNodes)
      if (!('attrs' in node)) continue
      expect(node.attrs.some((attribute) => attribute.name.toLowerCase().startsWith('on'))).toBe(
        false
      )
      if (node.tagName === 'img')
        images.push(
          Object.fromEntries(node.attrs.map((attribute) => [attribute.name, attribute.value]))
        )
    }
    expect(images).toHaveLength(1)
    expect(images[0]).toMatchObject({ src: source, 'aria-hidden': 'true' })
    expect(html).toContain('&lt;script&gt; &amp; {total}')
  }
  const code = sceneNodesToTailwindJSXWithLayers(graph, [button.id]).code
  const compiled = new Bun.Transpiler({ loader: 'jsx' }).transformSync(`export default (${code})`)
  expect(compiled.length).toBeGreaterThan(0)
  expect(compiled).not.toMatch(/\bonError\s*:/)
  expect(compiled).toContain('onError={danger}')
})

function buttonDocument(overrides: Partial<DesignElement> = {}): DesignDocument {
  return {
    type: 'document',
    children: [
      {
        type: 'element',
        tagName: 'button',
        attrs: {},
        children: [{ type: 'text', text: 'Save draft' }],
        ...overrides
      }
    ]
  }
}

test.each([false, true])(
  'static export keeps button text and styles while native outlets retain disabled=%p',
  (disabled) => {
    const graph = new SceneGraph(),
      page = graph.getPages()[0],
      button = graph.createNode('BUTTON', page.id, {
        width: 140,
        height: 40,
        interactiveProps: { text: 'Continue <script>& "save" {total}', disabled },
        events: { onClick: [{ id: 'save', kind: 'navigate', to: '/saved' }] }
      }),
      document = sceneGraphToDesignDocument(graph, { rootId: page.id }),
      beforeChildren = structuredClone(document.children),
      beforeGraph = document.sourceGraph,
      beforeNodes = structuredClone([...graph.nodes]),
      beforeNode = structuredClone(button),
      fragment = createStaticHTMLShowcaseFragment(document)
    expect(fragment.html).toContain('Continue &lt;script&gt;&amp; "save" {total}')
    expect(fragment.html).toContain('width: 140px')
    expect(fragment.html).toContain('height: 40px')
    expect(fragment.html).not.toMatch(/<button|<script|\s(?:type|disabled|onclick|tabindex|form)=/i)
    expect(document.children).toEqual(beforeChildren)
    expect(document.sourceGraph).toBe(beforeGraph)
    expect([...graph.nodes]).toEqual(beforeNodes)
    expect(graph.getNode(button.id)).toEqual(beforeNode)
    const native = serializeHTML(document),
      jsx = sceneNodesToTailwindJSXWithLayers(graph, [button.id]).code
    expect(native).toContain('<button')
    expect(native).toContain('type="button"')
    expect(jsx).toContain('<button')
    expect(jsx).toContain('type="button"')
    if (disabled) {
      expect(native).toContain('disabled="disabled"')
      expect(jsx).toMatch(/\sdisabled(?:\s|>)/)
    } else {
      expect(native).not.toContain('disabled=')
      expect(jsx).not.toMatch(/\sdisabled(?:=|\s|>)/)
    }
  }
)

test('static button artwork preserves authored children and order instead of adding a fallback label', () => {
  const graph = new SceneGraph(),
    page = graph.getPages()[0]
  graph.createNode('TEXT', page.id, { text: 'Before' })
  const button = graph.createNode('BUTTON', page.id, {
    interactiveProps: { text: 'Unused fallback', disabled: true }
  })
  graph.createNode('TEXT', button.id, { text: 'First child' })
  graph.createNode('TEXT', button.id, { text: 'Hidden child', visible: false })
  graph.createNode('TEXT', button.id, { text: 'Second child' })
  graph.createNode('TEXT', page.id, { text: 'After' })
  const html = createStaticHTMLShowcaseFragment(
    sceneGraphToDesignDocument(graph, { rootId: page.id })
  ).html
  expect(html.indexOf('Before')).toBeLessThan(html.indexOf('First child'))
  expect(html.indexOf('First child')).toBeLessThan(html.indexOf('Second child'))
  expect(html.indexOf('Second child')).toBeLessThan(html.indexOf('After'))
  expect(html).not.toContain('Unused fallback')
  expect(html).not.toContain('Hidden child')
  expect(html).not.toContain('<button')
})

test('static button input strips focus, submission and event attributes while retaining safe metadata', () => {
  const document = buttonDocument({
    tagName: 'BuTtOn',
    attrs: {
      type: 'submit',
      disabled: 'disabled',
      form: 'owner',
      formaction: 'https://example.test/submit',
      onclick: 'doBusiness()',
      tabindex: '0',
      id: 'action',
      'data-purpose': 'draft',
      'aria-label': 'Save "draft"'
    },
    inlineStyle: { color: 'rgb(10, 20, 30)', 'border-radius': '6px' }
  })
  const before = structuredClone(document),
    html = createStaticHTMLShowcaseFragment(document).html
  expect(html).toContain('<div')
  expect(html).toContain('id="action"')
  expect(html).toContain('data-purpose="draft"')
  expect(html).toContain('aria-label="Save &quot;draft&quot;"')
  expect(html).toContain('color: rgb(10, 20, 30)')
  expect(html).toContain('border-radius: 6px')
  expect(html).toContain('>Save draft</div>')
  expect(html).not.toMatch(/<button|\s(?:type|disabled|form|formaction|onclick|tabindex)=/i)
  expect(document).toEqual(before)
})

test.each(['script', 'form', 'input', 'iframe', 'a'])(
  'static button support still rejects unsupported %s elements',
  (tagName) => {
    expect(() => createStaticHTMLShowcaseFragment(buttonDocument({ tagName }))).toThrow(
      'unsupported element'
    )
  }
)

test('static button support still rejects active descendants', () => {
  const child: DesignNode = { type: 'element', tagName: 'script', attrs: {}, children: [] }
  expect(() => createStaticHTMLShowcaseFragment(buttonDocument({ children: [child] }))).toThrow(
    'unsupported element'
  )
})

test('static button support still rejects active styles', () => {
  expect(() =>
    createStaticHTMLShowcaseFragment(
      buttonDocument({ inlineStyle: { background: 'url(javascript:run())' } })
    )
  ).toThrow('unsupported style declaration')
})

test('static button support does not reinterpret a button image source as an image', () => {
  expect(() =>
    createStaticHTMLShowcaseFragment(
      buttonDocument({ attrs: { src: 'https://example.test/image.png' } })
    )
  ).toThrow('unsupported image source')
})
