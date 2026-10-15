import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

import { compile, withDefaults } from '@open-pencil/compiler'
import { exportFigFile } from '@open-pencil/core/io/formats/fig'
import { initCodec, parseFigFile } from '@open-pencil/core/kiwi'

import { componentTemplateFixture } from './fixture'

const [target, path, mode] = process.argv.slice(2)
if ((target !== 'react' && target !== 'vue') || !path)
  throw new Error('Expected react|vue and a FIG path')
await initCodec()
const { editor, graph: sourceGraph, results } = componentTemplateFixture(undefined, 'zh-CN')
const source = {
  roots: results.map(({ rootId }) => {
    const root = sourceGraph.getNode(rootId)
    if (!root) throw new Error('Created template root missing')
    return { id: root.id, name: root.name, type: root.type }
  }),
  fields: results.flatMap(({ rootId, nodeIds }) => {
    const root = sourceGraph.getNode(rootId)
    if (!root) throw new Error('Created template root missing')
    return nodeIds.flatMap((id) => {
      const node = sourceGraph.getNode(id)
      if (!node || (node.type !== 'INPUT' && node.type !== 'TEXTAREA')) return []
      return [
        {
          id: node.id,
          rootId,
          name: root.name,
          type: node.type,
          fontSize: node.fontSize,
          lineHeight: node.lineHeight,
          height: node.height,
          padding: [node.paddingTop, node.paddingRight, node.paddingBottom, node.paddingLeft]
        }
      ]
    })
  })
}
try {
  if (mode === '--create-fixture') writeFileSync(path, await exportFigFile(sourceGraph))
} finally {
  editor.dispose()
}
const bytes = new Uint8Array(readFileSync(path))
const graph = await parseFigFile(bytes.buffer)
const output = compile({
  graph,
  pageIds: graph.getPages().map((page) => page.id),
  options: withDefaults({
    target,
    sourceLocale: 'zh-CN',
    devMode: false,
    router: target === 'vue' ? 'vue-router-v4' : 'react-router-v6'
  })
})
if (output.warnings.length) throw new Error(JSON.stringify(output.warnings))
process.stdout.write(
  JSON.stringify({
    source,
    files: [...output.files],
    sha256: createHash('sha256').update(bytes).digest('hex'),
    byteLength: bytes.byteLength
  })
)
