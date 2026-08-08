import { describe, expect, test } from 'bun:test'

import { createRichTextModuleInstance, resolveRichTextModule } from '@open-pencil/core/plugins'

import {
  convertRichTextBlock,
  createRichTextBlock,
  createRichTextInline,
  setRichTextInlineLink,
  toggleRichTextInlineMark
} from '@/app/plugins/rich-text-editor-model'

describe('rich text visual editor model', () => {
  test('creates every supported block as valid plugin content', () => {
    const blocks = [
      createRichTextBlock('paragraph'),
      createRichTextBlock('heading-1'),
      createRichTextBlock('heading-2'),
      createRichTextBlock('heading-3'),
      createRichTextBlock('blockquote'),
      createRichTextBlock('codeBlock'),
      createRichTextBlock('bulletList'),
      createRichTextBlock('orderedList')
    ]
    const instance = createRichTextModuleInstance({ content: { type: 'doc', blocks } })

    expect(resolveRichTextModule(instance)?.ok).toBe(true)
  })

  test('converts blocks without losing their visible text or inline marks', () => {
    const paragraph = createRichTextBlock('paragraph')
    if (paragraph.type !== 'paragraph') throw new Error('Expected paragraph fixture')
    paragraph.children = [
      toggleRichTextInlineMark(createRichTextInline('Hello'), 'bold'),
      createRichTextInline(' world')
    ]

    const list = convertRichTextBlock(paragraph, 'bulletList')
    expect(list.type).toBe('bulletList')
    if (list.type !== 'bulletList') throw new Error('Expected list conversion')
    expect(list.items[0]?.children[0]?.marks).toEqual([{ type: 'bold' }])

    const heading = convertRichTextBlock(list, 'heading-2')
    expect(heading.type).toBe('heading')
    if (heading.type !== 'heading') throw new Error('Expected heading conversion')
    expect(heading.children.map((inline) => inline.text).join('')).toBe('Hello world')
    expect(heading.children[0]?.marks).toEqual([{ type: 'bold' }])
  })

  test('enforces mark limits and safe links before committing', () => {
    let inline = createRichTextInline('OpenPencil')
    inline = toggleRichTextInlineMark(inline, 'bold')
    inline = toggleRichTextInlineMark(inline, 'italic')
    inline = toggleRichTextInlineMark(inline, 'underline')
    inline = setRichTextInlineLink(inline, 'https://example.com/docs')

    expect(() => toggleRichTextInlineMark(inline, 'strike')).toThrow('at most 4 marks')
    const unsafeHref = ['java', 'script:alert(1)'].join('')
    expect(() => setRichTextInlineLink(inline, unsafeHref)).toThrow('safe URL')
    expect(setRichTextInlineLink(inline, '').marks.some((mark) => mark.type === 'link')).toBe(false)
  })
})
