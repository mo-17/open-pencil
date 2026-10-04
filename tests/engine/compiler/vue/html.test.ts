import { describe, expect, test } from 'bun:test'

import { htmlSandboxSource } from '#compiler/adapters/html/source'
import { vueAdapter } from '#compiler/adapters/vue'
import { buildOpenPencilVueHTML } from '#compiler/adapters/vue/modules/html'
import type { IRElement, IRTree } from '#compiler/ir/types'
import { compileScript, compileTemplate, parse } from 'vue/compiler-sfc'

import { withDefaults } from '@open-pencil/compiler'
import { buildHTMLSandboxDocument, HTML_MODULE_SANDBOX_CSP } from '@open-pencil/core/plugins'

import { HTML_SANDBOX_PROBE, vueHTMLFixture } from '#tests/helpers/compiler/modules/html/fixture'

describe('Vue HTML module isolation contract', () => {
  test('executes the shared CSP document builder with exact Core parity', () => {
    const source = new Bun.Transpiler({ loader: 'ts' }).transformSync(htmlSandboxSource(false))
    const build = new Function(source + '\nreturn buildSandboxDocument')() as (
      html: string
    ) => string
    for (const html of ['', HTML_SANDBOX_PROBE, '</script><script>parent.pwned=true</script>']) {
      expect(build(html)).toBe(buildHTMLSandboxDocument(html))
    }
    expect(build(HTML_SANDBOX_PROBE)).toContain(HTML_MODULE_SANDBOX_CSP)
  })

  test('compiles a real SFC and a graph-authored module without fallback or new dependencies', () => {
    const source = buildOpenPencilVueHTML()
    const parsed = parse(source, { filename: 'HTML.vue' })
    expect(parsed.errors).toEqual([])
    const script = compileScript(parsed.descriptor, { id: 'html-sandbox' })
    const template = compileTemplate({
      source: parsed.descriptor.template?.content ?? '',
      filename: 'HTML.vue',
      id: 'html-sandbox',
      compilerOptions: { bindingMetadata: script.bindings }
    })
    expect(template.errors).toEqual([])
    const output = vueHTMLFixture()
    expect(output.warnings).toEqual([])
    expect(output.files.get('src/__openpencil_html.vue')).toBe(source)
    expect(output.files.get('src/pages/index.vue')).toContain('Host overlay')
    const pkg = JSON.parse(output.files.get('package.json') as string) as {
      dependencies: Record<string, string>
    }
    expect(Object.keys(pkg.dependencies)).toEqual(['vue'])
  })

  test('ordinary rawHtml remains an empty static shell with an explicit warning', () => {
    const node: IRElement = {
      kind: 'element',
      sourceId: 'unreviewed',
      tag: 'div',
      className: '',
      attrs: {},
      children: [],
      rawHtml: '<script>hostDanger()</script>'
    }
    const tree: IRTree = {
      pageId: 'page',
      pageName: 'Page',
      usesRouteParams: false,
      children: [node],
      states: [],
      docStates: [],
      docStateReads: [],
      docStateWrites: [],
      warnings: []
    }
    const output = vueAdapter.emit([tree], withDefaults({ target: 'vue', router: 'none' }), [])
    expect(output.warnings.map((warning) => warning.code)).toContain('vue-raw-html-unsupported')
    expect(output.files.get('src/pages/index.vue')).not.toContain('hostDanger')
    expect(output.files.has('src/__openpencil_html.vue')).toBe(false)
  })
})
