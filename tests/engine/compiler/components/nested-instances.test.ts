import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { createElement, type ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { compile, withDefaults } from '@open-pencil/compiler'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

/**
 * Phase 3 §8 v9 — nested-instance override propagation. A clean nested instance
 * still emits `<Inner/>`. When an OUTER instance overrides a node that lives
 * INSIDE that nested `<Inner/>` ref, the override can't be threaded through the
 * ref, so the outer instance falls back to INLINING (its own clone subtree
 * carries the materialized override value, rendering correctly). Other clean
 * outer instances keep emitting `<Outer/>` (reuse preserved). An override ON the
 * nested instance node itself stays a ref (handled by the §8 v6 className prop).
 */
function makeNestedGraph() {
  const graph = makeSceneGraph()
  const pageId = firstPageId(graph)
  const inner = graph.createNode('COMPONENT', pageId, {
    name: 'Inner',
    width: 100,
    height: 30,
    layoutMode: 'VERTICAL'
  })
  graph.createNode('TEXT', inner.id, { name: 'Label', text: 'Hi', width: 80, height: 20 })
  const outer = graph.createNode('COMPONENT', pageId, {
    name: 'Outer',
    width: 120,
    height: 50,
    layoutMode: 'VERTICAL'
  })
  // a clean nested instance of Inner lives inside the Outer master
  graph.createInstance(inner.id, outer.id)
  return { graph, pageId, outer }
}

/** Find the first TEXT descendant of `rootId` (the deep Label clone). */
function deepText(graph: SceneGraph, rootId: string): SceneNode {
  const stack = [...graph.getChildren(rootId)]
  while (stack.length > 0) {
    const node = stack.pop()
    if (!node) continue
    if (node.type === 'TEXT') return node
    stack.push(...graph.getChildren(node.id))
  }
  throw new Error('no TEXT descendant found')
}

describe('compile — nested-instance override (Phase 3 §8 v9)', () => {
  test('a deep override inlines the outer instance; clean instances keep <Outer/>', () => {
    const { graph, pageId, outer } = makeNestedGraph()
    graph.createInstance(outer.id, pageId) // clean → stays <Outer/>
    const deep = graph.createInstance(outer.id, pageId)
    if (deep) {
      const label = deepText(graph, deep.id)
      graph.updateNode(label.id, { text: 'Bye' })
      deep.overrides = { [`${label.id}:text`]: 'Bye' }
    }

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'comp' })
    })
    const app = out.files.get('src/App.tsx') as string

    // Inner + Outer are still extracted (the clean instance + Outer body reuse them)
    expect(out.files.has('src/components/Inner.tsx')).toBe(true)
    expect(out.files.has('src/components/Outer.tsx')).toBe(true)
    // the deep-override value renders — it is NOT silently dropped (the bug)
    expect(app).toContain('>Bye</p>')
    // master ref (1) + clean instance ref (1) = 2; the deep instance inlined
    // (were it still a ref the count would be 3)
    expect((app.match(/<Outer\b/g) ?? []).length).toBe(2)
  })

  test('an override on the nested instance node itself stays a ref (not deep)', () => {
    const { graph, pageId, outer } = makeNestedGraph()
    const inst = graph.createInstance(outer.id, pageId)
    if (inst) {
      const innerClone = graph.getChildren(inst.id).find((c: SceneNode) => c.type === 'INSTANCE')
      if (innerClone) {
        graph.updateNode(innerClone.id, { opacity: 0.5 })
        inst.overrides = { [`${innerClone.id}:opacity`]: 0.5 }
      }
    }

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'comp' })
    })
    const app = out.files.get('src/App.tsx') as string
    // the override targets the nested instance node directly → §8 v6 className
    // prop on the <Outer/> ref, so the instance is NOT inlined (master + instance
    // = 2 refs; an inlined instance would leave only the master = 1)
    expect((app.match(/<Outer\b/g) ?? []).length).toBe(2)
  })

  test('when every outer instance is deep-overridden the master is not extracted', () => {
    const { graph, pageId, outer } = makeNestedGraph()
    const deep = graph.createInstance(outer.id, pageId) // the only Outer instance
    if (deep) {
      const label = deepText(graph, deep.id)
      graph.updateNode(label.id, { text: 'Solo' })
      deep.overrides = { [`${label.id}:text`]: 'Solo' }
    }

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'comp' })
    })
    const app = out.files.get('src/App.tsx') as string
    // no ref-able Outer instance → Outer is not registered / extracted
    expect(out.files.has('src/components/Outer.tsx')).toBe(false)
    expect(app).not.toContain('<Outer')
    // the inlined subtree still renders the override
    expect(app).toContain('>Solo</p>')
  })
})

/**
 * Phase 3 §8 v10 — prune registered-but-unreferenced components. A component is
 * registered globally (it has an instance somewhere in the graph) but if the
 * compiled page(s) never reference it, emitting its module is dead weight. The
 * adapter prunes to the transitively-reachable set.
 */
