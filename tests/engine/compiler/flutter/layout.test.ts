import { describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

function fixture(properties: Partial<SceneNode> = {}, adaptive = true) {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  if (adaptive)
    graph.updateNode(page.id, { lowcodePageViewport: { version: 1, mode: 'responsive' } })
  const screen = graph.createNode('FRAME', page.id, {
    width: 360,
    height: 740,
    layoutMode: 'VERTICAL'
  })
  const frame = graph.createNode('FRAME', screen.id, {
    width: 280,
    height: 160,
    layoutMode: 'HORIZONTAL',
    layoutWrap: 'WRAP',
    itemSpacing: 12,
    counterAxisSpacing: 16,
    ...properties
  })
  const child = graph.createNode('RECTANGLE', frame.id, { width: 120, height: 40 })
  graph.createNode('RECTANGLE', frame.id, { width: 120, height: 80 })
  return { graph, page, frame, child }
}

function output(scene: ReturnType<typeof fixture>) {
  const compiled = compile({
    graph: scene.graph,
    pageIds: [scene.page.id],
    options: withDefaults({ target: 'flutter', router: 'none', packageName: 'native_layout' })
  })
  const source = [...compiled.files]
    .filter(([path]) => path.startsWith('lib/pages/') && path.endsWith('.dart'))
    .map(([, contents]) => contents)
    .join('\n')
  return { ...compiled, source }
}

describe('Flutter responsive Wrap native alignment', () => {
  test.each([
    ['MIN', 'start'],
    ['MAX', 'end'],
    ['CENTER', 'center'],
    ['SPACE_BETWEEN', 'spaceBetween']
  ] as const)('maps primary %s to WrapAlignment.%s in both axes', (primaryAxisAlign, native) => {
    for (const layoutMode of ['HORIZONTAL', 'VERTICAL'] as const) {
      for (const [counterAxisAlign, cross] of [
        ['MIN', 'start'],
        ['MAX', 'end'],
        ['CENTER', 'center']
      ] as const) {
        const scene = fixture({ layoutMode, primaryAxisAlign, counterAxisAlign })
        const before = structuredClone([...scene.graph.nodes])
        const compiled = output(scene)
        expect(compiled.source).toContain('alignment: WrapAlignment.' + native)
        expect(compiled.source).toContain('crossAxisAlignment: WrapCrossAlignment.' + cross)
        expect(compiled.source).toContain(
          'direction: Axis.' + (layoutMode === 'HORIZONTAL' ? 'horizontal' : 'vertical')
        )
        expect(compiled.source).toContain('spacing: 12, runSpacing: 16')
        expect([...scene.graph.nodes]).toEqual(before)
      }
    }
  })

  test.each([
    ['MIN', 'start'],
    ['MAX', 'end'],
    ['CENTER', 'center']
  ] as const)('maps counter %s to WrapCrossAlignment.%s', (counterAxisAlign, native) => {
    const compiled = output(fixture({ counterAxisAlign }))
    expect(compiled.source).toContain('crossAxisAlignment: WrapCrossAlignment.' + native)
    expect(
      compiled.warnings.some((warning) => warning.code === 'flutter-wrap-cross-axis-unsupported')
    ).toBe(false)
  })

  test.each(['STRETCH', 'BASELINE'] as const)(
    'warns and preserves natural sizing for unsupported %s',
    (counterAxisAlign) => {
      const scene = fixture({ counterAxisAlign })
      const compiled = output(scene)
      expect(compiled.source).toContain('crossAxisAlignment: WrapCrossAlignment.start')
      expect(compiled.source).not.toContain('WrapCrossAlignment.' + counterAxisAlign.toLowerCase())
      expect(compiled.warnings).toContainEqual(
        expect.objectContaining({
          code: 'flutter-wrap-cross-axis-unsupported',
          nodeId: scene.frame.id
        })
      )
    }
  )

  test('warns about explicit child alignSelf instead of silently accepting it in a Wrap', () => {
    const scene = fixture()
    scene.graph.updateNode(scene.child.id, { layoutAlignSelf: 'CENTER' })
    expect(output(scene).warnings).toContainEqual(
      expect.objectContaining({
        code: 'flutter-align-self-unsupported',
        nodeId: scene.child.id
      })
    )
  })

  test('retains the established unbounded vertical HUG fallback and diagnostic', () => {
    const scene = fixture({ layoutMode: 'VERTICAL', primaryAxisSizing: 'HUG' })
    const compiled = output(scene)
    expect(compiled.source).not.toContain('Wrap(direction: Axis.vertical')
    expect(compiled.warnings).toContainEqual(
      expect.objectContaining({
        code: 'flutter-vertical-wrap-unbounded',
        nodeId: scene.frame.id
      })
    )
  })
})

describe('Flutter responsive constraints after semantic projection', () => {
  test('raises maximums to minimums after raw IR overwrites translated classes', () => {
    const scene = fixture({ minWidth: 180, maxWidth: 120, minHeight: 60, maxHeight: 40 })
    const before = structuredClone([...scene.graph.nodes])
    const compiled = output(scene)
    expect(compiled.source).toContain(
      'BoxConstraints(minWidth: 180.0, minHeight: 60.0, maxWidth: 180.0, maxHeight: 60.0)'
    )
    expect(
      compiled.warnings.some((warning) => warning.code === 'flutter-style-constraint-normalized')
    ).toBe(true)
    expect([...scene.graph.nodes]).toEqual(before)
  })

  test('clamps negative semantic minimums and maximums to zero', () => {
    const compiled = output(fixture({ minWidth: -10, maxWidth: -5, minHeight: -8, maxHeight: -4 }))
    expect(compiled.source).toContain(
      'BoxConstraints(minWidth: 0.0, minHeight: 0.0, maxWidth: 0.0, maxHeight: 0.0)'
    )
    expect(
      compiled.warnings.some((warning) => warning.code === 'flutter-style-constraint-normalized')
    ).toBe(true)
  })

  test('omits nonfinite semantic limits instead of generating invalid or zero maximums', () => {
    const compiled = output(
      fixture({
        minWidth: Number.NaN,
        maxWidth: Infinity,
        minHeight: -Infinity,
        maxHeight: Number.NaN
      })
    )
    expect(compiled.source).not.toContain('constraints: BoxConstraints(')
    expect(compiled.source).not.toContain('NaN')
    expect(compiled.source).not.toContain('Infinity')
    expect(
      compiled.warnings.filter((warning) => warning.code === 'flutter-style-constraint-normalized')
    ).toHaveLength(4)
  })

  test('preserves finite valid limits and explicit null resets across responsive branches', () => {
    const scene = fixture({
      minWidth: 120,
      maxWidth: 280,
      minHeight: 20,
      maxHeight: 160,
      responsiveOverrides: {
        compact: { minWidth: null, maxWidth: null, minHeight: null, maxHeight: null }
      }
    })
    const compiled = output(scene)
    expect(compiled.source).toContain(
      'BoxConstraints(minWidth: 120.0, minHeight: 20.0, maxWidth: 280.0, maxHeight: 160.0)'
    )
    expect(compiled.source.match(/constraints: BoxConstraints\(/g)).toHaveLength(1)
    expect(
      compiled.warnings.some((warning) => warning.code === 'flutter-style-constraint-normalized')
    ).toBe(false)
    scene.graph.updateNode(scene.frame.id, {
      responsiveOverrides: { compact: { minWidth: 0, maxWidth: 0, minHeight: 0, maxHeight: 0 } }
    })
    const zero = output(scene)
    expect(zero.source).toContain(
      'BoxConstraints(minWidth: 0.0, minHeight: 0.0, maxWidth: 0.0, maxHeight: 0.0)'
    )
    expect(
      zero.warnings.some((warning) => warning.code === 'flutter-style-constraint-normalized')
    ).toBe(false)
  })

  test('keeps legacy and explicit fixed output identical when adaptive Wrap is unavailable', () => {
    const scene = fixture({ primaryAxisAlign: 'CENTER', counterAxisAlign: 'MAX' }, false)
    const legacy = output(scene)
    scene.graph.updateNode(scene.page.id, { lowcodePageViewport: { version: 1, mode: 'fixed' } })
    expect([...output(scene).files]).toEqual([...legacy.files])
    expect(legacy.source).not.toContain('WrapAlignment')
  })
})
