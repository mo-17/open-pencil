// realmachine -- 综合真机验证文档,覆盖 §7(responsive)/§8(components·nested·
// override)/§9(i18n·ICU plural)/§10(workflow·toast·condition·clipboard)。
//
// 两条验证路径(preview 编译 i18n OFF,故 §9 需导出验证):
//   §7/§8/§10 → `bun run build:packages && bun run tauri dev`,打开本文件,看 Demo 页:
//       - §8: "DEEP OVERRIDE ✓" / "Text override ✓" 渲染正确;clean 实例显示主控件
//       - §10: 点 "Save" 弹绿色 toast;连点只弹一条(去重);点 "Add" 计数+1
//       - §7: 视口 ≥md 显示 "Desktop ≥md";<md 显示 "Mobile <md"(拖窄看切换)
//   §9 i18n → 导出后 serve,切 LocaleSwitcher 到 ar:整页 RTL + 阿语;到 fr:法语:
//       `bun open-pencil build packages/demos/lowcode/lowcode-realmachine-test.fig --i18n --locale ar --locale fr -o /tmp/rm && npx serve /tmp/rm`
//
// Layout: the "Demo" page holds one auto-layout column of labelled sections; the
// COMPONENT masters (Card / Panel) live on a separate "Components" page so they
// don't overlap the demo at the canvas origin.
//
//   bun tools/lowcode/src/make/realmachine-testdoc.ts

import { BUILTIN_IO_FORMATS, IORegistry } from '@open-pencil/core/io'
import { SceneGraph } from '@open-pencil/core/scene-graph'
import type { ActionDef, Color, Fill, SceneNode, WorkflowDef } from '@open-pencil/core/scene-graph'
import { fontManager } from '@open-pencil/core/text'

await fontManager.loadFont('Inter', 'Regular')
await fontManager.loadFont('Inter', 'SemiBold')

const graph = new SceneGraph()
// Page 1 = the clean demo surface; component masters live on a separate page so
// they don't overlap the demo at the canvas origin.
const pageId = graph.getPages()[0].id
graph.updateNode(pageId, { name: 'Demo' })
const libId = graph.addPage('Components').id

const rgb = (r: number, g: number, b: number): Color => ({ r, g, b, a: 1 })
const solid = (c: Color): Fill => ({ type: 'SOLID', color: c, opacity: 1, visible: true })
const WHITE = rgb(1, 1, 1)
const INK = rgb(0.1, 0.1, 0.12)
const BLUE = rgb(0.2, 0.45, 0.95)

// A vertical auto-layout column that hugs its content height and keeps a fixed
// width (FIXED counter axis + AUTO primary axis) — the section card shape.
function col(parent: string, name: string, w: number, fill?: Color): SceneNode {
  return graph.createNode('FRAME', parent, {
    name,
    width: w,
    height: 60,
    layoutMode: 'VERTICAL',
    itemSpacing: 10,
    paddingTop: 14,
    paddingBottom: 14,
    paddingLeft: 14,
    paddingRight: 14,
    primaryAxisSizingMode: 'AUTO',
    counterAxisSizingMode: 'FIXED',
    fills: fill ? [solid(fill)] : []
  })
}

function text(parent: string, content: string, opts: Partial<SceneNode> = {}): SceneNode {
  return graph.createNode('TEXT', parent, {
    text: content,
    width: 348,
    height: 22,
    fontFamily: 'Inter',
    fontSize: 15,
    fills: [solid(INK)],
    ...opts
  })
}

function deepText(rootId: string): SceneNode {
  const stack = [...graph.getChildren(rootId)]
  while (stack.length > 0) {
    const n = stack.pop()
    if (!n) continue
    if (n.type === 'TEXT') return n
    stack.push(...graph.getChildren(n.id))
  }
  throw new Error('no TEXT descendant')
}

// ── document-level lowcode config (root) ─────────────────────────────────────
const workflows: WorkflowDef[] = [
  {
    id: 'wf-notify',
    name: 'Notify',
    params: ['msg'],
    paramDefaults: { msg: '"Saved!"' },
    optionalParams: ['msg'],
    actions: [{ id: 'wf-toast', kind: 'toast', messageExpr: 'msg', variant: 'success' }]
  }
]
graph.updateNode(graph.rootId, {
  lowcodeDocumentState: [{ id: 'ds-count', name: 'count', type: 'number', defaultValue: 0 }],
  lowcodeTranslations: {
    ar: { Welcome: 'مرحبا', Save: 'حفظ', Add: 'إضافة' },
    fr: { Welcome: 'Bienvenue', Save: 'Enregistrer', Add: 'Ajouter' }
  },
  lowcodeWorkflows: workflows
})

// ── §8 reusable components (on the separate "Components" page) ────────────────
// Inner card component.
const inner = graph.createNode('COMPONENT', libId, {
  name: 'Card',
  x: 40,
  y: 40,
  width: 200,
  height: 44,
  layoutMode: 'VERTICAL',
  paddingTop: 10,
  paddingBottom: 10,
  paddingLeft: 12,
  paddingRight: 12,
  fills: [solid(rgb(0.92, 0.95, 1))]
})
graph.createNode('TEXT', inner.id, {
  name: 'Label',
  text: 'Card label',
  width: 176,
  height: 20,
  fontFamily: 'Inter',
  fontSize: 14,
  fills: [solid(INK)]
})
// Outer panel component that nests a clean instance of Inner (§8 v9 target).
const outer = graph.createNode('COMPONENT', libId, {
  name: 'Panel',
  x: 300,
  y: 40,
  width: 224,
  height: 70,
  layoutMode: 'VERTICAL',
  paddingTop: 10,
  paddingBottom: 10,
  paddingLeft: 10,
  paddingRight: 10,
  fills: [solid(rgb(0.97, 0.97, 0.97))]
})
const innerRefInOuter = graph.createInstance(inner.id, outer.id)
if (!innerRefInOuter) throw new Error('nested instance failed')

