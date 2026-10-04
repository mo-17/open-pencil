import { describe, expect, test } from 'bun:test'

import { projectFlutterLayout } from '#compiler/adapters/flutter/layout'
import { emitFlutterWrap } from '#compiler/adapters/flutter/wrap'
import { collectLayoutFields } from '#compiler/ir/collect/layout'

import { compile, withDefaults } from '@open-pencil/compiler'
import {
  captureFlutterPreviewSnapshot,
  compileFlutterPreviewSnapshot,
  validateFlutterPreviewSnapshot
} from '@open-pencil/compiler/flutter-preview'
import { exportFigFile, parseFigFile } from '@open-pencil/core/io/formats/fig'
import { SceneGraph, type LowcodePageViewportV1, type SceneNode } from '@open-pencil/scene-graph'

function fixture(
  properties: Partial<SceneNode> = {},
  mode: LowcodePageViewportV1['mode'] | 'legacy' = 'responsive'
) {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  if (mode !== 'legacy') graph.updateNode(page.id, { lowcodePageViewport: { version: 1, mode } })
  const screen = graph.createNode('FRAME', page.id, {
    width: 360,
    height: 740,
    layoutMode: 'VERTICAL'
  })
  const frame = graph.createNode('FRAME', screen.id, {
    width: 280,
    height: 240,
    layoutMode: 'HORIZONTAL',
    layoutWrap: 'WRAP',
    itemSpacing: 12,
    counterAxisSpacing: 16,
    ...properties
  })
  for (let index = 0; index < 3; index++)
    graph.createNode('RECTANGLE', frame.id, { width: 120, height: 40 })
  return { graph, page, frame }
}

function output(scene: ReturnType<typeof fixture>) {
  const compiled = compile({
    graph: scene.graph,
    pageIds: [scene.page.id],
    options: withDefaults({ target: 'flutter', router: 'none', packageName: 'native_wrap_runs' })
  })
  const source = [...compiled.files]
    .filter(([path]) => path.startsWith('lib/pages/') && path.endsWith('.dart'))
    .map(([, contents]) => contents)
    .join('\n')
  return { ...compiled, source }
}

