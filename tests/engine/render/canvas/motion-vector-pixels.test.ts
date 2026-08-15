import { beforeAll, describe, expect, test } from 'bun:test'

import type { CanvasKit } from 'canvaskit-wasm'

import { SceneGraph, SkiaRenderer } from '@open-pencil/core'
import type { MotionVisualState } from '@open-pencil/motion'

import { initCanvasKit } from '#cli/headless'
import { renderNode } from '#core/canvas/scene'

import { expectDefined } from '#tests/helpers/assert'

let ck: CanvasKit

beforeAll(async () => {
  ck = await initCanvasKit()
})

function visual(overrides: Partial<MotionVisualState>): MotionVisualState {
  return { x: 0, y: 0, scaleX: 1, scaleY: 1, rotate: 0, opacity: 1, ...overrides }
}

function pixelsFor(
  graph: SceneGraph,
  nodeId: string,
  width: number,
  height: number,
  state?: MotionVisualState
): Uint8Array {
  const surface = expectDefined(ck.MakeSurface(width, height), 'motion vector surface')
  try {
    surface.getCanvas().clear(ck.Color4f(0, 0, 0, 0))
    const renderer = new SkiaRenderer(ck, surface)
    renderNode(
      renderer,
      surface.getCanvas(),
      graph,
      nodeId,
      state ? { motionVisualStates: new Map([[nodeId, state]]) } : {}
    )
    surface.flush()
    const image = surface.makeImageSnapshot()
    try {
      return expectDefined(
        image.readPixels(0, 0, {
          width,
          height,
          colorType: ck.ColorType.RGBA_8888,
          alphaType: ck.AlphaType.Unpremul,
          colorSpace: ck.ColorSpace.SRGB
        }),
        'motion vector pixels'
      )
    } finally {
      image.delete()
    }
  } finally {
    surface.delete()
  }
}

function alphaAt(pixels: Uint8Array, width: number, x: number, y: number): number {
  return pixels[(y * width + x) * 4 + 3]
}

function maxAlpha(pixels: Uint8Array): number {
  let result = 0
  for (let index = 3; index < pixels.length; index += 4) {
    result = Math.max(result, pixels[index])
  }
  return result
}

function alphaBounds(
  pixels: Uint8Array,
  width: number,
  height: number
): { width: number; height: number } | null {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (alphaAt(pixels, width, x, y) === 0) continue
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }
  return maxX === -1 ? null : { width: maxX - minX + 1, height: maxY - minY + 1 }
}

function rectangleCommandsBlob(x: number, y: number, width: number, height: number): Uint8Array {
  const blob = new Uint8Array(1 + 4 * 9 + 1)
  const view = new DataView(blob.buffer)
  const points = [
    { command: 1, x, y },
    { command: 2, x: x + width, y },
    { command: 2, x: x + width, y: y + height },
    { command: 2, x, y: y + height }
  ]
  let offset = 0
  for (const point of points) {
    blob[offset] = point.command
    view.setFloat32(offset + 1, point.x, true)
    view.setFloat32(offset + 5, point.y, true)
    offset += 9
  }
  blob[offset] = 0
  return blob
}

function triangleCommandsBlob(width: number, height: number): Uint8Array {
  const blob = new Uint8Array(1 + 4 * 9 + 1)
  const view = new DataView(blob.buffer)
  const points = [
    { command: 1, x: 0, y: 0 },
    { command: 2, x: width, y: height / 3 },
    { command: 2, x: width / 4, y: height },
    { command: 2, x: 0, y: 0 }
  ]
  let offset = 0
  for (const point of points) {
    blob[offset] = point.command
    view.setFloat32(offset + 1, point.x, true)
    view.setFloat32(offset + 5, point.y, true)
    offset += 9
  }
  blob[offset] = 0
  return blob
}

