import { describe, expect, test } from 'bun:test'

import {
  BUILTIN_PLUGIN_REGISTRY,
  RICH_TEXT_MODULE_LIMITS,
  createRichTextModuleInstance,
  isSafeRichTextHref,
  resolveRichTextModule
} from '@open-pencil/core/plugins'

function documentWith(blocks: unknown[]): Record<string, unknown> {
  return { type: 'doc', blocks }
}

function text(value: string, marks: unknown[] = []): Record<string, unknown> {
  return { type: 'text', text: value, marks }
}

describe('built-in rich text plugin', () => {
  test('registers a bounded default module and resolves a defensive copy', () => {
    const definition = BUILTIN_PLUGIN_REGISTRY.getModule('open-pencil.rich-text', 'rich-text')
    const instance = createRichTextModuleInstance()
    const resolved = resolveRichTextModule(instance)

    expect(definition?.name).toBe('Rich Text')
    expect(instance.config).not.toBe(definition?.defaultConfig)
    expect(resolved?.ok).toBe(true)
    if (!resolved?.ok) throw new Error('expected rich text module to resolve')
    expect(resolved.config.content.type).toBe('doc')
    expect(resolved.config.content.blocks).toHaveLength(2)
  })

  test('accepts supported blocks and treats tag-looking content as ordinary text', () => {
    const instance = createRichTextModuleInstance({
      content: documentWith([
        {
          type: 'heading',
          level: 1,
          align: 'center',
          children: [text('<script>alert(1)</script>', [{ type: 'bold' }])]
        },
        {
          type: 'paragraph',
          align: 'left',
          children: [text('Open docs', [{ type: 'link', href: 'https://example.com/docs' }])]
        },
        { type: 'blockquote', children: [text('Quoted')] },
        { type: 'codeBlock', language: 'tsx', text: '<Widget />' },
        {
          type: 'bulletList',
          items: [{ children: [text('First')] }, { children: [text('Second')] }]
        }
      ])
    })
    const resolved = resolveRichTextModule(instance)

    expect(resolved?.ok).toBe(true)
    if (!resolved?.ok) throw new Error('expected rich text module to resolve')
    expect(JSON.stringify(resolved.config.content)).toContain('<script>alert(1)</script>')
    expect(resolved.config.content.blocks.map((block) => block.type)).toEqual([
      'heading',
      'paragraph',
      'blockquote',
      'codeBlock',
      'bulletList'
    ])
  })

  test('rejects executable links, unknown nodes, extra keys, duplicates, and oversized documents', () => {
    expect(isSafeRichTextHref('https://example.com')).toBe(true)
    expect(isSafeRichTextHref('/docs/start')).toBe(true)
    const unsafeHref = ['java', 'script:alert(1)'].join('')
    expect(isSafeRichTextHref(unsafeHref)).toBe(false)
    expect(() =>
      createRichTextModuleInstance({
        content: documentWith([
          {
            type: 'paragraph',
            align: 'left',
            children: [text('Unsafe', [{ type: 'link', href: unsafeHref }])]
          }
        ])
      })
    ).toThrow('safe bounded href')
    expect(() =>
      createRichTextModuleInstance({
        content: documentWith([{ type: 'html', value: '<b>raw</b>' }])
      })
    ).toThrow('unsupported type')
    expect(() =>
      createRichTextModuleInstance({
        content: documentWith([
          { type: 'paragraph', align: 'left', children: [text('x')], rawHtml: '<b>x</b>' }
        ])
      })
    ).toThrow('unexpected properties')
    expect(() =>
      createRichTextModuleInstance({
        content: documentWith([
          {
            type: 'paragraph',
            align: 'left',
            children: [text('x', [{ type: 'bold' }, { type: 'bold' }])]
          }
        ])
      })
    ).toThrow('duplicate mark types')
    expect(() =>
      createRichTextModuleInstance({
        content: documentWith(
          Array.from({ length: RICH_TEXT_MODULE_LIMITS.blocks + 1 }, () => ({
            type: 'paragraph',
            align: 'left',
            children: []
          }))
        )
      })
    ).toThrow(`at most ${RICH_TEXT_MODULE_LIMITS.blocks} blocks`)
  })
})
