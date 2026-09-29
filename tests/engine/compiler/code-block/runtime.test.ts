import { expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { createCodeBlockModuleFrameOverrides } from '@open-pencil/core/plugins'
import { SceneGraph } from '@open-pencil/scene-graph'

import { typeCheckCompilerFiles } from '#tests/helpers/compiler/typecheck'

test.each(['react', 'vue'] as const)(
  '%s CodeBlock generated project is inert and typechecks',
  (target) => {
    const graph = new SceneGraph(),
      page = graph.getPages()[0]
    graph.createNode('FRAME', page.id, {
      ...createCodeBlockModuleFrameOverrides({
        label: '代码示例',
        code: '<script>globalThis.compromised=true</script>\n中文',
        wrapLines: true
      }),
      width: 280,
      height: 300
    })
    const output = compile({
      graph,
      pageIds: [page.id],
      options: withDefaults({ target, router: 'none', devMode: false })
    })
    expect(output.warnings).toEqual([])
    const path =
      target === 'react' ? 'src/__openpencil_code_block.tsx' : 'src/__openpencil_code_block.vue'
    const runtime = String(output.files.get(path))
    expect(runtime).toContain('data-code-text')
    expect(runtime).toContain('data-code-status')
    expect(runtime).toContain('navigator.clipboard.writeText(code)')
    expect(runtime).not.toContain('dangerouslySetInnerHTML')
    expect(runtime).not.toContain('v-html')
    expect(runtime).not.toContain('cause.message')
    typeCheckCompilerFiles(
      new Map(
        [...output.files].filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      ),
      target
    )
  },
  35000
)
