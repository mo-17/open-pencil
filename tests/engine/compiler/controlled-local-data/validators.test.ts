import { describe, expect, test } from 'bun:test'

import { buildOpenPencilRichTextComponent } from '#compiler/adapters/react/modules/rich-text'
import { RICH_TEXT_CONTROLLED_RUNTIME } from '#compiler/adapters/rich-text/controlled'
import { UPLOAD_LOCAL_FILES_RUNTIME } from '#compiler/adapters/upload-button/local-files'

const transpiler = new Bun.Transpiler({ loader: 'ts' })
const richRuntime = buildOpenPencilRichTextComponent()
const declarations = richRuntime.slice(
  richRuntime.indexOf('const LIMITS ='),
  richRuntime.indexOf('function appendInlineElement(')
)
const projectRichText = new Function(
  transpiler.transformSync(declarations) + '\nreturn projectRichText'
)() as (value: unknown) => unknown
const local = new Function(
  transpiler.transformSync(UPLOAD_LOCAL_FILES_RUNTIME) +
    '\nreturn { projectLocalFiles, selectLocalFiles }'
)() as {
  projectLocalFiles(value: unknown, config: unknown, current: unknown[], id: () => number): unknown
}
const config = { accept: ['.txt'], multiple: true, maxFiles: 3, maxFileBytes: 8 }
const inline = (text: string, marks: unknown[] = []) => ({ type: 'text', text, marks })
const document = () => ({
  type: 'doc',
  blocks: [{ type: 'paragraph', align: 'left', children: [inline('safe <script>')] }]
})

describe('controlled browser-local file projection', () => {
  test('retains exact File objects and IDs without reading bytes', () => {
    const file = new File(['abc'], 'seed.txt', { type: 'text/plain' })
    Object.defineProperty(file, 'arrayBuffer', {
      value: () => {
        throw new Error('no bytes')
      }
    })
    Object.defineProperty(file, 'text', {
      value: () => {
        throw new Error('no bytes')
      }
    })
    const current = [{ id: 8, file }]
    expect(local.projectLocalFiles([file], config, current, () => 99)).toEqual(current)
    expect(local.projectLocalFiles([], config, current, () => 99)).toEqual([])
  })

  test('rejects absent, metadata substitutes, invalid types, counts, sizes and duplicates', () => {
    const file = new File(['abc'], 'seed.txt')
    for (const value of [
      undefined,
      null,
      {},
      [{ name: 'seed.txt', size: 3 }],
      [file, file],
      [new File(['x'], 'bad.png')],
      [new File(['123456789'], 'large.txt')],
      Array.from({ length: 4 }, (_, n) => new File(['x'], n + '.txt'))
    ]) {
      expect(local.projectLocalFiles(value, config, [], () => 1)).toBeNull()
    }
    expect(
      local.projectLocalFiles(
        [file, new File(['a'], 'other.txt')],
        { ...config, multiple: false },
        [],
        () => 1
      )
    ).toBeNull()
  })

  test('rejects accessor arrays, holes, custom keys and directory-relative files', () => {
    const file = new File(['x'], 'seed.txt')
    const getter: File[] = []
    Object.defineProperty(getter, '0', {
      get: () => {
        throw new Error('getter was read')
      }
    })
    const extra = Object.assign([file], { extra: true })
    const directory = new File(['x'], 'seed.txt')
    Object.defineProperty(directory, 'webkitRelativePath', { value: 'folder/seed.txt' })
    const hole: File[] = []
    hole.length = 1
    for (const value of [getter, hole, extra, [directory]]) {
      expect(local.projectLocalFiles(value, config, [], () => 1)).toBeNull()
    }
  })
})

describe('controlled rich text AST projection', () => {
  test('clones supported AST data without treating text as markup', () => {
    const value = document()
    const projected = projectRichText(value)
    expect(projected).toEqual(value)
    expect(projected).not.toBe(value)
    expect(projectRichText({ type: 'doc', blocks: [] })).toEqual({ type: 'doc', blocks: [] })
    expect(RICH_TEXT_CONTROLLED_RUNTIME).not.toContain('innerHTML')
  })

  test('accepts every reviewed block and safe mark', () => {
    const children = [inline('safe', [{ type: 'bold' }, { type: 'link', href: '/guide' }])]
    const value = {
      type: 'doc',
      blocks: [
        { type: 'paragraph', align: 'center', children },
        { type: 'heading', level: 3, align: 'right', children },
        { type: 'blockquote', children },
        { type: 'codeBlock', language: 'tsx', text: '<Widget />' },
        { type: 'bulletList', items: [{ children }] },
        { type: 'orderedList', items: [{ children }] }
      ]
    }
    expect(projectRichText(value)).toEqual(value)
  })

  test('rejects HTML, unsafe URLs, duplicate marks, unknown keys and accessors', () => {
    for (const href of [
      // oxlint-disable-next-line eslint/no-script-url -- Intentional rejected AST payload.
      'javascript:alert(1)',
      'data:text/html,x',
      '//evil.test',
      ' https://x.test',
      'https://x.test\n'
    ]) {
      const value = document()
      value.blocks[0].children = [inline('link', [{ type: 'link', href }])]
      expect(projectRichText(value)).toBeNull()
    }
    expect(
      projectRichText({ type: 'doc', blocks: [{ type: 'html', value: '<script>' }] })
    ).toBeNull()
    expect(projectRichText({ ...document(), extra: true })).toBeNull()
    const value = document()
    value.blocks[0].children = [inline('x', [{ type: 'bold' }, { type: 'bold' }])]
    expect(projectRichText(value)).toBeNull()
    let reads = 0
    const getter = Object.defineProperty({ type: 'doc' }, 'blocks', {
      get: () => {
        reads++
        return []
      },
      enumerable: true
    })
    expect(projectRichText(getter)).toBeNull()
    expect(reads).toBe(0)
  })

  test('enforces structural and aggregate quotas', () => {
    const value = document()
    value.blocks[0].children = [inline('x'.repeat(2001))]
    expect(projectRichText(value)).toBeNull()
    expect(
      projectRichText({
        type: 'doc',
        blocks: Array.from({ length: 65 }, () => document().blocks[0])
      })
    ).toBeNull()
    expect(
      projectRichText({
        type: 'doc',
        blocks: Array.from({ length: 13 }, () => ({
          type: 'paragraph',
          align: 'left',
          children: [inline('x'.repeat(2000))]
        }))
      })
    ).toBeNull()
    expect(
      projectRichText({
        type: 'doc',
        blocks: [{ type: 'codeBlock', language: '<script>', text: '' }]
      })
    ).toBeNull()
  })
})
