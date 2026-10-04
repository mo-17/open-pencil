import { describe, expect, test } from 'bun:test'

import { buildComponentRegistry } from '@open-pencil/compiler/ir/collect/components'
import { collectTree } from '@open-pencil/compiler/ir/collect/tree'
import type { IRComponentRef, IRElement, IRResponsiveLayout } from '@open-pencil/compiler/ir/types'
import { LOWCODE_PAGE_VIEWPORT_PLUGIN_KEY } from '@open-pencil/lowcode'
import { SceneGraph } from '@open-pencil/scene-graph'

import { expectDefined } from '#tests/helpers/assert'

function scene() {
  const graph = new SceneGraph()
  const page = expectDefined(graph.getPages()[0], 'default page')
  return { graph, page }
}

function atWidth(layouts: IRResponsiveLayout[] | undefined, width: number): IRResponsiveLayout {
  return expectDefined(
    layouts?.find(
      (entry) => width >= entry.minWidth && (entry.maxWidth === undefined || width < entry.maxWidth)
    ),
    'responsive range'
  )
}

describe('page viewport collection and semantic layout', () => {
  test('omits page viewport metadata for legacy pages', () => {
    const { graph, page } = scene()
    graph.createNode('FRAME', page.id, { width: 360, height: 740 })
    const ir = collectTree(graph, page.id)
    expect(Object.hasOwn(ir, 'pageViewport')).toBe(false)
    expect(ir.warnings).toEqual([])
  })

  test('measures non-zero union origin, ignores hidden boxes and includes responsive re-show', () => {
    const { graph, page } = scene()
    graph.updateNode(page.id, {
      lowcodePageViewport: { version: 1, mode: 'fit-width' },
      fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 }, opacity: 1, visible: true }]
    })
    graph.createNode('FRAME', page.id, { x: 20, y: 30, width: 360, height: 740 })
    graph.createNode('RECTANGLE', page.id, {
      x: -20,
      y: 10,
      width: 40,
      height: 50,
      visible: false,
      responsiveOverrides: { compact: { visible: true } }
    })
    graph.createNode('RECTANGLE', page.id, {
      x: -1000,
      y: -1000,
      width: 5000,
      height: 5000,
      visible: false
    })
    graph.createNode('LINE', page.id, { x: 20, y: 100, width: 300, height: 0 })
    expect(collectTree(graph, page.id).pageViewport).toEqual({
      version: 1,
      mode: 'fit-width',
      originX: -20,
      originY: 10,
      designWidth: 400,
      designHeight: 760,
      backgroundColor: '#FF0000'
    })
  })

  test('warns and retains legacy output for inert future metadata and unusable geometry', () => {
    const { graph, page } = scene()
    graph.updateNode(page.id, {
      pluginData: [
        {
          pluginId: 'open-pencil',
          key: LOWCODE_PAGE_VIEWPORT_PLUGIN_KEY,
          value: '{"version":2,"mode":"responsive"}'
        }
      ]
    })
    graph.createNode('FRAME', page.id, { width: 360, height: 740 })
    const unsupported = collectTree(graph, page.id)
    expect(unsupported.pageViewport).toBeUndefined()
    expect(unsupported.warnings.some((warning) => warning.code === 'page-viewport-invalid')).toBe(
      true
    )
    graph.updateNode(page.id, {
      pluginData: [],
      lowcodePageViewport: { version: 1, mode: 'responsive' }
    })
    const frame = expectDefined(graph.getChildren(page.id)[0], 'frame')
    graph.updateNode(frame.id, { width: Number.NaN })
    const malformed = collectTree(graph, page.id)
    expect(malformed.pageViewport).toBeUndefined()
    expect(
      malformed.warnings.some((warning) => warning.code === 'page-viewport-bounds-invalid')
    ).toBe(true)
    graph.deleteNode(frame.id)
    expect(
      collectTree(graph, page.id).warnings.some(
        (warning) => warning.code === 'page-viewport-bounds-invalid'
      )
    ).toBe(true)
  })

  test('resolves every crossover cumulatively with compact taking final precedence', () => {
    const { graph, page } = scene()
    const frame = graph.createNode('FRAME', page.id, {
      width: 360,
      height: 740,
      layoutMode: 'NONE',
      responsiveOverrides: {
        compact: { layoutMode: 'VERTICAL', itemSpacing: 12, layoutPositioning: 'AUTO' },
        sm: { itemSpacing: 20, paddingLeft: 16 },
        md: { paddingRight: 24 },
        lg: { itemSpacing: 32 },
        xl: { layoutMode: 'HORIZONTAL', itemSpacing: 40 }
      }
    })
    const child = graph.createNode('TEXT', frame.id, {
      x: 32,
      y: 48,
      width: 180,
      height: 40,
      text: 'Responsive child',
      responsiveOverrides: {
        sm: { fontSize: 18 },
        md: { counterAxisSizing: 'FILL' },
        compact: { primaryAxisSizing: 'HUG', fontSize: 16 }
      }
    })
    const ir = collectTree(graph, page.id)
    const root = ir.children[0] as IRElement
    const text = root.children[0] as IRElement
    expect(root.layout?.position).toBe('absolute')
    expect(text.layout?.position).toBe('absolute')
    expect(root.responsiveLayout).toHaveLength(5)
    for (const width of [0, 639.999, 640, 767.999, 768, 1023.999, 1024, 1279.999]) {
      const rootAt = atWidth(root.responsiveLayout, width)
      const childAt = atWidth(text.responsiveLayout, width)
      expect(rootAt.layout.position).toBe('flow')
      expect(rootAt.layout.layoutMode).toBe('VERTICAL')
      expect(rootAt.layout.itemSpacing).toBe(12)
      expect(childAt.layout.position).toBe('flow')
      expect(childAt.layout.parentLayoutMode).toBe('VERTICAL')
      expect(childAt.layout.heightSizing).toBe('HUG')
      expect(childAt.layout.fontSize).toBe(16)
      expect(childAt.className).toContain('text-base')
      expect(childAt.className).not.toMatch(/(?:sm|md|lg|xl|max-xl):/)
      expect(childAt.layout.widthSizing).toBe(width < 768 ? 'FIXED' : 'FILL')
      expect(rootAt.layout.paddingLeft).toBe(width < 640 ? 0 : 16)
      expect(rootAt.layout.paddingRight).toBe(width < 768 ? 0 : 24)
    }
    const desktop = atWidth(root.responsiveLayout, 1280)
    expect(desktop.maxWidth).toBeUndefined()
    expect(desktop.layout.layoutMode).toBe('HORIZONTAL')
    expect(desktop.layout.itemSpacing).toBe(40)
    expect(desktop.layout.paddingLeft).toBe(16)
    expect(atWidth(text.responsiveLayout, 1280).layout.fontSize).toBe(18)
    expect(graph.getNode(frame.id)?.layoutMode).toBe('NONE')
    expect(graph.getNode(child.id)?.fontSize).not.toBe(16)
  })

  test('registered component instances retain semantic positioning and their parent breakpoint', () => {
    const { graph, page } = scene()
    const master = graph.createNode('COMPONENT', page.id, { name: 'Card', width: 200, height: 80 })
    graph.createNode('TEXT', master.id, { text: 'Card content' })
    const frame = graph.createNode('FRAME', page.id, {
      width: 360,
      height: 740,
      responsiveOverrides: { compact: { layoutMode: 'VERTICAL' } }
    })
    const instance = graph.createInstance(master.id, frame.id)
    const ir = collectTree(graph, page.id, buildComponentRegistry(graph))
    const root = ir.children.find(
      (entry) => entry.kind === 'element' && entry.sourceId === frame.id
    ) as IRElement
    const ref = root.children[0] as IRComponentRef
    expect(ref.kind).toBe('componentRef')
    expect(ref.sourceId).toBe(instance.id)
    expect(ref.layout?.position).toBe('absolute')
    expect(atWidth(ref.responsiveLayout, 390).layout.position).toBe('flow')
  })
})
