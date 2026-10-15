import { describe, expect, test } from 'bun:test'

import { responsiveStyleVariants } from '#design-jsx/export/responsive'

import { compileTailwindCSS } from '@open-pencil/dom-css'
import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

import {
  collectResponsiveTailwindClasses,
  collectTailwindClasses
} from '#core/io/formats/jsx/index'

function fixture(properties: Partial<SceneNode> = {}) {
  const graph = new SceneGraph()
  const frame = graph.createNode('FRAME', graph.getPages()[0].id, {
    width: 400,
    height: 200,
    layoutMode: 'VERTICAL',
    itemSpacing: 8,
    ...properties
  })
  return { graph, frame }
}

/** Read only the simple gap utility rules generated for this fixture, in CSS source order. */
function gapAtWidth(css: string, width: number): number {
  let value = Number.NaN
  const utilities = css.slice(css.indexOf('@layer utilities {'))
  const rules = utilities.matchAll(
    /(?:@media \(width (>=|<) ([\d.]+)rem\) \{\s*)?\.[^\s]+ \{\s*gap: ([^;]+);\s*\}/g
  )
  for (const [, comparator, boundary, gap] of rules) {
    const threshold = Number(boundary) * 16
    if (comparator === '>=' && width < threshold) continue
    if (comparator === '<' && width >= threshold) continue
    const pixels = /^([\d.]+)px$/.exec(gap)
    const spacing = /^calc\(var\(--spacing\) \* ([\d.]+)\)$/.exec(gap)
    if (pixels) value = Number(pixels[1])
    else if (spacing) value = Number(spacing[1]) * 4
    else if (gap === '0px') value = 0
    else throw new Error('Unexpected fixture gap declaration')
  }
  return value
}

async function gapCSS(frame: SceneNode, graph: SceneGraph): Promise<string> {
  const classes = [
    ...collectTailwindClasses(frame, graph),
    ...collectResponsiveTailwindClasses(frame, graph)
  ].filter((value) => /^(?:(?:sm|md|lg|xl|max-xl):)?gap-(?![xy]-)/.test(value))
  return compileTailwindCSS(classes)
}

describe('compact overlap in actual Tailwind CSS', () => {
  test('compact wins conflicting sm/md/lg fields and restores the min-width chain at xl', async () => {
    const { graph, frame } = fixture({
      responsiveOverrides: {
        compact: { itemSpacing: 16 },
        sm: { itemSpacing: 20 },
        md: { itemSpacing: 24 },
        lg: { itemSpacing: 32 }
      }
    })
    const css = await gapCSS(frame, graph)
    for (const width of [390, 639.999, 640, 767.999, 768, 1023.999, 1024, 1279.999])
      expect(gapAtWidth(css, width)).toBe(16)
    for (const width of [1280, 1440]) expect(gapAtWidth(css, width)).toBe(32)
    expect(collectResponsiveTailwindClasses(frame, graph)).toContain('max-xl:gap-4')
  })

  test('compact equal to base still shields the field from min-width overrides', async () => {
    const { graph, frame } = fixture({
      responsiveOverrides: {
        compact: { itemSpacing: 8 },
        md: { itemSpacing: 24 }
      }
    })
    const css = await gapCSS(frame, graph)
    expect(gapAtWidth(css, 768)).toBe(8)
    expect(gapAtWidth(css, 1279.999)).toBe(8)
    expect(gapAtWidth(css, 1280)).toBe(24)
  })

  test('min-width equal to compact must persist after max-xl leaves the cascade', async () => {
    const { graph, frame } = fixture({
      responsiveOverrides: {
        compact: { itemSpacing: 16 },
        sm: { itemSpacing: 16 }
      }
    })
    const css = await gapCSS(frame, graph)
    expect(gapAtWidth(css, 639.999)).toBe(16)
    expect(gapAtWidth(css, 640)).toBe(16)
    expect(gapAtWidth(css, 1280)).toBe(16)
    expect(collectResponsiveTailwindClasses(frame, graph)).toContain('xl:gap-4')
  })

  test('independent min-width values continue below compact and explicit xl wins above it', async () => {
    const { graph, frame } = fixture({
      responsiveOverrides: {
        compact: { paddingLeft: 16 },
        sm: { itemSpacing: 20 },
        md: { itemSpacing: 24 },
        xl: { itemSpacing: 40 }
      }
    })
    const css = await gapCSS(frame, graph)
    for (const [width, gap] of [
      [390, 8],
      [640, 20],
      [768, 24],
      [1279.999, 24],
      [1280, 40]
    ])
      expect(gapAtWidth(css, width)).toBe(gap)
  })
})

describe('compact overlap graph context and desktop restoration', () => {
  test('child positioning follows compact parent precedence and restores desktop geometry without an xl override', () => {
    const { graph, frame } = fixture({
      layoutMode: 'FREE',
      responsiveOverrides: {
        compact: { layoutMode: 'VERTICAL' },
        sm: { layoutMode: 'HORIZONTAL' }
      }
    })
    const child = graph.createNode('TEXT', frame.id, { x: 32, y: 48, width: 120, height: 40 })
    const before = JSON.stringify([...graph.getAllNodes()])
    const classes = collectResponsiveTailwindClasses(child, graph)
    expect(classes).toContain('max-xl:static')
    expect(classes.some((value) => value.startsWith('sm:'))).toBe(false)
    const snapshots = responsiveStyleVariants(child, graph, (node, context) => ({
      parentDirection: context.getNode(node.parentId ?? '')?.layoutMode ?? '',
      width: String(node.width)
    }))
    expect(snapshots.find((entry) => entry.prefix === 'sm')?.style.parentDirection).toBe('VERTICAL')
    expect(snapshots.find((entry) => entry.prefix === 'xl')?.style.parentDirection).toBe(
      'HORIZONTAL'
    )
    expect(JSON.stringify([...graph.getAllNodes()])).toBe(before)
  })

  test('axis-derived min-width utilities are reset at xl even when their desktop result equals base', () => {
    const { graph, frame } = fixture({
      layoutMode: 'HORIZONTAL',
      responsiveOverrides: { compact: { layoutMode: 'VERTICAL' } }
    })
    const child = graph.createNode('TEXT', frame.id, {
      width: 120,
      height: 40,
      responsiveOverrides: { sm: { counterAxisSizing: 'FILL' } }
    })
    // The child itself changes axis so primary/counter sizing maps to different dimensions.
    graph.updateNode(child.id, {
      layoutMode: 'HORIZONTAL',
      responsiveOverrides: {
        compact: { layoutMode: 'VERTICAL' },
        sm: { counterAxisSizing: 'FILL' }
      }
    })
    const classes = collectResponsiveTailwindClasses(child, graph)
    expect(classes).toContain('sm:w-full')
    expect(classes).toContain('xl:w-30')
    expect(classes).toContain('xl:h-full')
  })

  test('GRID child tracks affect parent snapshots and restore the min chain after compact', () => {
    const { graph, frame } = fixture()
    const child = graph.createNode('FRAME', frame.id, {
      layoutMode: 'GRID',
      gridTemplateColumns: [
        { sizing: 'FR', value: 1 },
        { sizing: 'FR', value: 1 }
      ],
      responsiveOverrides: {
        compact: { gridTemplateColumns: [{ sizing: 'FR', value: 1 }] },
        md: { gridTemplateColumns: [{ sizing: 'FR', value: 1 }] }
      }
    })
    const variants = responsiveStyleVariants(frame, graph, (_node, context) => ({
      columns: String(context.getNode(child.id)?.gridTemplateColumns.length)
    }))
    expect(variants.find((entry) => entry.prefix === 'md')?.style.columns).toBe('1')
    const desktop = variants.find((entry) => entry.prefix === 'xl')
    expect(desktop?.previous.columns).toBe('2')
    expect(desktop?.style.columns).toBe('1')
    expect(collectResponsiveTailwindClasses(child, graph)).toContain('xl:grid-cols-1')
  })

  test('equal compact/min visibility and clipping still restore their authored desktop states', () => {
    const { graph, frame } = fixture({
      clipsContent: true,
      responsiveOverrides: {
        compact: { visible: false, clipsContent: false },
        sm: { visible: false, clipsContent: false }
      }
    })
    const classes = collectResponsiveTailwindClasses(frame, graph)
    expect(classes).toContain('max-xl:hidden')
    expect(classes).toContain('max-xl:overflow-visible')
    expect(classes).not.toContain('sm:hidden')
    expect(classes).toContain('xl:hidden')
    expect(classes).toContain('xl:overflow-visible')
  })
})