// ── Demo page root (the only node on the Demo page) ──────────────────────────
const root = graph.createNode('FRAME', pageId, {
  name: 'Demo',
  x: 40,
  y: 40,
  width: 420,
  height: 1000,
  layoutMode: 'VERTICAL',
  itemSpacing: 16,
  paddingTop: 20,
  paddingBottom: 20,
  paddingLeft: 20,
  paddingRight: 20,
  primaryAxisSizingMode: 'AUTO',
  counterAxisSizingMode: 'FIXED',
  fills: [solid(WHITE)]
})

// ===== §8 components (extraction + nesting + overrides) =====
// §8 v11 makes INSTANCE.overrides round-trip through .fig, so deep / text
// overrides now survive a save and render correctly from the file.
const s8 = col(root.id, '§8', 380, rgb(0.99, 0.99, 0.99))
text(s8.id, '§8 components / nesting / override', { fontWeight: 600, fills: [solid(BLUE)] })
// clean Panel instance → <Panel/> (Panel nests a <Card/>, proving cross-component reuse)
graph.createInstance(outer.id, s8.id)
// deep-override Panel instance: override the Label INSIDE the nested Card (§8 v9 → inline)
const deep = graph.createInstance(outer.id, s8.id)
if (deep) {
  const lbl = deepText(deep.id)
  graph.updateNode(lbl.id, { text: 'DEEP OVERRIDE ✓' })
  deep.overrides = { [`${lbl.id}:text`]: 'DEEP OVERRIDE ✓' }
}
// direct text-override Card instance (§8 v2 → title prop)
const textOv = graph.createInstance(inner.id, s8.id)
if (textOv) {
  const lbl = graph.getChildren(textOv.id)[0]
  graph.updateNode(lbl.id, { text: 'Text override ✓' })
  textOv.overrides = { [`${lbl.id}:text`]: 'Text override ✓' }
}

// ===== §9 i18n =====
const s9 = col(root.id, '§9', 380, rgb(0.99, 0.99, 0.99))
text(s9.id, '§9 i18n (export with --i18n to verify)', { fontWeight: 600, fills: [solid(BLUE)] })
text(s9.id, 'Welcome') // translatable: ar→مرحبا, fr→Bienvenue
text(s9.id, '{count, plural, one {# new message} other {# new messages}}') // §9 v6 plural on docState count

// ===== §10 workflow / toast / state =====
const s10 = col(root.id, '§10', 380, rgb(0.99, 0.99, 0.99))
text(s10.id, '§10 workflow / toast / docState', { fontWeight: 600, fills: [solid(BLUE)] })
// Save → callWorkflow with omitted arg → paramDefault "Saved!" → success toast
const saveBtn = graph.createNode('BUTTON', s10.id, {
  name: 'SaveBtn',
  width: 160,
  height: 40,
  interactiveProps: { text: 'Save' },
  fills: [solid(BLUE)]
})
const saveActions: ActionDef[] = [{ id: 'cw', kind: 'callWorkflow', workflowId: 'wf-notify' }]
graph.updateNode(saveBtn.id, { events: { onClick: saveActions } })
// Add → increment docState count (drives the §9 plural text)
const addBtn = graph.createNode('BUTTON', s10.id, {
  name: 'AddBtn',
  width: 160,
  height: 40,
  interactiveProps: { text: 'Add' },
  fills: [solid(rgb(0.2, 0.7, 0.4))]
})
const addActions: ActionDef[] = [
  { id: 'inc', kind: 'setVariable', targetName: 'count', valueExpr: '$prev + 1' },
  {
    id: 'cond',
    kind: 'condition',
    condExpr: 'count > 2',
    consequent: [{ id: 'ct', kind: 'toast', messageExpr: '"Many!"', variant: 'info' }]
  }
]
graph.updateNode(addBtn.id, { events: { onClick: addActions } })

// ===== §7 responsive =====
const s7 = col(root.id, '§7', 380, rgb(0.99, 0.99, 0.99))
text(s7.id, '§7 responsive (resize the viewport)', { fontWeight: 600, fills: [solid(BLUE)] })
// base-visible, hidden at ≥md (§7 v1 hide-direction)
text(s7.id, 'Mobile <md', { responsiveOverrides: { md: { visible: false } } })
// base-hidden, shown at ≥md (§7 v2 re-show)
text(s7.id, 'Desktop ≥md', { visible: false, responsiveOverrides: { md: { visible: true } } })

// ── write ────────────────────────────────────────────────────────────────────
const io = new IORegistry(BUILTIN_IO_FORMATS)
const result = await io.writeDocument('fig', graph)
const out = `${import.meta.dir}/../../../../packages/demos/lowcode/lowcode-realmachine-test.fig`
await Bun.write(out, result.data as Uint8Array)
console.log('wrote', out, (result.data as Uint8Array).length, 'bytes')
