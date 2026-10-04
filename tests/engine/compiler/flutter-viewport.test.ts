import { describe, expect, test } from 'bun:test'

import {
  resolveFlutterLayout,
  projectFlutterLayout,
  prepareFlutterPageFrames
} from '#compiler/adapters/flutter/layout'
import { collectTree } from '#compiler/ir/collect/tree'
import type { IRElement } from '#compiler/ir/types'

import {
  captureFlutterPreviewSnapshot,
  compileFlutterPreviewSnapshot,
  validateFlutterPreviewSnapshot
} from '@open-pencil/compiler/flutter-preview'

import {
  compileViewportFixture,
  generatedFlutterPage,
  viewportFixture
} from '#tests/helpers/compiler/flutter-viewport'

describe('Flutter page viewport', () => {
  test('native preview JSON preserves explicit mode through capture and compilation', () => {
    for (const mode of ['responsive', 'fit-width'] as const) {
      const fixture = viewportFixture(mode)
      const wire = captureFlutterPreviewSnapshot(fixture.graph, [fixture.page.id])
      const json = JSON.stringify(wire)
      const snapshot = validateFlutterPreviewSnapshot(JSON.parse(json))
      const output = compileFlutterPreviewSnapshot(snapshot)
      expect(generatedFlutterPage(output.files)).toContain(`fitWidth: ${mode === 'fit-width'}`)
      expect(output.files.has('lib/openpencil_page_viewport.dart')).toBe(true)
    }
  })
  test('missing and explicit fixed retain byte-identical generated projects', () => {
    const fixture = viewportFixture()
    const before = compileViewportFixture(fixture)
    fixture.graph.updateNode(fixture.page.id, {
      lowcodePageViewport: { version: 1, mode: 'fixed' }
    })
    const after = compileViewportFixture(fixture)
    expect([...after.files]).toEqual([...before.files])
    expect(after.files.has('lib/openpencil_page_viewport.dart')).toBe(false)
  })

  test('fit-width normalizes negative page origin without moving child geometry', () => {
    const fixture = viewportFixture('fit-width')
    const snapshot = structuredClone([...fixture.graph.nodes])
    const output = compileViewportFixture(fixture)
    const page = generatedFlutterPage(output.files)
    expect(page).toContain('fitWidth: true')
    expect(page).toContain('designWidth: 360')
    expect(page).toContain('designHeight: 740')
    expect(page).toContain('Positioned(left: 0, top: 0')
    expect(page).toContain('Positioned(left: 24, top: 130')
    expect(page).toContain('Semantics(label: "Increment counter"')
    expect([...fixture.graph.nodes]).toEqual(snapshot)
    expect(output.files.get('lib/openpencil_page_viewport.dart')).toContain(
      'designHeight * width / designWidth'
    )
  })

  test('responsive compact precedence and parent flow replace absolute native classes', () => {
    const fixture = viewportFixture('responsive')
    fixture.graph.updateNode(fixture.frame.id, {
      responsiveOverrides: {
        compact: { layoutMode: 'VERTICAL', itemSpacing: 16 },
        sm: { itemSpacing: 20 },
        xl: { layoutMode: 'HORIZONTAL', itemSpacing: 24 }
      }
    })
    const ir = collectTree(fixture.graph, fixture.page.id)
    const before = structuredClone(ir.children)
    for (const width of [360, 390, 430, 600, 640, 768, 1024, 1279.99]) {
      const root = prepareFlutterPageFrames(
        resolveFlutterLayout(ir.children, width)
      )[0] as IRElement
      expect(root.layout?.position).toBe('flow')
      expect(root.layout?.widthSizing).toBe('FILL')
      expect(root.layout?.heightSizing).toBe('HUG')
      expect(root.layout?.itemSpacing).toBe(16)
      expect((root.children[0] as IRElement).layout?.position).toBe('flow')
    }
    const desktop = prepareFlutterPageFrames(
      resolveFlutterLayout(ir.children, 1280)
    )[0] as IRElement
    expect(desktop.layout?.layoutMode).toBe('HORIZONTAL')
    expect(desktop.layout?.itemSpacing).toBe(24)
    expect(ir.children).toEqual(before)
    const page = generatedFlutterPage(compileViewportFixture(fixture).files)
    expect(page).toContain('opViewportWidth < 1280.0')
    expect(page).toContain('Axis.vertical')
    expect(page).toContain('Axis.horizontal')
    expect(page).toContain('OpenPencilFill(width: true')
  })

  test('HUG/FILL and counter-axis stretch use semantic geometry rather than static CSS', () => {
    const fixture = viewportFixture('responsive')
    const ir = collectTree(fixture.graph, fixture.page.id)
    const root = resolveFlutterLayout(ir.children, 390)[0] as IRElement
    const row = root.children.find(
      (child) => child.kind === 'element' && child.sourceId === fixture.row.id
    ) as IRElement
    const style = projectFlutterLayout({ width: 312, height: 48 }, row.layout)
    expect(style.width).toBeUndefined()
    expect(style.height).toBe(48)
    expect(style.crossAxisAlignment).toBe('stretch')
    const button = root.children.find(
      (child) => child.kind === 'element' && child.sourceId === fixture.button.id
    ) as IRElement
    const buttonStyle = projectFlutterLayout({ width: 312, height: 48 }, button.layout)
    expect(buttonStyle.height).toBeUndefined()
    expect(buttonStyle.minHeight).toBe(48)
    expect(generatedFlutterPage(compileViewportFixture(fixture).files)).toContain(
      'OpenPencilFlexItem(flex: 1000'
    )
  })

  test('an absolute badge does not collapse the neighboring auto-layout flow', () => {
    const fixture = viewportFixture('responsive')
    fixture.graph.createNode('RECTANGLE', fixture.frame.id, {
      name: 'Badge',
      x: 280,
      y: 4,
      width: 20,
      height: 20,
      layoutPositioning: 'ABSOLUTE'
    })
    const page = generatedFlutterPage(compileViewportFixture(fixture).files)
    expect(page).toContain('minimumHeight: 24, flow: OpenPencilFlex(axis: Axis.vertical')
    expect(page).toContain('Positioned(left: 280, top: 4')
  })
})
