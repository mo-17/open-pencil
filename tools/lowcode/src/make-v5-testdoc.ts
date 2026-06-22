import { BUILTIN_IO_FORMATS, IORegistry } from '@open-pencil/core/io'
import { SceneGraph } from '@open-pencil/core/scene-graph'

const graph = new SceneGraph()
const pageId = graph.getPages()[0].id

// --- SWITCH (#1): larger box so the slide tween is easy to see on click ---
graph.createNode('SWITCH', pageId, {
  name: 'Switch (click me)',
  x: 60,
  y: 60,
  width: 96,
  height: 48,
  interactiveProps: { checked: false }
})

// --- RADIO group, FREE-positioned (#2 ACK 4): options stack with spacing ---
graph.createNode('RADIO', pageId, {
  name: 'Radio (FREE)',
  x: 60,
  y: 150,
  width: 220,
  height: 130,
  interactiveProps: { options: ['Male', 'Female', 'Other'], groupName: 'gender', value: 'Male' }
})

// --- CHECKBOX group, FREE-positioned (#2 ACK 5): multi-select array ---
graph.createNode('CHECKBOX', pageId, {
  name: 'Checkbox group (FREE)',
  x: 320,
  y: 150,
  width: 220,
  height: 130,
  interactiveProps: { options: ['Apple', 'Banana', 'Cherry'] }
})

// --- RADIO group, auto-layout HORIZONTAL (#2 ACK 6): direction respected ---
graph.createNode('RADIO', pageId, {
  name: 'Radio (auto-layout row)',
  x: 60,
  y: 320,
  width: 260,
  height: 60,
  layoutMode: 'HORIZONTAL',
  itemSpacing: 20,
  paddingTop: 12,
  paddingRight: 12,
  paddingBottom: 12,
  paddingLeft: 12,
  interactiveProps: { options: ['Yes', 'No'], groupName: 'confirm', value: 'Yes' }
})

const io = new IORegistry(BUILTIN_IO_FORMATS)
const result = await io.writeDocument('fig', graph)
const out = `${import.meta.dir}/../../../packages/demos/lowcode/lowcode-v5-test.fig`
await Bun.write(out, result.data as Uint8Array)
console.log(`wrote ${out}`)