describe('Flutter adaptive Wrap run distribution', () => {
  test.each(['HORIZONTAL', 'VERTICAL'] as const)(
    '%s distinguishes AUTO and SPACE_BETWEEN without altering existing alignments or spacing',
    (layoutMode) => {
      for (const [counterAxisAlignContent, native] of [
        ['AUTO', 'start'],
        ['SPACE_BETWEEN', 'spaceBetween']
      ] as const) {
        const scene = fixture({
          layoutMode,
          counterAxisAlignContent,
          primaryAxisAlign: 'CENTER',
          counterAxisAlign: 'MAX'
        })
        const before = structuredClone([...scene.graph.nodes])
        const compiled = output(scene)
        expect(compiled.source).toContain('runAlignment: WrapAlignment.' + native)
        expect(compiled.source).toContain('alignment: WrapAlignment.center')
        expect(compiled.source).toContain('crossAxisAlignment: WrapCrossAlignment.end')
        expect(compiled.source).toContain('spacing: 12, runSpacing: 16')
        expect(compiled.source).toContain(
          'direction: Axis.' + (layoutMode === 'HORIZONTAL' ? 'horizontal' : 'vertical')
        )
        expect([...scene.graph.nodes]).toEqual(before)
      }
    }
  )

  test.each(['AUTO', 'SPACE_BETWEEN'] as const)(
    'preserves authored %s in base IR and all resolved responsive intervals',
    (counterAxisAlignContent) => {
      const scene = fixture({
        counterAxisAlignContent,
        responsiveOverrides: {
          compact: { layoutMode: 'VERTICAL', itemSpacing: 8 },
          sm: { width: 300 },
          md: { width: 320 },
          lg: { width: 340 },
          xl: { itemSpacing: 20 }
        }
      })
      const before = structuredClone([...scene.graph.nodes])
      const fields = collectLayoutFields(scene.frame, scene.graph)
      expect(fields.layout.counterAxisAlignContent).toBe(counterAxisAlignContent)
      expect(fields.responsiveLayout).toHaveLength(5)
      for (const range of fields.responsiveLayout ?? []) {
        expect(range.layout.counterAxisAlignContent).toBe(counterAxisAlignContent)
        expect(range.layout.layoutMode).toBe(range.minWidth < 1280 ? 'VERTICAL' : 'HORIZONTAL')
        expect(range.layout.itemSpacing).toBe(range.minWidth < 1280 ? 8 : 20)
      }
      expect([...scene.graph.nodes]).toEqual(before)
    }
  )

  test('accepts old IR without the optional field and retains start in both directions', () => {
    for (const layoutMode of ['HORIZONTAL', 'VERTICAL'] as const) {
      const scene = fixture({ layoutMode, counterAxisAlignContent: 'SPACE_BETWEEN' })
      const legacy = { ...collectLayoutFields(scene.frame, scene.graph).layout }
      delete legacy.counterAxisAlignContent
      const before = structuredClone(legacy)
      const warnings: unknown[] = []
      const source = emitFlutterWrap(
        ['const SizedBox(width: 120, height: 40)'],
        projectFlutterLayout({}, legacy),
        (warning) => warnings.push(warning),
        scene.frame.id
      )
      expect(source).toContain('runAlignment: WrapAlignment.start')
      expect(legacy).toEqual(before)
      expect(warnings).toEqual([])
    }
  })

  test.each(['HORIZONTAL', 'VERTICAL'] as const)(
    'preserves %s SPACE_BETWEEN through native snapshot JSON validation and compilation',
    (layoutMode) => {
      const scene = fixture({ layoutMode, counterAxisAlignContent: 'SPACE_BETWEEN' })
      const before = structuredClone([...scene.graph.nodes])
      const snapshot = captureFlutterPreviewSnapshot(scene.graph, [scene.page.id])
      const wireJSON = JSON.stringify(snapshot)
      const wire = validateFlutterPreviewSnapshot(JSON.parse(wireJSON))
      expect(
        wire.graph.nodes.find(([id]) => id === scene.frame.id)?.[1].counterAxisAlignContent
      ).toBe('SPACE_BETWEEN')
      const compiled = compileFlutterPreviewSnapshot(wire)
      const source = [...compiled.files]
        .filter(([path]) => path.startsWith('lib/pages/') && path.endsWith('.dart'))
        .map(([, contents]) => contents)
        .join('\n')
      expect(source).toContain('runAlignment: WrapAlignment.spaceBetween')
      expect(source).toContain(
        'direction: Axis.' + (layoutMode === 'HORIZONTAL' ? 'horizontal' : 'vertical')
      )
      expect([...scene.graph.nodes]).toEqual(before)
    }
  )

  test('preserves SPACE_BETWEEN through saved FIG readback and native snapshot compilation', async () => {
    const scene = fixture({ name: 'Wrap runs', counterAxisAlignContent: 'SPACE_BETWEEN' })
    const before = structuredClone([...scene.graph.nodes])
    const saved = await exportFigFile(scene.graph)
    const reopened = await parseFigFile(Uint8Array.from(saved).buffer)
    const frame = [...reopened.getAllNodes()].find((node) => node.name === 'Wrap runs')
    expect(frame?.counterAxisAlignContent).toBe('SPACE_BETWEEN')
    const page = reopened.getPages()[0]
    expect(page.lowcodePageViewport?.mode).toBe('responsive')
    const compiled = compileFlutterPreviewSnapshot(
      captureFlutterPreviewSnapshot(reopened, [page.id])
    )
    const source = [...compiled.files]
      .filter(([path]) => path.startsWith('lib/pages/') && path.endsWith('.dart'))
      .map(([, contents]) => contents)
      .join('\n')
    expect(source).toContain('runAlignment: WrapAlignment.spaceBetween')
    expect([...scene.graph.nodes]).toEqual(before)
  })

  test.each(['HORIZONTAL', 'VERTICAL'] as const)(
    'leaves adaptive %s NO_WRAP emitted files byte-identical',
    (layoutMode) => {
      const scene = fixture({ layoutMode, layoutWrap: 'NO_WRAP' })
      const before = output(scene)
      scene.graph.updateNode(scene.frame.id, { counterAxisAlignContent: 'SPACE_BETWEEN' })
      const after = output(scene)
      expect([...after.files]).toEqual([...before.files])
      expect(after.source).not.toContain('runAlignment:')
    }
  )

  test.each(['legacy', 'fixed', 'fit-width'] as const)(
    'keeps %s policy output isolated from adaptive Wrap run distribution',
    (policy) => {
      const scene = fixture({}, policy)
      const before = output(scene)
      scene.graph.updateNode(scene.frame.id, { counterAxisAlignContent: 'SPACE_BETWEEN' })
      const after = output(scene)
      expect([...after.files]).toEqual([...before.files])
      expect(after.source).not.toContain('runAlignment:')
    }
  )
})