describe('compile — unreferenced component pruning (Phase 3 §8 v10)', () => {
  function makeTwoPageGraph() {
    const graph = makeSceneGraph()
    const pageA = firstPageId(graph)
    graph.createNode('TEXT', pageA, { text: 'Home', width: 80, height: 20 })
    // page B carries the Widget master + an instance; it is a separate page
    const pageB = graph.addPage('Other')
    const widget = graph.createNode('COMPONENT', pageB.id, {
      name: 'Widget',
      width: 100,
      height: 30,
      layoutMode: 'VERTICAL'
    })
    graph.createNode('TEXT', widget.id, { name: 'Label', text: 'W', width: 80, height: 20 })
    graph.createInstance(widget.id, pageB.id)
    return { graph, pageA, pageB }
  }

  test('a component used only on a non-compiled page is pruned', () => {
    const { graph, pageA } = makeTwoPageGraph()
    const out = compile({ graph, pageIds: [pageA], options: withDefaults({ packageName: 'comp' }) })
    // Widget is registered (instance on page B) but page A never references it
    expect(out.files.has('src/components/Widget.tsx')).toBe(false)
  })

  test('the same component IS emitted when its page is compiled (control)', () => {
    const { graph, pageA, pageB } = makeTwoPageGraph()
    const out = compile({
      graph,
      pageIds: [pageA, pageB.id],
      options: withDefaults({ packageName: 'comp' })
    })
    // page B references Widget → reachable → emitted
    expect(out.files.has('src/components/Widget.tsx')).toBe(true)
  })
})

/** Load the generated sibling modules; missing component imports fail at actual render time. */
async function renderNestedComponent(
  files: ReadonlyMap<string, string | Uint8Array>,
  props: Record<string, string> = {}
): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'openpencil-nested-components-'))
  try {
    await mkdir(join(directory, 'node_modules'), { recursive: true })
    await symlink(
      dirname(fileURLToPath(import.meta.resolve('react/package.json'))),
      join(directory, 'node_modules/react'),
      'dir'
    )
    for (const [path, value] of files) {
      if (
        typeof value !== 'string' ||
        !path.startsWith('src/components/') ||
        !path.endsWith('.tsx')
      )
        continue
      const destination = join(directory, path)
      await mkdir(dirname(destination), { recursive: true })
      await writeFile(destination, value)
    }
    const module = (await import(
      pathToFileURL(join(directory, 'src/components/Outer.tsx')).href
    )) as {
      default: ComponentType<Record<string, string>>
    }
    return renderToStaticMarkup(createElement(module.default, props))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

describe('compile — nested reusable React modules execute', () => {
  test('a reusable component renders repeated nested references from sibling modules', async () => {
    const { graph, outer } = makeNestedGraph()
    const nested = graph.getChildren(outer.id).find((node) => node.type === 'INSTANCE')
    if (!nested?.componentId) throw new Error('Missing nested component')
    graph.createInstance(nested.componentId, outer.id)
    const usePage = graph.addPage('Use')
    graph.createInstance(outer.id, usePage.id)
    const output = compile({
      graph,
      pageIds: [usePage.id],
      options: withDefaults({ packageName: 'nested-runtime' })
    })
    const html = await renderNestedComponent(output.files)
    expect((html.match(/>Hi<\/p>/g) ?? []).length).toBe(2)
  })

  test('every variant imports its distinct nested reference and renders the selected branch', async () => {
    const graph = makeSceneGraph()
    const definitionsPage = firstPageId(graph)
    const outer = graph.createNode('COMPONENT_SET', definitionsPage, { name: 'Outer' })
    const variants = ['First', 'Second'].map((state) => {
      const inner = graph.createNode('COMPONENT', definitionsPage, {
        name: `${state}Inner`,
        width: 100,
        height: 30,
        layoutMode: 'VERTICAL'
      })
      graph.createNode('TEXT', inner.id, {
        text: `${state} leaf`,
        width: 90,
        height: 20
      })
      const variant = graph.createNode('COMPONENT', outer.id, {
        name: `State=${state}`,
        width: 120,
        height: 40,
        layoutMode: 'VERTICAL'
      })
      graph.createInstance(inner.id, variant.id)
      return variant
    })
    const first = variants[0]
    if (!first) throw new Error('Missing first variant')
    const usePage = graph.addPage('Use')
    graph.createInstance(first.id, usePage.id)
    const output = compile({
      graph,
      pageIds: [usePage.id],
      options: withDefaults({ packageName: 'nested-variant-runtime' })
    })
    const firstHTML = await renderNestedComponent(output.files)
    expect(firstHTML).toContain('>First leaf</p>')
    expect(firstHTML).not.toContain('>Second leaf</p>')
    const secondHTML = await renderNestedComponent(output.files, { state: 'Second' })
    expect(secondHTML).toContain('>Second leaf</p>')
    expect(secondHTML).not.toContain('>First leaf</p>')
  })
})
