import { describe, expect, test } from 'bun:test'

import { buildOpenPencilRichTextComponent } from '#compiler/adapters/react/modules/rich-text'
import { buildOpenPencilUploadButtonComponent } from '#compiler/adapters/react/modules/upload-button'
import { buildOpenPencilVueUploadButton } from '#compiler/adapters/vue/modules/upload-button'
import { compileScript, compileTemplate, parse } from 'vue/compiler-sfc'

import { controlledLocalDataFixture } from '#tests/helpers/compiler/components/controlled-local-data/fixture'

const transpiler = new Bun.Transpiler({ loader: 'tsx' })

describe('controlled local component caller sources', () => {
  test('React API and callers transpile without file state stores or transfer runtimes', () => {
    for (const module of ['upload', 'rich-text'] as const) {
      const files = controlledLocalDataFixture('react', module)
      expect(() => transpiler.transformSync(files.get('src/App.tsx') as string)).not.toThrow()
    }
    expect(() => transpiler.transformSync(buildOpenPencilUploadButtonComponent())).not.toThrow()
    expect(() => transpiler.transformSync(buildOpenPencilRichTextComponent())).not.toThrow()
    const upload = buildOpenPencilUploadButtonComponent()
    for (const forbidden of [
      'fetch(',
      'FileReader',
      '.arrayBuffer(',
      '.text(',
      'localStorage',
      'setDocState',
      'CustomEvent'
    ])
      expect(upload).not.toContain(forbidden)
  })

  test('Vue supports ordinary update:files listener props and generates a valid SFC', () => {
    const files = controlledLocalDataFixture('vue', 'upload')
    for (const source of [files.get('src/App.vue') as string, buildOpenPencilVueUploadButton()]) {
      const parsed = parse(source)
      expect(parsed.errors).toEqual([])
      const script = compileScript(parsed.descriptor, { id: 'controlled-local' })
      expect(() => new Bun.Transpiler({ loader: 'ts' }).transformSync(script.content)).not.toThrow()
      const template = compileTemplate({
        source: parsed.descriptor.template?.content ?? '',
        filename: 'caller.vue',
        id: 'controlled-local',
        compilerOptions: { bindingMetadata: script.bindings }
      })
      expect(template.errors).toEqual([])
    }
    expect(files.has('src/lowcode-state.ts')).toBe(true)
    expect(files.get('src/lowcode-state.ts')).not.toContain('localStorage')
    expect(files.get('src/lowcode-state.ts')).not.toContain('__opDocStore')
  })
})
