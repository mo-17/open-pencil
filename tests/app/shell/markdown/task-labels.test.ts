import { describe, expect, test } from 'bun:test'

import {
  createMarkmendParser,
  type MarkdownDocument,
  type MarkdownElement
} from 'vue-stream-markdown'

import { markdownTaskLabels } from '@/app/shell/markdown/task-labels'

type MarkdownNode = MarkdownDocument['nodes'][number]

function elements(nodes: MarkdownNode[], tag: string): MarkdownElement[] {
  return nodes.flatMap((node) => {
    if (typeof node === 'string' || node[0] === null) return []
    const [, , ...children] = node
    return [...(node[0] === tag ? [node] : []), ...elements(children, tag)]
  })
}

function textContent(node: MarkdownNode): string {
  if (typeof node === 'string') return node
  if (node[0] === null) return ''
  const [, , ...children] = node
  return children.map(textContent).join('')
}

function createParser() {
  return createMarkmendParser({ parserOptions: { plugins: [markdownTaskLabels] } })
}

describe('Markdown task labels', () => {
  test('associates completed and pending tasks with their visible text without enabling edits', async () => {
    const { document } = await createParser().parse(
      '- [x] Completed task\n- [ ] Pending task',
      'static'
    )
    const labels = elements(document.nodes, 'label')
    expect(labels.map(textContent)).toEqual([' Completed task', ' Pending task'])
    const inputs = elements(labels, 'input')
    expect(inputs).toHaveLength(2)
    expect(inputs.map((input) => input[1][':disabled'])).toEqual(['true', 'true'])
    expect(inputs[0]?.[1][':checked']).toBe('true')
    expect(inputs[1]?.[1][':checked']).toBeUndefined()
  })

  test('retains inline formatting and links in the task label', async () => {
    const { document } = await createParser().parse(
      '- [ ] Review **bold** `code` and [details](https://example.com/details)',
      'static'
    )
    const labels = elements(document.nodes, 'label')
    expect(labels).toHaveLength(1)
    expect(labels.map(textContent)).toEqual([' Review bold code and details'])
    expect(elements(labels, 'strong').map(textContent)).toEqual(['bold'])
    expect(elements(labels, 'code').map(textContent)).toEqual(['code'])
    expect(elements(labels, 'a').map((link) => link[1].href)).toEqual([
      'https://example.com/details'
    ])
  })

  test('keeps nested lists outside the parent label and names each nested task separately', async () => {
    const { document } = await createParser().parse(
      '- [ ] Parent task\n  - [x] Nested task\n  - Ordinary item',
      'static'
    )
    const labels = elements(document.nodes, 'label')
    expect(labels.map(textContent)).toEqual([' Parent task', ' Nested task'])
    expect(elements(labels, 'ul')).toEqual([])
    expect(elements(labels, 'ol')).toEqual([])
    expect(elements(document.nodes, 'li')).toHaveLength(3)
    expect(elements(labels, 'input')).toHaveLength(2)
  })

  test('leaves ordinary lists and the existing HTML parser policy unchanged', async () => {
    const content =
      '- Ordinary **item**\n\n<script>alert("unsafe")</script>\n\n<span>HTML text</span>'
    const original = await createMarkmendParser().parse(content, 'static')
    const labeled = await createParser().parse(content, 'static')
    expect(labeled.document.nodes).toEqual(original.document.nodes)
    expect(elements(labeled.document.nodes, 'label')).toEqual([])
  })

  test('updates task names while streaming and settles to the same read-only static labels', async () => {
    const parser = createParser()
    const first = await parser.parse('- [ ] Draft', 'streaming')
    expect(elements(first.document.nodes, 'label').map(textContent)).toEqual([' Draft'])
    const content = '- [x] Draft complete\n- [ ] Next task'
    const streamed = await parser.parse(content, 'streaming')
    const settled = await parser.parse(content, 'static')
    const staticDocument = await createParser().parse(content, 'static')
    const labels = elements(streamed.document.nodes, 'label')
    expect(labels.map(textContent)).toEqual([' Draft complete', ' Next task'])
    expect(elements(labels, 'label')).toHaveLength(2)
    expect(elements(labels, 'input').map((input) => input[1][':disabled'])).toEqual([
      'true',
      'true'
    ])
    expect(elements(settled.document.nodes, 'label')).toEqual(
      elements(staticDocument.document.nodes, 'label')
    )
  })
})
