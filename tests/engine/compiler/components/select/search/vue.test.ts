import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { vueAdapter } from '#compiler/adapters/vue'
import type { IRElement, IRTree } from '#compiler/ir/types'
import { createSSRApp } from 'vue'
import { compileScript, compileTemplate, parse } from 'vue/compiler-sfc'
import { renderToString } from 'vue/server-renderer'

import { withDefaults } from '@open-pencil/compiler'

function project(): Map<string, string | Uint8Array> {
  const select: IRElement = {
    kind: 'element',
    sourceId: 'selection',
    tag: 'select',
    className: '',
    attrs: { defaultValue: 'b' },
    selectFeatures: { showSearch: true, virtual: true },
    children: ['a', 'b'].map((value) => ({
      kind: 'element',
      sourceId: value,
      tag: 'option',
      className: '',
      attrs: { value },
      children: [{ kind: 'text', value }]
    }))
  }
  const ir: IRTree = {
    pageId: 'page',
    pageName: 'Page',
    children: [select],
    states: [],
    docStates: [],
    docStateReads: [],
    docStateWrites: [],
    usesRouteParams: false,
    warnings: []
  }
  return vueAdapter.emit(
    [ir],
    withDefaults({ packageName: 'vue-select-props', target: 'vue', devMode: false })
  ).files
}

function textFile(files: ReadonlyMap<string, string | Uint8Array>, path: string): string {
  const content = files.get(path)
  if (typeof content !== 'string') throw new Error(`Missing generated text file: ${path}`)
  return content
}

describe('Vue enhanced SELECT runtime boundary', () => {
  test('the emitted tag resolves to a component rather than literal template text', () => {
    const source = textFile(project(), 'src/pages/index.vue')
    const parsed = parse(source, { filename: 'index.vue' })
    const script = compileScript(parsed.descriptor, { id: 'page' })
    if (!parsed.descriptor.template) throw new Error('Generated page has no Vue template')
    const template = compileTemplate({
      source: parsed.descriptor.template.content,
      filename: 'index.vue',
      id: 'page',
      compilerOptions: { bindingMetadata: script.bindings }
    })
    expect(parsed.errors).toEqual([])
    expect(template.errors).toEqual([])
    expect(template.code).toContain('$setup["OpEnhancedSelect"]')
    expect(template.code).not.toContain('createTextVNode("<')
  })

  test('real Vue prop resolution keeps omitted values uncontrolled through SSR', async () => {
    const files = project()
    const directory = mkdtempSync(join(tmpdir(), 'openpencil-vue-select-ssr-'))
    try {
      const componentDirectory = join(directory, 'src/components/open-pencil')
      mkdirSync(componentDirectory, { recursive: true })
      mkdirSync(join(directory, 'src/lib'), { recursive: true })
      mkdirSync(join(directory, 'node_modules'), { recursive: true })
      symlinkSync(
        dirname(fileURLToPath(import.meta.resolve('vue/package.json'))),
        join(directory, 'node_modules/vue'),
        'dir'
      )
      const filename = join(componentDirectory, 'OpenPencilSelect.ts')
      const descriptor = parse(textFile(files, 'src/components/open-pencil/OpenPencilSelect.vue'), {
        filename: 'OpenPencilSelect.vue'
      }).descriptor
      const compiled = compileScript(descriptor, { id: 'select', inlineTemplate: true })
      writeFileSync(filename, compiled.content)
      writeFileSync(
        join(directory, 'src/lib/open-pencil-select.ts'),
        textFile(files, 'src/lib/open-pencil-select.ts')
      )
      const { default: component } = await import(pathToFileURL(filename).href)
      const options = [
        { value: 'a', label: 'Alpha' },
        { value: 'b', label: 'Beta' }
      ]
      for (const authored of [{}, { defaultValue: 'b' }, { value: false }]) {
        const captured: Record<string, unknown> = {}
        const app = createSSRApp(component, {
          options,
          showSearch: true,
          virtual: true,
          ...authored
        })
        app.mixin({
          created() {
            Object.assign(captured, this.$props)
          }
        })
        const html = await renderToString(app)
        expect(captured.value).toBe('value' in authored ? authored.value : undefined)
        expect(captured.defaultValue).toBe(
          'defaultValue' in authored ? authored.defaultValue : undefined
        )
        expect(html).toContain('<button')
        expect(html).toContain('<select')
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
