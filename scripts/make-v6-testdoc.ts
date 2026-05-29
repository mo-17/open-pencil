import { BUILTIN_IO_FORMATS, IORegistry } from '@open-pencil/core/io'
import { SceneGraph } from '@open-pencil/core/scene-graph'
import type { NodeType } from '@open-pencil/core/scene-graph'

const graph = new SceneGraph()
const pageId = graph.getPages()[0].id

// One of each interactive type with EMPTY interactiveProps so each field is
// authored live via the new §3.v6 InteractivePropsPanel. BUTTON is included to
// confirm its text editor still lives in TextBindingPanel (decision e), not the
// generic panel.
const types: NodeType[] = [
  'INPUT',
  'TEXTAREA',
  'CHECKBOX',
  'SWITCH',
  'DATEPICKER',
  'SELECT',
  'RADIO',
  'BUTTON'
]

let y = 40
for (const type of types) {
  graph.createNode(type, pageId, { name: `${type} (edit in Properties)`, x: 40, y })
  y += 80
}

const io = new IORegistry(BUILTIN_IO_FORMATS)
const result = await io.writeDocument('fig', graph)
const out = `${import.meta.dir}/../lowcode-v6-test.fig`
await Bun.write(out, result.data as Uint8Array)
console.log(`wrote ${out}`)
