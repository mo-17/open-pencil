import { describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

/**
 * Phase 1 §1: end-to-end verification that the compiler emits absolute
 * positioning for CANVAS-direct children and that the page wrapper sets
 * up the positioning context.
 */
describe('compile — canvas-direct absolute positioning (Phase 1 §1)', () => {
  test('a BUTTON placed at (120, 80) directly on the page emits absolute + left/top', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('BUTTON', pageId, {
      x: 120,
      y: 80,
      width: 120,
      height: 40,
      interactiveProps: { text: 'Go' }
    })

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'pos-demo' })
    })

    const app = out.files.get('src/App.tsx') as string
    expect(app).toContain('<div className="relative min-h-screen">')
    expect(app).toContain('<button')
    // 120px → 30 spacing units (4px scale); 80px → 20 spacing units.
    expect(app).toMatch(/className="[^"]*\babsolute\b[^"]*"/)
    expect(app).toMatch(/className="[^"]*\bleft-30\b[^"]*"/)
    expect(app).toMatch(/className="[^"]*\btop-20\b[^"]*"/)
  })

  test('a BUTTON nested in an AutoLayout FRAME does not get absolute classes; the FRAME does', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const frame = graph.createNode('FRAME', pageId, {
      name: 'Row',
      x: 40,
      y: 60,
      width: 400,
      height: 80,
      layoutMode: 'HORIZONTAL',
      itemSpacing: 16,
      primaryAxisSizing: 'FIXED',
      counterAxisSizing: 'FIXED'
    })
    const btn = graph.createNode('BUTTON', frame.id, { interactiveProps: { text: 'Inner' } })

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'nest-demo' })
    })

    const app = out.files.get('src/App.tsx') as string
    expect(app).toContain('<div className="relative min-h-screen">')

    // The frame's <div> is the absolute container — identify it by its node id.
    const frameLine = app.split('\n').find((l) => l.includes(`data-node-id="${frame.id}"`))
    expect(frameLine).toBeDefined()
    if (!frameLine) throw new Error('frame line missing')
    expect(frameLine).toContain('absolute')
    expect(frameLine).toContain('left-10')
    expect(frameLine).toContain('top-15')
    expect(frameLine).toContain('flex')

    // The button is a flex child — no absolute / left / top on it.
    const buttonLine = app.split('\n').find((l) => l.includes(`data-node-id="${btn.id}"`))
    expect(buttonLine).toBeDefined()
    if (!buttonLine) throw new Error('button line missing')
    expect(buttonLine).not.toContain('absolute')
    expect(buttonLine).not.toMatch(/\bleft-/)
    expect(buttonLine).not.toMatch(/\btop-/)
  })

  test('empty page still emits the relative min-h-screen wrapper', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'empty-demo' })
    })

    const app = out.files.get('src/App.tsx') as string
    expect(app).toContain('<div className="relative min-h-screen">')
    expect(app).toContain('export default function App')
  })

  test('index.css safelist includes the wrapper classes (Tailwind VFS needs them)', () => {
    // Tailwind v4 vite plugin scans the FS module graph for utilities; our
    // preview iframe serves the project from an in-memory VFS, so `@source
    // inline(...)` is the *only* signal. The page wrapper's `relative` /
    // `min-h-screen` classes aren't in the IR, so the adapter must seed
    // them by hand. Regression guard for Phase 1 §1 safelist gap.
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('BUTTON', pageId, { x: 10, y: 10, width: 40, height: 20 })

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'css-demo' })
    })

    const css = out.files.get('src/index.css') as string
    expect(css).toContain('@import "tailwindcss"')
    expect(css).toMatch(/@source inline\("[^"]*\brelative\b/)
    expect(css).toMatch(/@source inline\("[^"]*\bmin-h-screen\b/)
  })

  test('index.css safelist includes wrapper classes even when the page is empty', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'empty-css-demo' })
    })

    const css = out.files.get('src/index.css') as string
    expect(css).toMatch(/@source inline\("[^"]*\brelative\b/)
    expect(css).toMatch(/@source inline\("[^"]*\bmin-h-screen\b/)
  })

  test('classes on a conditionally-rendered subtree still reach the safelist (Phase 2 §9 regression)', () => {
    // Before the IRConditional walk-through fix, `collectClassNames` early-
    // returned on non-element kinds, so the inner element's `absolute` /
    // `left-[Npx]` classes never made it into `@source inline(...)` and
    // Tailwind silently stripped them in the iframe.
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.updateNode(pageId, {
      state: [{ id: 's-flag', name: 'flag', type: 'boolean', defaultValue: true }]
    })
    graph.createNode('FRAME', pageId, {
      name: 'Conditional',
      x: 123,
      y: 77,
      width: 50,
      height: 30,
      renderCondition: 'flag'
    })

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'cond-css-demo' })
    })

    const app = out.files.get('src/App.tsx') as string
    const css = out.files.get('src/index.css') as string
    // Sanity: the conditional `&&` made it through to App.tsx.
    expect(app).toContain('{(flag) && (')
    // The inner element's positioning classes have to be safelisted.
    expect(css).toMatch(/@source inline\("[^"]*\babsolute\b/)
    expect(css).toMatch(/@source inline\("[^"]*\bleft-\[123px\]/)
  })

  test('classes inside a LIST template still reach the safelist (Phase 2 §9 regression)', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.updateNode(pageId, {
      state: [{ id: 's-users', name: 'users', type: 'array', defaultValue: [] }]
    })
    const list = graph.createNode('LIST', pageId, {
      name: 'List',
      x: 0,
      y: 0,
      width: 200,
      height: 200,
      interactiveProps: { dataSourceRef: { kind: 'stateRef', stateId: 's-users' } }
    })
    // TEXT inside a non-CANVAS parent emits flow-layout classes (not
    // `left-[Npx]`), so we assert against its w-25 width class which is
    // unique to the inner template element.
    graph.createNode('TEXT', list.id, { width: 100, height: 20, text: 'row' })

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'list-css-demo' })
    })

    const css = out.files.get('src/index.css') as string
    expect(css).toMatch(/@source inline\("[^"]*\bw-25\b/)
  })

  test('a deeply nested rectangle keeps its flow layout regardless of CANVAS-direct ancestor', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const outer = graph.createNode('FRAME', pageId, {
      name: 'Outer',
      x: 0,
      y: 0,
      width: 400,
      height: 200,
      layoutMode: 'HORIZONTAL',
      itemSpacing: 8,
      primaryAxisSizing: 'FIXED',
      counterAxisSizing: 'FIXED'
    })
    const middle = graph.createNode('FRAME', outer.id, {
      name: 'Middle',
      width: 200,
      height: 100,
      layoutMode: 'VERTICAL',
      itemSpacing: 4,
      primaryAxisSizing: 'FIXED',
      counterAxisSizing: 'FIXED'
    })
    const inner = graph.createNode('RECTANGLE', middle.id, {
      name: 'Inner',
      width: 50,
      height: 50
    })

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'deep-demo' })
    })

    const app = out.files.get('src/App.tsx') as string
    const findLine = (id: string) => app.split('\n').find((l) => l.includes(`data-node-id="${id}"`))

    // Outer is canvas-direct → absolute.
    const outerLine = findLine(outer.id)
    expect(outerLine).toBeDefined()
    if (!outerLine) throw new Error('outer line missing')
    expect(outerLine).toContain('absolute')

    // Middle and Inner stay in document/flex flow.
    const middleLine = findLine(middle.id)
    expect(middleLine).toBeDefined()
    if (!middleLine) throw new Error('middle line missing')
    expect(middleLine).not.toContain('absolute')
    const innerLine = findLine(inner.id)
    expect(innerLine).toBeDefined()
    if (!innerLine) throw new Error('inner line missing')
    expect(innerLine).not.toContain('absolute')
  })
})
