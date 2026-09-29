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
if (mode === '--create-fixture') {
  const { editor, graph } = componentTemplateFixture(undefined, 'zh-CN')
  try {
    writeFileSync(path, await exportFigFile(graph))
  } finally {
    editor.dispose()
  }
}
const bytes = new Uint8Array(readFileSync(path))
const graph = await parseFigFile(bytes.buffer)
const output = compile({
  graph,
  pageIds: graph.getPages().map((page) => page.id),
  options: withDefaults({
    target,
    lang: 'zh-CN',
    devMode: false,
    router: target === 'vue' ? 'vue-router-v4' : 'react-router-v6'
  })
})
if (output.warnings.length) throw new Error(JSON.stringify(output.warnings))
process.stdout.write(
  JSON.stringify({
    files: [...output.files],
    sha256: createHash('sha256').update(bytes).digest('hex'),
    byteLength: bytes.byteLength
  })
)
