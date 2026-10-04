import { describe, expect, test } from 'bun:test'

import { vueRichTextFixture } from '#tests/helpers/compiler/components/vue-rich-text/fixture'
import { richTextDocument as doc } from '#tests/helpers/compiler/components/vue-rich-text/runtime'
import { vueRichTextSSR } from '#tests/helpers/compiler/components/vue-rich-text/ssr'
import { typeCheckDataModules } from '#tests/helpers/compiler/modules/data-grid/typecheck'

describe('actual generated Vue RichText SFC', () => {
  test('renders SSR read-only form JSON and fails closed on invalid bound AST without touching DOM', async () => {
    const output = await vueRichTextSSR({
      valueBound: true,
      value: doc('<script>literal</script>'),
      name: 'document'
    })
    expect(output).toContain('aria-readonly="true"')
    expect(output).toContain('contenteditable="false"')
    expect(output).toContain('name="document"')
    expect(output).not.toContain('<script>literal</script>')
    expect(output).not.toContain('Rich text unavailable.')
    const unavailable = await vueRichTextSSR({ valueBound: true, value: undefined })
    expect(unavailable).toContain('Rich text unavailable.')
    expect(unavailable).toMatch(/<input[^>]*type="hidden"[^>]*disabled/)
  })

  test('typechecks direct listeners and v-model:value using the real emitted SFC', () => {
    const files = vueRichTextFixture()
    expect(() => typeCheckDataModules({ files, warnings: [] }, 'vue')).not.toThrow()
  }, 35000)
})
