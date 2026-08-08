import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { compile, withDefaults } from '@open-pencil/compiler'
import { buildPreviewProject } from '@open-pencil/compiler/build'
import { collectTree } from '@open-pencil/compiler/ir/collect/tree'
import type { IRElement } from '@open-pencil/compiler/ir/types'
import { createRichTextModuleFrameOverrides } from '@open-pencil/core/plugins'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

function text(value: string, marks: Record<string, unknown>[] = []) {
  return { type: 'text', text: value, marks }
}

function richDocument() {
  return {
    type: 'doc',
    blocks: [
      {
        type: 'heading',
        level: 1,
        align: 'center',
        children: [text('Safe <script>alert(1)</script>', [{ type: 'bold' }])]
      },
      {
        type: 'paragraph',
        align: 'left',
        children: [
          text('Read '),
          text('the guide', [
            { type: 'italic' },
            { type: 'link', href: 'https://example.com/guide' }
          ])
        ]
      },
      { type: 'blockquote', children: [text('Structured content')] },
      { type: 'codeBlock', language: 'tsx', text: '<Widget />' },
      {
        type: 'orderedList',
        items: [{ children: [text('First')] }, { children: [text('Second')] }]
      }
    ]
  }
}

describe('compiler trusted rich text module adapter', () => {
  test('lowers bounded AST data and emits an accessible editable React runtime', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const frame = graph.createNode('FRAME', pageId, {
      ...createRichTextModuleFrameOverrides({
        content: richDocument(),
        textColor: '#1F2937',
        linkColor: '#1D4ED8',
        fontSize: 18,
        lineHeight: 1.6
      }),
      width: 560,
      height: 360
    })
    graph.createNode('TEXT', frame.id, { text: 'Authored overlay' })

    const ir = collectTree(graph, pageId)
    const element = ir.children[0] as IRElement
    expect(element.module).toEqual({
      pluginId: 'open-pencil.rich-text',
      moduleType: 'rich-text',
      configVersion: 1,
      payload: {
        content: richDocument(),
        textColor: '#1F2937',
        linkColor: '#1D4ED8',
        fontSize: 18,
        lineHeight: 1.6
      }
    })

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'rich-text-demo' })
    })
    const app = out.files.get('src/App.tsx') as string
    const runtime = out.files.get('src/__openpencil_rich_text.tsx') as string
    const pkg = JSON.parse(out.files.get('package.json') as string) as {
      dependencies: Record<string, string>
    }

    expect(app).toContain("import OpenPencilRichText from './__openpencil_rich_text'")
    expect(app).toContain('<OpenPencilRichText config={{')
    expect(app).toContain('Safe <script>alert(1)</script>')
    expect(app).toContain('Authored overlay')
    expect(app).toContain('</OpenPencilRichText>')
    expect(runtime).toContain('<article')
    expect(runtime).toContain("document.createElement('blockquote')")
    expect(runtime).toContain("document.createElement('code')")
    expect(runtime).toContain('code.dataset.language = block.language')
    expect(runtime).toContain("document.createElement('a')")
    expect(runtime).toContain('aria-label="Rich text formatting"')
    expect(runtime).toContain('role="toolbar"')
    expect(runtime).toContain('aria-label="Rich text editor"')
    expect(runtime).toContain('aria-multiline="true"')
    expect(runtime).toContain('role="textbox"')
    expect(runtime).toContain('contentEditable')
    expect(runtime).toContain('suppressContentEditableWarning')
    expect(runtime).toContain('onInput={syncDocument}')
    for (const label of [
      'Bold',
      'Italic',
      'Underline',
      'Strikethrough',
      'Inline code',
      'Bullet list',
      'Ordered list',
      'Align left',
      'Align center',
      'Align right',
      'Link',
      'Clear formatting',
      'Undo',
      'Redo'
    ]) {
      expect(runtime).toContain(`label="${label}"`)
    }
    expect(runtime).toContain('type="hidden"')
    expect(runtime).toContain('defaultValue={JSON.stringify(documentRef.current)}')
    expect(runtime).toContain('hiddenInputRef.current.value = JSON.stringify(next.document)')
    expect(runtime).toContain('value.length > 2048')
    expect(runtime).toContain('value.trim() !== value')
    expect(runtime).toContain("value.startsWith('/') && !value.startsWith('//')")
    expect(runtime).toContain('https?:|mailto:|tel:')
    expect(runtime).not.toContain('dangerouslySetInnerHTML')
    expect(runtime).not.toContain('.innerHTML')
    expect(runtime).not.toMatch(/<script\b/i)
    expect(pkg.dependencies['slate']).toBeUndefined()
    expect(pkg.dependencies['prosemirror-view']).toBeUndefined()
    expect(pkg.dependencies['@tiptap/react']).toBeUndefined()
    expect(out.warnings).toEqual([])
  })

  test('keeps the authored FRAME fallback when the AST requests an unsupported raw node', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const frame = graph.createNode('FRAME', pageId, {
      width: 360,
      height: 200,
      interactiveProps: {
        module: {
          version: 1,
          pluginId: 'open-pencil.rich-text',
          moduleType: 'rich-text',
          configVersion: 1,
          config: {
            content: { type: 'doc', blocks: [{ type: 'html', value: '<b>unsafe</b>' }] },
            textColor: '#111827',
            linkColor: '#2563EB',
            fontSize: 16,
            lineHeight: 1.5
          }
        }
      }
    })
    graph.createNode('TEXT', frame.id, { text: 'Rich text unavailable' })

    const ir = collectTree(graph, pageId)
    const element = ir.children[0] as IRElement
    expect(element.module).toBeUndefined()
    expect(JSON.stringify(element.children)).toContain('Rich text unavailable')
    expect(ir.warnings.map((warning) => warning.code)).toContain('rich-text-module-invalid')
  })

  test('bundles the dependency-free runtime into a static preview project', async () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode(
      'FRAME',
      pageId,
      createRichTextModuleFrameOverrides({ content: richDocument() })
    )
    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'rich-text-static', devMode: false })
    })
    const buildDirectory = mkdtempSync(join(tmpdir(), 'openpencil-rich-text-build-'))

    try {
      const built = await buildPreviewProject({ files: out.files, outDir: buildDirectory })
      expect(built.files).toContain('index.html')
      expect(built.files.some((path) => path.endsWith('.js'))).toBe(true)
      expect(out.warnings).toEqual([])
    } finally {
      rmSync(buildDirectory, { recursive: true, force: true })
    }
  }, 15_000)
})
