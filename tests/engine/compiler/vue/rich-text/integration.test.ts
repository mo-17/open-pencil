import { expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { createRichTextModuleFrameOverrides } from '@open-pencil/core/plugins'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

test('Vue compiler emits the reviewed RichText SFC without an unsupported-module warning', () => {
  const graph = makeSceneGraph()
  const pageId = firstPageId(graph)
  graph.createNode('FRAME', pageId, createRichTextModuleFrameOverrides())
  const output = compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({ target: 'vue', router: 'none', devMode: false })
  })
  expect(output.files.has('src/__openpencil_rich_text.vue')).toBe(true)
  expect(output.warnings.filter((warning) => warning.code === 'vue-module-unsupported')).toEqual([])
})
