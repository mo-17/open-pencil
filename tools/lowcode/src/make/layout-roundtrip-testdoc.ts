// Generates a .fig exercising all 5 .fig layout round-trip fixes, laid out in
// labeled regions so a human can open it in the desktop, eyeball the layout,
// then File→Save and reopen to confirm nothing shifts. Each region's field is
// the one that previously got lost on save→reopen:
//   C1 FILL axis sizing · C2 strokesIncludedInLayout · C3 GRID tracks+placement
//   C4 counterAxisAlignContent SPACE_BETWEEN · C5 nested HUG child position
//
//   bun tools/lowcode/src/make/layout-roundtrip-testdoc.ts

import { BUILTIN_IO_FORMATS, IORegistry } from '@open-pencil/core/io'
import { SceneGraph } from '@open-pencil/core/scene-graph'
import type { Color, Fill, Stroke } from '@open-pencil/core/scene-graph'

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
const GREEN = rgb(0.13, 0.7, 0.46)
const AMBER = rgb(0.96, 0.62, 0.07)
const INK = rgb(0.1, 0.12, 0.16)

function label(text: string, x: number, y: number): void {
  graph.createNode('TEXT', pageId, {
    name: `label: ${text}`,
    x,
    y,
    width: 360,
    height: 18,
    text,
    fontFamily: 'Inter',
    fontWeight: 600,
    fontSize: 13,
    fills: [solid(INK)]
  })
}

// ── C1: FILL axis sizing ─────────────────────────────────────────────────────
// FillChild (FILL) should stretch to fill the row; FixedChild stays 80 wide.
// If FILL is lost on reopen it collapses to its stored width → visible gap.
label('C1 — FILL sizing: blue child fills the row, gray stays 80px', 40, 40)
const fillRow = graph.createNode('FRAME', pageId, {
  name: 'C1-FillRow',
  x: 40,
  y: 64,
  width: 420,
  height: 64,
  layoutMode: 'HORIZONTAL',
  itemSpacing: 8,
  paddingTop: 8,
  paddingRight: 8,
  paddingBottom: 8,
  paddingLeft: 8,
  primaryAxisSizing: 'FIXED',
  counterAxisSizing: 'FIXED',
  fills: [solid(rgb(0.97, 0.98, 1))],
  strokes: [stroke(GRAY, 1)]
})
graph.createNode('FRAME', fillRow.id, {
  name: 'FillChild',
  width: 100,
  height: 48,
  primaryAxisSizing: 'FILL',
  counterAxisSizing: 'FILL',
  fills: [solid(BLUE)]
})
graph.createNode('FRAME', fillRow.id, {
  name: 'FixedChild-80',
  width: 80,
  height: 48,
  fills: [solid(GRAY)]
})

// ── C2: strokesIncludedInLayout + C5: nested HUG child ───────────────────────
// Thick OUTSIDE border counts toward layout; the HUG badge must sit at the
// padding offset (20,20), not pinned to the card origin (0,0).
label('C2 — border counts in layout · C5 — HUG badge at padding, not (0,0)', 40, 168)
const card = graph.createNode('FRAME', pageId, {
  name: 'C2-BorderCard',
  x: 40,
  y: 192,
  width: 280,
  height: 160,
  layoutMode: 'VERTICAL',
  itemSpacing: 12,
  paddingTop: 20,
  paddingRight: 20,
  paddingBottom: 20,
  paddingLeft: 20,
  primaryAxisSizing: 'FIXED',
  counterAxisSizing: 'FIXED',
  strokesIncludedInLayout: true,
  fills: [solid(rgb(1, 1, 1))],
  strokes: [stroke(INK, 6)]
})
graph.createNode('FRAME', card.id, {
  name: 'C5-HugBadge',
  width: 120,
  height: 44,
  layoutMode: 'HORIZONTAL',
  primaryAxisSizing: 'HUG',
  counterAxisSizing: 'HUG',
  paddingTop: 8,
  paddingRight: 12,
  paddingBottom: 8,
  paddingLeft: 12,
  fills: [solid(GREEN)]
})
graph.createNode('FRAME', card.id, {
  name: 'CardBody',
  width: 240,
  height: 40,
  fills: [solid(GRAY)]
})

// ── C4: WRAP + counterAxisAlignContent SPACE_BETWEEN ─────────────────────────
// 6 tiles wrap into 3 rows inside a 220-wide / 320-tall box; SPACE_BETWEEN
// pushes the rows to the top/middle/bottom. Lost → rows bunch at the top.
label('C4 — WRAP rows spread with SPACE_BETWEEN', 40, 392)
const wrap = graph.createNode('FRAME', pageId, {
  name: 'C4-WrapRow',
  x: 40,
  y: 416,
  width: 220,
  height: 320,
  layoutMode: 'HORIZONTAL',
  itemSpacing: 12,
  paddingTop: 12,
  paddingRight: 12,
  paddingBottom: 12,
  paddingLeft: 12,
  layoutWrap: 'WRAP',
  counterAxisAlignContent: 'SPACE_BETWEEN',
  primaryAxisSizing: 'FIXED',
  counterAxisSizing: 'FIXED',
  fills: [solid(rgb(0.97, 0.98, 1))],
  strokes: [stroke(GRAY, 1)]
})
for (let i = 0; i < 6; i++) {
  graph.createNode('FRAME', wrap.id, {
    name: `tile-${i + 1}`,
    width: 84,
    height: 60,
    fills: [solid(i % 2 === 0 ? AMBER : BLUE)]
  })
}

// ── C3: GRID tracks + explicit child placement ───────────────────────────────
// 3 columns (1fr / 80px / auto) × 2 rows, gaps 12/8. PlacedCell is pinned to
// column 2 row 1; the rest auto-flow. Lost → degrades to NONE and cells stack.
label('C3 — GRID 1fr/80px/auto × 2 rows; green cell pinned to col2 row1', 320, 392)
const grid = graph.createNode('FRAME', pageId, {
  name: 'C3-GridPanel',
  x: 320,
  y: 416,
  width: 320,
  height: 220,
  layoutMode: 'GRID',
  gridTemplateColumns: [
    { sizing: 'FR', value: 1 },
    { sizing: 'FIXED', value: 80 },
    { sizing: 'AUTO', value: 0 }
  ],
  gridTemplateRows: [
    { sizing: 'FR', value: 1 },
    { sizing: 'FR', value: 1 }
  ],
  gridColumnGap: 12,
  gridRowGap: 8,
  paddingTop: 12,
  paddingRight: 12,
  paddingBottom: 12,
  paddingLeft: 12,
  fills: [solid(rgb(0.97, 0.98, 1))],
  strokes: [stroke(GRAY, 1)]
})
graph.createNode('FRAME', grid.id, {
  name: 'PlacedCell',
  width: 80,
  height: 40,
  gridPosition: { column: 2, row: 1, columnSpan: 1, rowSpan: 1 },
  fills: [solid(GREEN)]
})
for (let i = 0; i < 4; i++) {
  graph.createNode('FRAME', grid.id, {
    name: `cell-${i + 1}`,
    width: 80,
    height: 40,
    fills: [solid(i % 2 === 0 ? AMBER : BLUE)]
  })
}

const io = new IORegistry(BUILTIN_IO_FORMATS)
const result = await io.writeDocument('fig', graph)
const out = `${import.meta.dir}/../../../../packages/demos/lowcode/layout-roundtrip-test.fig`
await Bun.write(out, result.data as Uint8Array)
console.log(`wrote ${out} (${(result.data as Uint8Array).byteLength} bytes)`)
