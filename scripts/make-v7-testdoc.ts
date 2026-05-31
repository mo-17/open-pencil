// v7 — Figma-compat FILL verification. Generates a .fig whose layout is correct
// ONLY if the new Figma-native child-fill emit (commit 30a2d81) works: cross-axis
// FILL must serialize as native `stackChildAlignSelf=STRETCH` so an external
// reader (Figma / app.openpencil.dev, which ignore our `lowcode/*` pluginData)
// stretches the element. Open this file in Figma (or app.openpencil.dev) and
// check each labeled region:
//   A — fill-width buttons in a column: the blue buttons span the full card
//       width; only the gray "FIXED 120" button stays narrow. If the fix were
//       missing, every blue button would collapse to 120px (THE bug).
//   B — fill-main button in a row: the blue button grows to eat the leftover
//       width beside the fixed gray one (control — already worked via layoutGrow).
//
//   bun scripts/make-v7-testdoc.ts

import { BUILTIN_IO_FORMATS, IORegistry } from '@open-pencil/core/io'
import { SceneGraph } from '@open-pencil/core/scene-graph'
import type { Color, Fill, Stroke, SceneGraph as Graph } from '@open-pencil/core/scene-graph'

const graph = new SceneGraph()
const pageId = graph.getPages()[0].id

const rgb = (r: number, g: number, b: number): Color => ({ r, g, b, a: 1 })
const solid = (c: Color): Fill => ({ type: 'SOLID', color: c, opacity: 1, visible: true })
const stroke = (c: Color, weight: number): Stroke => ({
  color: c,
  weight,
  opacity: 1,
  visible: true,
  align: 'OUTSIDE'
})
const BLUE = rgb(0.23, 0.51, 0.96)
const GRAY = rgb(0.85, 0.87, 0.9)
const PANEL = rgb(0.97, 0.98, 1)
const INK = rgb(0.1, 0.12, 0.16)
const WHITE = rgb(1, 1, 1)

function label(text: string, x: number, y: number): void {
  graph.createNode('TEXT', pageId, {
    name: `label: ${text}`,
    x, y, width: 460, height: 18,
    text, fontFamily: 'Inter', fontWeight: 600, fontSize: 13,
    fills: [solid(INK)]
  })
}

// A button = a HORIZONTAL auto-layout (so it's a container child, the case the
// fix targets) with a centered text label. `fillWidth` => primaryAxisSizing=FILL,
// which for a row child in a column parent is the CROSS (width) axis → must emit
// native STRETCH. Otherwise a fixed 120px width.
function button(parent: string, g: Graph, name: string, text: string, fillWidth: boolean) {
  const btn = g.createNode('FRAME', parent, {
    name,
    width: 120, height: 44,
    layoutMode: 'HORIZONTAL',
    primaryAxisSizing: fillWidth ? 'FILL' : 'FIXED',
    counterAxisSizing: 'HUG',
    primaryAxisAlign: 'CENTER',
    counterAxisAlign: 'CENTER',
    paddingTop: 10, paddingRight: 16, paddingBottom: 10, paddingLeft: 16,
    cornerRadius: 8,
    fills: [solid(fillWidth ? BLUE : GRAY)]
  })
  g.createNode('TEXT', btn.id, {
    name: `${name}-label`,
    width: 88, height: 20,
    text, fontFamily: 'Inter', fontWeight: 600, fontSize: 14,
    textAlignHorizontal: 'CENTER',
    fills: [solid(fillWidth ? WHITE : INK)]
  })
  return btn
}

// A: fill-width buttons stacked in a column
label('A - fill-width buttons: blue span the card; only "FIXED 120" stays narrow', 40, 40)
const cardA = graph.createNode('FRAME', pageId, {
  name: 'A-Column',
  x: 40, y: 64, width: 320, height: 260,
  layoutMode: 'VERTICAL', itemSpacing: 12,
  paddingTop: 16, paddingRight: 16, paddingBottom: 16, paddingLeft: 16,
  primaryAxisSizing: 'FIXED', counterAxisSizing: 'FIXED',
  fills: [solid(PANEL)],
  strokes: [stroke(GRAY, 1)]
})
button(cardA.id, graph, 'A-Btn-Primary', 'Sign in', true)
button(cardA.id, graph, 'A-Btn-Secondary', 'Create account', true)
button(cardA.id, graph, 'A-Btn-Fixed', 'FIXED 120', false)

// B: fill-main button in a row (control - already native via layoutGrow)
label('B - fill-main: blue grows to fill the row beside the fixed gray button', 40, 348)
const rowB = graph.createNode('FRAME', pageId, {
  name: 'B-Row',
  x: 40, y: 372, width: 420, height: 76,
  layoutMode: 'HORIZONTAL', itemSpacing: 12,
  paddingTop: 16, paddingRight: 16, paddingBottom: 16, paddingLeft: 16,
  primaryAxisSizing: 'FIXED', counterAxisSizing: 'FIXED',
  fills: [solid(PANEL)],
  strokes: [stroke(GRAY, 1)]
})
// fill-main in a row parent = the editor sets primaryAxisSizing=FILL AND layoutGrow=1
const grow = button(rowB.id, graph, 'B-Btn-Grow', 'Search', true)
grow.layoutGrow = 1
button(rowB.id, graph, 'B-Btn-Fixed', 'Go', false)

const io = new IORegistry(BUILTIN_IO_FORMATS)
const result = await io.writeDocument('fig', graph)
const out = `${import.meta.dir}/../lowcode-v7-test.fig`
await Bun.write(out, result.data as Uint8Array)
console.log(`wrote ${out} (${(result.data as Uint8Array).byteLength} bytes)`)