describe('CanvasKit Motion vector pixels', () => {
  test('restarts normalized trim for each SVG-equivalent vector region', () => {
    const graph = new SceneGraph()
    const pageId = graph.getPages()[0].id
    const vector = graph.createNode('VECTOR', pageId, {
      width: 60,
      height: 20,
      vectorNetwork: {
        vertices: [
          { x: 1, y: 2 },
          { x: 21, y: 2 },
          { x: 21, y: 12 },
          { x: 1, y: 12 },
          { x: 31, y: 2 },
          { x: 51, y: 2 },
          { x: 51, y: 12 },
          { x: 31, y: 12 }
        ],
        segments: [
          { start: 0, end: 1, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
          { start: 1, end: 2, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
          { start: 2, end: 3, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
          { start: 3, end: 0, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
          { start: 4, end: 5, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
          { start: 5, end: 6, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
          { start: 6, end: 7, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
          { start: 7, end: 4, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } }
        ],
        regions: [
          { windingRule: 'NONZERO', loops: [[0, 1, 2, 3]] },
          { windingRule: 'NONZERO', loops: [[4, 5, 6, 7]] }
        ]
      },
      fills: [],
      strokes: [
        {
          color: { r: 0, g: 0, b: 0, a: 1 },
          opacity: 1,
          visible: true,
          weight: 2,
          align: 'CENTER'
        }
      ]
    })

    const pixels = pixelsFor(graph, vector.id, 60, 20, visual({ trimStart: 0, trimEnd: 1 / 6 }))

    expect(alphaAt(pixels, 60, 6, 2)).toBeGreaterThan(200)
    expect(alphaAt(pixels, 60, 16, 2)).toBe(0)
    expect(alphaAt(pixels, 60, 36, 2)).toBeGreaterThan(200)
    expect(alphaAt(pixels, 60, 46, 2)).toBe(0)
  })

  test('animated VECTOR dimensions scale intrinsic pixels', () => {
    const graph = new SceneGraph()
    const pageId = graph.getPages()[0].id
    const vector = graph.createNode('VECTOR', pageId, {
      width: 10,
      height: 10,
      vectorNetwork: {
        vertices: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
          { x: 0, y: 10 }
        ],
        segments: [
          { start: 0, end: 1, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
          { start: 1, end: 2, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
          { start: 2, end: 3, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
          { start: 3, end: 0, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } }
        ],
        regions: [{ windingRule: 'NONZERO', loops: [[0, 1, 2, 3]] }]
      },
      fills: [
        {
          type: 'SOLID',
          color: { r: 0, g: 0, b: 0, a: 1 },
          opacity: 1,
          visible: true
        }
      ]
    })

    const pixels = pixelsFor(graph, vector.id, 24, 12, visual({ width: 20, height: 10 }))
    expect(alphaAt(pixels, 24, 15, 5)).toBeGreaterThan(200)
    expect(alphaAt(pixels, 24, 21, 5)).toBe(0)
  })

  test('a full Motion trim interval overrides authored dashes as one solid reveal', () => {
    const graph = new SceneGraph()
    const pageId = graph.getPages()[0].id
    const vector = graph.createNode('VECTOR', pageId, {
      width: 44,
      height: 10,
      vectorNetwork: {
        vertices: [
          { x: 2, y: 5 },
          { x: 42, y: 5 }
        ],
        segments: [{ start: 0, end: 1, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } }],
        regions: []
      },
      fills: [],
      strokes: [
        {
          color: { r: 0, g: 0, b: 0, a: 1 },
          opacity: 0.5,
          visible: true,
          weight: 2,
          align: 'CENTER',
          dashPattern: [2, 3]
        }
      ]
    })

    const pixels = pixelsFor(
      graph,
      vector.id,
      44,
      10,
      visual({
        strokeColor: { r: 0, g: 0, b: 1, a: 1 },
        trimStart: 0,
        trimEnd: 1
      })
    )

    // x=5 lies in the first authored dash gap (path starts at x=2); the trim
    // track owns reveal semantics, so a full interval is solid in both Canvas
    // and generated SVG instead of snapping back to the authored pattern.
    expect(alphaAt(pixels, 44, 5, 5)).toBeGreaterThanOrEqual(120)
    expect(alphaAt(pixels, 44, 5, 5)).toBeLessThanOrEqual(135)
    expect(alphaAt(pixels, 44, 25, 5)).toBeGreaterThanOrEqual(120)
    const sample = (5 * 44 + 25) * 4
    expect(pixels[sample]).toBeLessThan(20)
    expect(pixels[sample + 2]).toBeGreaterThan(240)
  })

  test('keeps baked imported outlines visible when dynamic width/trim lack a centerline', () => {
    const graph = new SceneGraph()
    const pageId = graph.getPages()[0].id
    const boundary = {
      windingRule: 'NONZERO' as const,
      commandsBlob: rectangleCommandsBlob(2, 2, 20, 20)
    }
    const vector = graph.createNode('VECTOR', pageId, {
      width: 24,
      height: 24,
      fillGeometry: [boundary],
      // Imported outline geometry remains fixed while unsupported width/trim
      // channels are ignored; its paint color can still animate.
      strokeGeometry: [
        { windingRule: 'NONZERO', commandsBlob: rectangleCommandsBlob(2, 2, 20, 20) }
      ],
      fills: [],
      strokes: [
        {
          color: { r: 0, g: 0, b: 0, a: 1 },
          opacity: 1,
          visible: true,
          weight: 2,
          align: 'CENTER'
        }
      ]
    })

    const pixels = pixelsFor(
      graph,
      vector.id,
      24,
      24,
      visual({
        strokeColor: { r: 0, g: 0, b: 1, a: 1 },
        strokeWidth: 6,
        trimStart: 0,
        trimEnd: 0.25
      })
    )

    expect(alphaAt(pixels, 24, 8, 2)).toBeGreaterThan(200)
    expect(alphaAt(pixels, 24, 12, 12)).toBeGreaterThan(200)
    expect(alphaAt(pixels, 24, 8, 21)).toBeGreaterThan(200)
    const center = (12 * 24 + 12) * 4
    expect(pixels[center]).toBeLessThan(20)
    expect(pixels[center + 2]).toBeGreaterThan(200)
  })

  test('keeps paint and stroke Motion static for an empty VECTOR', () => {
    const graph = new SceneGraph()
    const pageId = graph.getPages()[0].id
    const vector = graph.createNode('VECTOR', pageId, {
      width: 20,
      height: 20,
      fills: [
        {
          type: 'SOLID',
          color: { r: 1, g: 0, b: 0, a: 1 },
          opacity: 1,
          visible: true
        }
      ],
      strokes: [
        {
          color: { r: 0, g: 0, b: 0, a: 1 },
          opacity: 1,
          visible: true,
          weight: 2,
          align: 'CENTER'
        }
      ]
    })

    const baseline = pixelsFor(graph, vector.id, 20, 20, visual({}))
    const projected = pixelsFor(
      graph,
      vector.id,
      20,
      20,
      visual({
        fillColor: { r: 0, g: 0, b: 1, a: 1 },
        strokeColor: { r: 0, g: 1, b: 0, a: 1 },
        strokeWidth: 8,
        trimStart: 0,
        trimEnd: 0.5
      })
    )

    expect(projected).toEqual(baseline)
    expect(projected.every((channel) => channel === 0)).toBe(true)
  })

  test('applies only the paint channel backed by imported VECTOR geometry', () => {
    const fixtures = [
      { name: 'fill-only', fillGeometry: true, strokeGeometry: false },
      { name: 'stroke-only', fillGeometry: false, strokeGeometry: true }
    ] as const
    for (const fixture of fixtures) {
      const graph = new SceneGraph()
      const pageId = graph.getPages()[0].id
      const vector = graph.createNode('VECTOR', pageId, {
        width: 20,
        height: 20,
        fillGeometry: fixture.fillGeometry
          ? [{ windingRule: 'NONZERO', commandsBlob: rectangleCommandsBlob(2, 2, 16, 16) }]
          : [],
        strokeGeometry: fixture.strokeGeometry
          ? [{ windingRule: 'NONZERO', commandsBlob: rectangleCommandsBlob(2, 2, 16, 16) }]
          : [],
        fills: [
          {
            type: 'SOLID',
            color: { r: 1, g: 0, b: 0, a: 1 },
            opacity: 1,
            visible: true
          }
        ],
        strokes: [
          {
            color: { r: 0, g: 0, b: 0, a: 1 },
            opacity: 1,
            visible: true,
            weight: 2,
            align: 'CENTER'
          }
        ]
      })
      const supported = fixture.fillGeometry
        ? visual({ fillColor: { r: 0, g: 0, b: 1, a: 1 } })
        : visual({ strokeColor: { r: 0, g: 0, b: 1, a: 1 } })
      const projected = pixelsFor(
        graph,
        vector.id,
        20,
        20,
        fixture.fillGeometry
          ? { ...supported, strokeColor: { r: 0, g: 1, b: 0, a: 1 } }
          : { ...supported, fillColor: { r: 0, g: 1, b: 0, a: 1 } }
      )
      const supportedOnly = pixelsFor(graph, vector.id, 20, 20, supported)
      expect(projected).toEqual(supportedOnly)
      const center = (10 * 20 + 10) * 4
      expect(projected[center]).toBeLessThan(20)
      expect(projected[center + 1]).toBeLessThan(20)
      expect(projected[center + 2]).toBeGreaterThan(240)
      expect(projected[center + 3]).toBeGreaterThan(240)
    }
  })

  test('does not render an empty BOOLEAN_OPERATION as a fallback box', () => {
    const graph = new SceneGraph()
    const pageId = graph.getPages()[0].id
    const boolean = graph.createNode('BOOLEAN_OPERATION', pageId, {
      width: 20,
      height: 20,
      fills: [
        {
          type: 'SOLID',
          color: { r: 1, g: 0, b: 0, a: 1 },
          opacity: 1,
          visible: true
        }
      ],
      strokes: [
        {
          color: { r: 0, g: 0, b: 0, a: 1 },
          opacity: 1,
          visible: true,
          weight: 2,
          align: 'CENTER'
        }
      ]
    })
    const pixels = pixelsFor(
      graph,
      boolean.id,
      20,
      20,
      visual({
        fillColor: { r: 0, g: 0, b: 1, a: 1 },
        strokeColor: { r: 0, g: 1, b: 0, a: 1 },
        width: 40,
        height: 40
      })
    )
    expect(pixels.every((channel) => channel === 0)).toBe(true)
  })

  test('renders resolved BOOLEAN_OPERATION geometry with animated paint and dimensions', () => {
    const graph = new SceneGraph()
    const pageId = graph.getPages()[0].id
    const boolean = graph.createNode('BOOLEAN_OPERATION', pageId, {
      width: 20,
      height: 20,
      fillGeometry: [{ windingRule: 'NONZERO', commandsBlob: rectangleCommandsBlob(2, 2, 16, 16) }],
      fills: [
        {
          type: 'SOLID',
          color: { r: 1, g: 0, b: 0, a: 1 },
          opacity: 1,
          visible: true
        }
      ],
      strokes: [
        {
          color: { r: 0, g: 0, b: 0, a: 1 },
          opacity: 1,
          visible: true,
          weight: 2,
          align: 'CENTER'
        }
      ]
    })
    const pixels = pixelsFor(
      graph,
      boolean.id,
      44,
      24,
      visual({
        width: 40,
        height: 20,
        fillColor: { r: 0, g: 0, b: 1, a: 1 },
        strokeColor: { r: 0, g: 1, b: 0, a: 1 },
        strokeWidth: 4,
        trimStart: 0,
        trimEnd: 1
      })
    )

    const center = (10 * 44 + 20) * 4
    expect(pixels[center]).toBeLessThan(20)
    expect(pixels[center + 1]).toBeLessThan(20)
    expect(pixels[center + 2]).toBeGreaterThan(240)
    expect(pixels[center + 3]).toBeGreaterThan(240)
    expect(alphaAt(pixels, 44, 30, 10)).toBeGreaterThan(240)
    expect(alphaAt(pixels, 44, 40, 10)).toBe(0)
    const edge = (10 * 44 + 4) * 4
    expect(pixels[edge + 1]).toBeGreaterThan(200)
  })

  test('applies authored opacity exactly once for static and Motion VECTOR/BOOLEAN pixels', () => {
    for (const type of ['VECTOR', 'BOOLEAN_OPERATION'] as const) {
      const graph = new SceneGraph()
      const pageId = graph.getPages()[0].id
      const node = graph.createNode(type, pageId, {
        width: 20,
        height: 20,
        opacity: 0.5,
        fillGeometry: [
          { windingRule: 'NONZERO', commandsBlob: rectangleCommandsBlob(0, 0, 20, 20) }
        ],
        fills: [
          {
            type: 'SOLID',
            color: { r: 0, g: 0, b: 1, a: 1 },
            opacity: 1,
            visible: true
          }
        ]
      })
      const staticPixels = pixelsFor(graph, node.id, 20, 20)
      const motionPixels = pixelsFor(graph, node.id, 20, 20, visual({ opacity: 1 }))
      expect(maxAlpha(staticPixels)).toBeGreaterThanOrEqual(127)
      expect(maxAlpha(staticPixels)).toBeLessThanOrEqual(128)
      expect(maxAlpha(motionPixels)).toBeGreaterThanOrEqual(127)
      expect(maxAlpha(motionPixels)).toBeLessThanOrEqual(128)
    }
  })

  test('composes authored and Motion rotation once around intrinsic VECTOR geometry', () => {
    const graph = new SceneGraph()
    const pageId = graph.getPages()[0].id
    const vector = graph.createNode('VECTOR', pageId, {
      width: 30,
      height: 20,
      rotation: 30,
      fillGeometry: [{ windingRule: 'NONZERO', commandsBlob: triangleCommandsBlob(30, 20) }],
      fills: [
        {
          type: 'SOLID',
          color: { r: 0, g: 0, b: 1, a: 1 },
          opacity: 1,
          visible: true
        }
      ]
    })
    const pixels = pixelsFor(graph, vector.id, 60, 60, visual({ rotate: 10 }))
    const bounds = alphaBounds(pixels, 60, 60)
    expect(bounds).not.toBeNull()
    expect(bounds?.width ?? 0).toBeGreaterThan(15)
    expect(bounds?.height ?? 0).toBeGreaterThan(15)
    expect(maxAlpha(pixels)).toBeGreaterThan(240)
  })
})
