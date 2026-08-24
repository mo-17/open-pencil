import { describe, expect, test } from 'bun:test'

import { instrumentVectorMotionHTML } from '#compiler/adapters/react/motion/target'

import { compile, withDefaults } from '@open-pencil/compiler'
import { collectTree } from '@open-pencil/compiler/ir/collect/tree'
import type { IRElement } from '@open-pencil/compiler/ir/types'
import type { MotionEasing, MotionSpec } from '@open-pencil/scene-graph'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

function requireMotion(element: IRElement): NonNullable<IRElement['motion']> {
  if (!element.motion) throw new Error('Expected compiled Motion metadata')
  return element.motion
}

function motion(trigger: 'mount' | 'hover' = 'mount'): MotionSpec {
  const advanced = (offset: number) => ({
    offset,
    originX: offset,
    originY: offset,
    x: offset * 12,
    y: offset * -6,
    scaleX: 1 + offset * 0.25,
    scaleY: 1 - offset * 0.2,
    rotate: offset * 30,
    width: 100 + offset * 100,
    height: 40 + offset * 40,
    cornerRadius: 4 + offset * 16,
    fillColor: { r: 1 - offset, g: 0, b: offset, a: 1 },
    strokeColor: { r: offset, g: offset, b: offset, a: 1 },
    strokeWidth: 1 + offset * 3,
    blur: offset * 8,
    shadowX: offset * 8,
    shadowY: 2 + offset * 8,
    shadowBlur: 4 + offset * 12,
    shadowSpread: offset * 2,
    shadowColor: { r: 0, g: 0, b: 0, a: 0.2 + offset * 0.3 },
    pathProgress: offset,
    trimStart: offset * 0.25,
    trimEnd: 0.25 + offset * 0.75,
    trimOffset: offset * 0.5,
    gap: 4 + offset * 8,
    rowGap: 6 + offset * 8,
    columnGap: 8 + offset * 8,
    paddingTop: 2 + offset * 8,
    paddingRight: 4 + offset * 8,
    paddingBottom: 6 + offset * 8,
    paddingLeft: 8 + offset * 8,
    ...(offset === 0
      ? {
          easing: {
            type: 'spring' as const,
            mass: 1,
            stiffness: 170,
            damping: 26,
            velocity: 0
          }
        }
      : {})
  })
  return {
    version: 2,
    reducedMotion: 'allow',
    tracks: [
      {
        id: 'advanced',
        trigger,
        path: {
          points: [
            { x: 0, y: 0 },
            { x: 60, y: 0 },
            { x: 60, y: 80 }
          ],
          autoRotate: true
        },
        keyframes: [advanced(0), advanced(1)],
        timing: {
          durationMs: 700,
          easing: { type: 'inertia', velocity: 10, deceleration: 0.2 }
        }
      }
    ]
  }
}

function richEasingMotion(easing: MotionEasing, trigger: 'mount' | 'hover' = 'mount'): MotionSpec {
  return {
    version: 2,
    reducedMotion: 'allow',
    tracks: [
      {
        id: 'rich-easing',
        trigger,
        keyframes: [
          { offset: 0, opacity: 0, y: 24 },
          { offset: 1, opacity: 1, y: 0 }
        ],
        timing: { durationMs: 500, easing }
      }
    ]
  }
}

function compileMotion(spec: MotionSpec) {
  const graph = makeSceneGraph()
  const pageId = firstPageId(graph)
  graph.createNode('RECTANGLE', pageId, {
    fills: [
      {
        type: 'SOLID',
        color: { r: 0.2, g: 0.3, b: 0.4, a: 1 },
        opacity: 1,
        visible: true
      }
    ],
    strokes: [
      {
        color: { r: 0, g: 0, b: 0, a: 1 },
        opacity: 1,
        visible: true,
        weight: 1,
        align: 'CENTER'
      }
    ],
    motion: spec
  })
  return compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({ packageName: 'motion-v2-test', devMode: false })
  })
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

describe('compiler — MotionSpec v2 artifacts', () => {
  test('pre-samples path and physical easing into bounded CSS keyframes', () => {
    const out = compileMotion(motion())
    const css = out.files.get('src/__motion.css') as string
    expect(css).toContain('animation-timing-function: linear;')
    expect(css).toContain('transform-origin: 0% 0%')
    expect(css).toContain('width: 100px')
    expect(css).toContain('height: 40px')
    expect(css).toContain('border-radius: 4px')
    expect(css).toContain('background-color: rgb(255, 0, 0)')
    expect(css).toContain('border-color: rgb(0, 0, 0)')
    expect(css).toContain('filter: blur(0px)')
    expect(css).toContain('box-shadow: 0px 2px 4px 0px rgba(0, 0, 0, 0.2)')
    expect(css).toContain('translate: 0px 0px')
    expect(css).not.toContain('offset-path:')
    expect(css).not.toContain('offset-distance:')
    const offsets = [...css.matchAll(/^  ([\d.]+)% \{/gm)].map((match) => Number(match[1]) / 100)
    expect(offsets.length).toBeGreaterThanOrEqual(65)
    expect(offsets.length).toBeLessThanOrEqual(257)
    expect(offsets[0]).toBe(0)
    expect(offsets.at(-1)).toBe(1)
    expect(offsets.every((offset, index) => index === 0 || offset >= offsets[index - 1])).toBe(true)
    expect(css).toContain('gap: 4px')
    expect(css).toContain('padding-left: 8px')
    expect(css).not.toContain('undefined')
  })

  test('emits the same advanced channel values for controlled WAAPI tracks', () => {
    const out = compileMotion(motion('hover'))
    const runtime = out.files.get('src/__motion-runtime.ts') as string
    expect(runtime).toContain('transformOrigin')
    expect(runtime).toContain('backgroundColor')
    expect(runtime).toContain('boxShadow')
    const registrySource = /const registry: Record<string, MotionSpec> = (.+)\n/.exec(runtime)?.[1]
    expect(registrySource).toBeDefined()
    const registry = JSON.parse(registrySource ?? '{}') as Record<
      string,
      {
        tracks: Array<{
          keyframes: Array<Record<string, unknown>>
          timing: { easing: string }
        }>
      }
    >
    const frames = Object.values(registry)[0]?.tracks[0]?.keyframes ?? []
    expect(frames.length).toBeGreaterThanOrEqual(65)
    expect(frames.length).toBeLessThanOrEqual(257)
    expect(frames[0]?.offset).toBe(0)
    expect(frames.at(-1)?.offset).toBe(1)
    expect(frames.some((frame) => frame.translate !== undefined)).toBe(true)
    expect(frames.some((frame) => frame.scale !== undefined)).toBe(true)
    expect(frames.some((frame) => frame.rotate !== undefined)).toBe(true)
    expect(frames.some((frame) => frame.offsetPath !== undefined)).toBe(false)
    expect(runtime).toContain('paddingLeft')
    expect(Object.values(registry)[0]?.tracks[0]?.timing.easing).toBe('linear')
    expect(runtime).not.toContain('"undefined"')
  })

  test('keeps tokens sensitive to path, physical easing, and advanced channels', () => {
    const first = compileMotion(motion())
    const changed = motion()
    const path = changed.tracks[0]?.path
    expect(path).toBeDefined()
    if (!path) throw new Error('expected motion path')
    path.points[1].x = 121
    const second = compileMotion(changed)
    const token = (out: typeof first) =>
      /data-op-motion="([^"]+)"/.exec(out.files.get('src/App.tsx') as string)?.[1]
    expect(token(first)).toBeDefined()
    expect(token(second)).not.toBe(token(first))
  })

  test('samples rich easing to bounded adaptive CSS points while keeping physical curves at 17', () => {
    const sampleCount = (spec: MotionSpec) => {
      const css = compileMotion(spec).files.get('src/__motion.css') as string
      const linear = /animation-timing-function: linear\(([^;]+)\);/.exec(css)?.[1]
      expect(linear).toBeDefined()
      return linear?.split(',').length
    }

    expect(
      sampleCount(richEasingMotion({ type: 'elastic', mode: 'inOut', amplitude: 1.5, period: 0.5 }))
    ).toBe(80)
    expect(
      sampleCount(richEasingMotion({ type: 'elastic', mode: 'inOut', amplitude: 10, period: 0.1 }))
    ).toBe(513)
    expect(
      sampleCount(
        richEasingMotion({
          type: 'spring',
          mass: 1,
          stiffness: 170,
          damping: 26,
          velocity: 0
        })
      )
    ).toBe(17)
  })

  test('embeds rich easing in controlled runtime output and its shared kernel', () => {
    const out = compileMotion(richEasingMotion({ type: 'bounce', mode: 'out' }, 'hover'))
    const runtime = out.files.get('src/__motion-runtime.ts') as string
    const registrySource = /const registry: Record<string, MotionSpec> = (.+)\n/.exec(runtime)?.[1]
    expect(registrySource).toBeDefined()
    const registry = JSON.parse(registrySource ?? '{}') as Record<
      string,
      { tracks: Array<{ timing: { easing: string } }> }
    >
    const easing = Object.values(registry)[0]?.tracks[0]?.timing.easing
    expect(easing?.startsWith('linear(')).toBe(true)
    expect(easing?.slice('linear('.length, -1).split(',')).toHaveLength(65)
    expect(runtime).toContain("type MotionEaseMode = 'in' | 'out' | 'inOut'")
    expect(runtime).toContain('const sampleRichEasing:')
    expect(runtime).toContain('const sharedSampleMotionRuntimeEasing')
  })

  test('keeps canonical tokens sensitive to every rich easing parameter', () => {
    const variants: MotionEasing[] = [
      { type: 'power', mode: 'out', power: 2 },
      { type: 'power', mode: 'in', power: 2 },
      { type: 'power', mode: 'out', power: 3 },
      { type: 'back', mode: 'out', overshoot: 1.7 },
      { type: 'back', mode: 'out', overshoot: 2.4 },
      { type: 'elastic', mode: 'out', amplitude: 1.5, period: 0.5 },
      { type: 'elastic', mode: 'in', amplitude: 1.5, period: 0.5 },
      { type: 'elastic', mode: 'out', amplitude: 2, period: 0.5 },
      { type: 'elastic', mode: 'out', amplitude: 1.5, period: 0.8 }
    ]
    const tokens = variants.map((easing) => {
      const app = compileMotion(richEasingMotion(easing)).files.get('src/App.tsx') as string
      return /data-op-motion="([^"]+)"/.exec(app)?.[1]
    })
    expect(tokens.every(Boolean)).toBe(true)
    expect(new Set(tokens)).toHaveLength(tokens.length)
  })

  test('separates target-sensitive tokens while deduplicating identical targets', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const spec = motion()
    const fill = (opacity: number) => [
      {
        type: 'SOLID' as const,
        color: { r: 0.2, g: 0.3, b: 0.4, a: 1 },
        opacity,
        visible: true
      }
    ]
    for (let index = 0; index < 2; index++) {
      graph.createNode('RECTANGLE', pageId, {
        width: 100,
        height: 40,
        fills: fill(1),
        motion: structuredClone(spec)
      })
    }
    graph.createNode('RECTANGLE', pageId, {
      width: 100,
      height: 40,
      fills: fill(0.5),
      motion: structuredClone(spec)
    })
    graph.createNode('TEXT', pageId, {
      text: 'target kind',
      width: 100,
      height: 40,
      fills: fill(1),
      motion: structuredClone(spec)
    })

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'motion-target-tokens', devMode: false })
    })
    const app = out.files.get('src/App.tsx') as string
    const tokens = [...app.matchAll(/data-op-motion="([^"]+)"/g)].map((match) => match[1])
    expect(tokens).toHaveLength(4)
    expect(tokens[0]).toBe(tokens[1])
    expect(tokens[2]).not.toBe(tokens[0])
    expect(tokens[3]).not.toBe(tokens[0])
    expect(new Set(tokens)).toHaveLength(3)
    const css = out.files.get('src/__motion.css') as string
    expect((css.match(/@keyframes /g) ?? []).length).toBe(3)
  })

  test('keeps 128-point and degenerate paths finite, bounded, and deduplicated', () => {
    const points = Array.from({ length: 128 }, (_, index) => ({
      x: index * 2,
      y: index % 2 === 0 ? 0 : 20
    }))
    const spec = motion()
    const path = spec.tracks[0]?.path
    if (!path) throw new Error('expected motion path')
    path.points = points
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const startedAt = performance.now()
    for (let index = 0; index < 100; index++) {
      graph.createNode('RECTANGLE', pageId, { motion: structuredClone(spec) })
    }
    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'motion-v2-bounded', devMode: false })
    })
    const elapsedMs = performance.now() - startedAt
    const css = out.files.get('src/__motion.css') as string
    const offsets = [...css.matchAll(/^  ([\d.]+)% \{/gm)]
    expect(offsets.length).toBeLessThanOrEqual(257)
    expect((css.match(/@keyframes /g) ?? []).length).toBe(1)
    expect(css).not.toContain('NaN')
    expect(elapsedMs).toBeLessThan(2_000)

    const degenerate = motion()
    const degeneratePath = degenerate.tracks[0]?.path
    if (!degeneratePath) throw new Error('expected degenerate motion path')
    degeneratePath.points = Array.from({ length: 128 }, () => ({ x: 4, y: 7 }))
    const degenerateCSS = compileMotion(degenerate).files.get('src/__motion.css') as string
    expect(degenerateCSS).not.toContain('NaN')
    expect(degenerateCSS).not.toContain('offset-path:')
  })

  test('preserves every bounded auto-rotate corner and discontinuous path step', () => {
    const lower = (spec: MotionSpec) => {
      const graph = makeSceneGraph()
      const pageId = firstPageId(graph)
      graph.createNode('RECTANGLE', pageId, { motion: spec })
      const element = collectTree(graph, pageId).children[0] as IRElement
      return element.motion?.tracks[0]?.keyframes ?? []
    }
    const points = Array.from({ length: 128 }, (_, index) => ({
      x: index * 10,
      y: index % 2 === 0 ? 0 : 10
    }))
    const corners = lower({
      version: 2,
      reducedMotion: 'allow',
      tracks: [
        {
          id: 'all-corners',
          trigger: 'mount',
          path: { points, autoRotate: true },
          keyframes: [
            { offset: 0, pathProgress: 0 },
            { offset: 1, pathProgress: 1 }
          ],
          timing: { durationMs: 1_000, easing: 'linear' }
        }
      ]
    })
    const angleDelta = (from = 0, to = 0) =>
      Math.abs(((((to - from + 180) % 360) + 360) % 360) - 180)
    const sharpCorners = corners.slice(1).filter((frame, index) => {
      const previous = corners[index]
      return (
        frame.offset - previous.offset <= 0.00002 && angleDelta(previous.rotate, frame.rotate) > 60
      )
    })
    expect(corners).toHaveLength(257)
    expect(sharpCorners.length).toBeGreaterThanOrEqual(points.length - 2)

    const holdFrames = lower({
      version: 2,
      reducedMotion: 'allow',
      tracks: [
        {
          id: 'hold-at-vertex',
          trigger: 'mount',
          path: {
            points: [
              { x: 0, y: 0 },
              { x: 100, y: 0 },
              { x: 100, y: 100 }
            ],
            autoRotate: true
          },
          keyframes: [
            { offset: 0, pathProgress: 0 },
            { offset: 0.4, pathProgress: 0.5, easing: { type: 'hold' } },
            { offset: 0.657, pathProgress: 0.5, easing: 'linear' },
            { offset: 1, pathProgress: 1 }
          ],
          timing: { durationMs: 1_000, easing: 'linear' }
        }
      ]
    })
    expect(holdFrames.length).toBeLessThan(80)
    expect(
      holdFrames.slice(1).some((frame, index) => {
        const previous = holdFrames[index]
        return (
          previous.offset >= 0.6569 &&
          frame.offset <= 0.6571 &&
          frame.offset - previous.offset <= 0.00002 &&
          angleDelta(previous.rotate, frame.rotate) > 80
        )
      })
    ).toBe(true)

    const stepFrames = lower({
      version: 2,
      reducedMotion: 'allow',
      tracks: [
        {
          id: 'steps-path',
          trigger: 'mount',
          path: {
            points: [
              { x: 0, y: 0 },
              { x: 100, y: 0 },
              { x: 100, y: 100 }
            ],
            autoRotate: true
          },
          keyframes: [
            { offset: 0, pathProgress: 0, easing: { type: 'steps', steps: 2, position: 'end' } },
            { offset: 0.913, pathProgress: 1 },
            { offset: 1, pathProgress: 1 }
          ],
          timing: { durationMs: 1_000, easing: 'linear' }
        }
      ]
    })
    const jumps = stepFrames.slice(1).filter((frame, index) => {
      const previous = stepFrames[index]
      return (
        frame.offset - previous.offset <= 0.000001 &&
        Math.abs((frame.x ?? 0) - (previous.x ?? 0)) > 10
      )
    })
    expect(jumps.length).toBeGreaterThanOrEqual(1)
    expect(
      stepFrames.slice(1).some((frame, index) => {
        const previous = stepFrames[index]
        return (
          previous.offset >= 0.9129 &&
          frame.offset <= 0.9131 &&
          frame.offset - previous.offset <= 0.00002 &&
          angleDelta(previous.rotate, frame.rotate) > 80
        )
      })
    ).toBe(true)
  })

  test('targets every source VECTOR geometry and preserves combined effect baselines', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const spec: MotionSpec = {
      version: 2,
      reducedMotion: 'allow',
      tracks: [
        {
          id: 'vector-hover',
          trigger: 'hover',
          keyframes: [
            {
              offset: 0,
              fillColor: { r: 1, g: 0, b: 0, a: 1 },
              strokeColor: { r: 0, g: 0, b: 0, a: 1 },
              strokeWidth: 2,
              width: 100,
              height: 40,
              trimStart: 0,
              trimEnd: 0.5,
              blur: 0
            },
            {
              offset: 1,
              fillColor: { r: 0, g: 0, b: 1, a: 1 },
              strokeColor: { r: 0, g: 1, b: 0, a: 1 },
              strokeWidth: 6,
              width: 150,
              height: 80,
              trimStart: 0,
              trimEnd: 1,
              blur: 12
            }
          ],
          timing: { durationMs: 200, fill: 'none' }
        }
      ]
    }
    const vector = graph.createNode('VECTOR', pageId, {
      width: 100,
      height: 40,
      vectorNetwork: {
        vertices: [
          { x: 0, y: 0 },
          { x: 40, y: 0 },
          { x: 60, y: 20 },
          { x: 100, y: 20 }
        ],
        segments: [
          { start: 0, end: 1, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
          { start: 2, end: 3, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } }
        ],
        regions: [
          { windingRule: 'NONZERO', loops: [[0]] },
          { windingRule: 'NONZERO', loops: [[1]] }
        ]
      },
      fills: [
        {
          type: 'GRADIENT_LINEAR',
          color: { r: 0, g: 0, b: 0, a: 1 },
          opacity: 1,
          visible: true,
          gradientStops: [
            { position: 0, color: { r: 1, g: 1, b: 0, a: 1 } },
            { position: 1, color: { r: 0, g: 1, b: 1, a: 1 } }
          ],
          gradientTransform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }
        },
        {
          type: 'SOLID',
          color: { r: 0.2, g: 0.3, b: 0.4, a: 1 },
          opacity: 0.8,
          visible: true
        }
      ],
      strokes: [
        {
          color: { r: 0.1, g: 0.2, b: 0.3, a: 1 },
          opacity: 0.75,
          visible: true,
          weight: 2,
          align: 'CENTER',
          dashPattern: [2, 3]
        }
      ],
      effects: [
        {
          type: 'LAYER_BLUR',
          visible: true,
          radius: 6,
          spread: 0,
          offset: { x: 0, y: 0 },
          color: { r: 0, g: 0, b: 0, a: 0 }
        },
        {
          type: 'DROP_SHADOW',
          visible: true,
          radius: 4,
          spread: 3,
          offset: { x: 2, y: 3 },
          color: { r: 0, g: 0, b: 0, a: 0.4 }
        },
        {
          type: 'INNER_SHADOW',
          visible: true,
          radius: 2,
          spread: 0,
          offset: { x: 1, y: 1 },
          color: { r: 0, g: 0, b: 0, a: 0.2 }
        }
      ],
      motion: spec
    })
    const ir = collectTree(graph, pageId)
    const element = ir.children[0] as IRElement
    expect(element.motion?.target?.fillIndex).toBe(1)
    expect(element.rawHtml).not.toContain('<feDropShadow')
    expect(element.rawHtml).toContain('<feGaussianBlur')
    const instrumented = instrumentVectorMotionHTML(
      element.rawHtml ?? '',
      requireMotion(element),
      vector.id
    )
    expect((instrumented.match(/var\(--op-motion-vector-fill/g) ?? []).length).toBe(2)
    expect((instrumented.match(/var\(--op-motion-vector-stroke,/g) ?? []).length).toBe(2)
    expect(instrumented).not.toContain('stroke-opacity="0.75"')
    expect((instrumented.match(/pathLength="1"/g) ?? []).length).toBe(2)
    expect(instrumented).toContain(
      'stroke-dasharray="var(--op-motion-vector-trim-visible) var(--op-motion-vector-trim-hidden)"'
    )
    expect(instrumented).toContain('preserveAspectRatio="none"')

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'motion-vector-target', devMode: false })
    })
    const css = out.files.get('src/__motion.css') as string
    expect(css).toContain('filter: blur(6px) drop-shadow(2px 3px 7px')
    const runtime = out.files.get('src/__motion-runtime.ts') as string
    const registrySource = /const registry: Record<string, MotionSpec> = (.+)\n/.exec(runtime)?.[1]
    expect(registrySource).toBeDefined()
    const registry = JSON.parse(registrySource ?? '{}') as Record<
      string,
      { tracks: Array<{ keyframes: Array<{ filter?: string }> }> }
    >
    const frames = Object.values(registry)[0]?.tracks[0]?.keyframes ?? []
    expect(frames[0]?.filter).toContain('blur(0px) drop-shadow(2px 3px 7px')
    expect(runtime).toContain('"--op-motion-vector-trim-visible":"1"')
  })

  test('keeps no-centerline imported vectors visible and rejects width/trim stroke channels', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const vector = graph.createNode('VECTOR', pageId, {
      width: 24,
      height: 24,
      fillGeometry: [{ windingRule: 'NONZERO', commandsBlob: rectangleCommandsBlob(2, 2, 20, 20) }],
      strokeGeometry: [
        { windingRule: 'NONZERO', commandsBlob: rectangleCommandsBlob(2, 2, 20, 20) }
      ],
      strokes: [
        {
          color: { r: 1, g: 0, b: 0, a: 1 },
          opacity: 0.5,
          visible: true,
          weight: 2,
          align: 'CENTER'
        }
      ],
      motion: {
        version: 2,
        tracks: [
          {
            id: 'outline-stroke',
            trigger: 'mount',
            keyframes: [
              {
                offset: 0,
                strokeColor: { r: 1, g: 0, b: 0, a: 1 },
                strokeWidth: 2,
                trimStart: 0,
                trimEnd: 0.5
              },
              {
                offset: 1,
                strokeColor: { r: 0, g: 0, b: 1, a: 1 },
                strokeWidth: 8,
                trimStart: 0.5,
                trimEnd: 1
              }
            ],
            timing: { durationMs: 100 }
          }
        ]
      }
    })

    const tree = collectTree(graph, pageId)
    const element = tree.children[0] as IRElement
    expect(element.motion?.target?.vectorStrokeTarget).toBe('outline')
    expect(tree.warnings.some((warning) => warning.code === 'motion-vector-outline-static')).toBe(
      true
    )
    expect(
      element.motion?.tracks[0]?.keyframes.every((frame) => frame.strokeWidth === undefined)
    ).toBe(true)
    expect(
      element.motion?.tracks[0]?.keyframes.every((frame) => frame.trimStart === undefined)
    ).toBe(true)
    const instrumented = instrumentVectorMotionHTML(
      element.rawHtml ?? '',
      requireMotion(element),
      vector.id
    )
    expect(instrumented).toContain('data-op-paint="stroke-outline"')
    expect(instrumented).toContain('fill="var(--op-motion-vector-stroke,')
    expect(instrumented).not.toContain('fill-opacity="0.5"')
    expect(instrumented).toContain('stroke="none"')
    expect(instrumented).not.toContain('display="none"')

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'motion-outline-only', devMode: false })
    })
    expect(out.warnings.some((warning) => warning.code === 'motion-vector-outline-static')).toBe(
      true
    )
    expect(out.files.get('src/App.tsx') as string).not.toContain('display=\\"none\\"')
  })

  test('fails closed per paint channel for empty, fill-only, and stroke-only VECTOR geometry', () => {
    const fixtures = [
      { name: 'empty', fillGeometry: false, strokeGeometry: false },
      { name: 'fill-only', fillGeometry: true, strokeGeometry: false },
      { name: 'stroke-only', fillGeometry: false, strokeGeometry: true }
    ] as const

    for (const fixture of fixtures) {
      const graph = makeSceneGraph()
      const pageId = firstPageId(graph)
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
        ],
        motion: {
          version: 2,
          tracks: [
            {
              id: `${fixture.name}-vector-paint`,
              trigger: 'mount',
              keyframes: [
                {
                  offset: 0,
                  fillColor: { r: 1, g: 0, b: 0, a: 1 },
                  strokeColor: { r: 0, g: 0, b: 0, a: 1 },
                  strokeWidth: 2,
                  trimStart: 0,
                  trimEnd: 0.5
                },
                {
                  offset: 1,
                  fillColor: { r: 0, g: 0, b: 1, a: 1 },
                  strokeColor: { r: 0, g: 1, b: 0, a: 1 },
                  strokeWidth: 8,
                  trimStart: 0.5,
                  trimEnd: 1
                }
              ],
              timing: { durationMs: 100 }
            }
          ]
        }
      })

      const tree = collectTree(graph, pageId)
      const element = tree.children[0] as IRElement
      const keyframes = element.motion?.tracks[0]?.keyframes ?? []
      expect(tree.warnings.some((warning) => warning.code === 'motion-vector-paint-static')).toBe(
        true
      )
      expect(tree.warnings.some((warning) => warning.code === 'motion-vector-outline-static')).toBe(
        true
      )
      expect(
        keyframes.every((frame) => (frame.fillColor !== undefined) === fixture.fillGeometry)
      ).toBe(true)
      expect(
        keyframes.every((frame) => (frame.strokeColor !== undefined) === fixture.strokeGeometry)
      ).toBe(true)
      expect(keyframes.every((frame) => frame.strokeWidth === undefined)).toBe(true)
      expect(keyframes.every((frame) => frame.trimStart === undefined)).toBe(true)
      expect(keyframes.every((frame) => frame.trimEnd === undefined)).toBe(true)

      const instrumented = instrumentVectorMotionHTML(
        element.rawHtml ?? '',
        requireMotion(element),
        vector.id
      )
      expect(instrumented.includes('--op-motion-vector-fill')).toBe(fixture.fillGeometry)
      expect(instrumented.includes('--op-motion-vector-stroke')).toBe(fixture.strokeGeometry)
      if (fixture.name === 'empty') {
        expect(element.rawHtml).not.toContain('<rect')
        expect(element.rawHtml).not.toContain('<path')
      }

      const out = compile({
        graph,
        pageIds: [pageId],
        options: withDefaults({ packageName: `motion-${fixture.name}-vector`, devMode: false })
      })
      expect(out.warnings.some((warning) => warning.code === 'motion-vector-paint-static')).toBe(
        true
      )
    }
  })

  test('animates a resolved BOOLEAN_OPERATION path without emitting its source operands', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
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
      ],
      motion: {
        version: 2,
        tracks: [
          {
            id: 'resolved-boolean',
            trigger: 'mount',
            keyframes: [
              {
                offset: 0,
                width: 20,
                height: 20,
                fillColor: { r: 1, g: 0, b: 0, a: 1 },
                strokeColor: { r: 0, g: 0, b: 0, a: 1 },
                strokeWidth: 2,
                trimStart: 0,
                trimEnd: 0.5
              },
              {
                offset: 1,
                width: 40,
                height: 30,
                fillColor: { r: 0, g: 0, b: 1, a: 1 },
                strokeColor: { r: 0, g: 1, b: 0, a: 1 },
                strokeWidth: 6,
                trimStart: 0,
                trimEnd: 1
              }
            ],
            timing: { durationMs: 100 }
          }
        ]
      }
    })
    const operand = graph.createNode('RECTANGLE', boolean.id, {
      width: 8,
      height: 8,
      fills: [
        {
          type: 'SOLID',
          color: { r: 0, g: 1, b: 0, a: 1 },
          opacity: 1,
          visible: true
        }
      ]
    })

    const tree = collectTree(graph, pageId)
    const element = tree.children[0] as IRElement
    expect(element.motion?.target?.kind).toBe('vector')
    expect(element.rawHtml).toContain('<path')
    expect((element.rawHtml?.match(/<path/g) ?? []).length).toBe(1)
    expect(element.rawHtml).not.toContain(operand.id)
    expect(
      tree.warnings.some((warning) => warning.code === 'motion-boolean-result-unavailable')
    ).toBe(false)
    const keyframes = element.motion?.tracks[0]?.keyframes ?? []
    expect(keyframes.every((frame) => frame.width !== undefined)).toBe(true)
    expect(keyframes.every((frame) => frame.height !== undefined)).toBe(true)
    expect(keyframes.every((frame) => frame.fillColor !== undefined)).toBe(true)
    expect(keyframes.every((frame) => frame.strokeColor !== undefined)).toBe(true)
    expect(keyframes.every((frame) => frame.strokeWidth !== undefined)).toBe(true)
    expect(keyframes.every((frame) => frame.trimEnd !== undefined)).toBe(true)
    const instrumented = instrumentVectorMotionHTML(
      element.rawHtml ?? '',
      requireMotion(element),
      boolean.id
    )
    expect(instrumented).toContain('--op-motion-vector-fill')
    expect(instrumented).toContain('--op-motion-vector-stroke')
    expect(instrumented).toContain('pathLength="1"')
  })

  test('fails closed for BOOLEAN_OPERATION nodes without a resolved fillGeometry path', () => {
    const fixtures = ['empty', 'stroke-only', 'child-only'] as const
    for (const fixture of fixtures) {
      const graph = makeSceneGraph()
      const pageId = firstPageId(graph)
      const boolean = graph.createNode('BOOLEAN_OPERATION', pageId, {
        width: 20,
        height: 20,
        strokeGeometry:
          fixture === 'stroke-only'
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
        motion: {
          version: 2,
          tracks: [
            {
              id: `${fixture}-boolean`,
              trigger: 'mount',
              keyframes: [
                { offset: 0, opacity: 0, width: 10, fillColor: { r: 1, g: 0, b: 0, a: 1 } },
                { offset: 1, opacity: 1, width: 40, fillColor: { r: 0, g: 0, b: 1, a: 1 } }
              ],
              timing: { durationMs: 100 }
            }
          ]
        }
      })
      if (fixture === 'child-only') {
        graph.createNode('RECTANGLE', boolean.id, {
          width: 10,
          height: 10,
          fills: [
            {
              type: 'SOLID',
              color: { r: 0, g: 1, b: 0, a: 1 },
              opacity: 1,
              visible: true
            }
          ]
        })
      }

      const tree = collectTree(graph, pageId)
      const element = tree.children[0] as IRElement
      expect(element.motion).toBeUndefined()
      expect(element.rawHtml).not.toContain('<path')
      expect(element.rawHtml).not.toContain('<rect')
      expect(
        tree.warnings.some((warning) => warning.code === 'motion-boolean-result-unavailable')
      ).toBe(true)
    }
  })

  test('normalizes full trim for LINE, STAR, and POLYGON generated geometry', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const spec: MotionSpec = {
      version: 2,
      reducedMotion: 'allow',
      tracks: [
        {
          id: 'full-trim',
          trigger: 'mount',
          keyframes: [
            { offset: 0, trimStart: 0, trimEnd: 1 },
            { offset: 1, trimStart: 0, trimEnd: 1 }
          ],
          timing: { durationMs: 100, easing: 'linear' }
        }
      ]
    }
    const nodes = (['LINE', 'STAR', 'POLYGON'] as const).map((type, index) =>
      graph.createNode(type, pageId, {
        x: index * 100,
        width: 80,
        height: 40,
        strokes: [
          {
            color: { r: 0, g: 0, b: 0, a: 1 },
            opacity: 1,
            visible: true,
            weight: 2,
            align: 'CENTER',
            dashPattern: [2, 3]
          }
        ],
        motion: structuredClone(spec)
      })
    )

    const tree = collectTree(graph, pageId)
    for (const [index, node] of nodes.entries()) {
      const element = tree.children[index] as IRElement
      const instrumented = instrumentVectorMotionHTML(
        element.rawHtml ?? '',
        requireMotion(element),
        node.id
      )
      expect(instrumented).toContain('pathLength="1"')
      expect(instrumented).toContain(
        'stroke-dasharray="var(--op-motion-vector-trim-visible) var(--op-motion-vector-trim-hidden)"'
      )
      expect(instrumented).not.toContain('stroke-dasharray="2 3"')
    }
  })

  test('does not fold a vector descendant that owns Motion runtime identity', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const parent = graph.createNode('FRAME', pageId, { width: 120, height: 80 })
    const child = graph.createNode('VECTOR', parent.id, {
      width: 40,
      height: 20,
      vectorNetwork: {
        vertices: [
          { x: 0, y: 0 },
          { x: 40, y: 20 }
        ],
        segments: [{ start: 0, end: 1, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } }],
        regions: []
      },
      motion: {
        version: 2,
        tracks: [
          {
            id: 'child-move',
            trigger: 'mount',
            keyframes: [
              { offset: 0, x: 0 },
              { offset: 1, x: 20 }
            ],
            timing: { durationMs: 100 }
          }
        ]
      }
    })
    const root = collectTree(graph, pageId).children[0] as IRElement
    expect(root.sourceId).toBe(parent.id)
    expect(root.rawHtml).toBeUndefined()
    const childElement = root.children[0] as IRElement
    expect(childElement.sourceId).toBe(child.id)
    expect(childElement.rawHtml).toContain('<svg')
    expect(childElement.motion?.tracks[0]?.id).toBe('child-move')

    const app = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'motion-vector-child', devMode: false })
    }).files.get('src/App.tsx') as string
    expect(app).toContain(`data-node-id="${child.id}"`)
    expect(app).toContain('data-op-motion=')
  })

  test('keeps box semantics when an all-vector container animates corner radius', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const parent = graph.createNode('FRAME', pageId, {
      width: 80,
      height: 80,
      motion: {
        version: 2,
        tracks: [
          {
            id: 'round-container',
            trigger: 'mount',
            keyframes: [
              { offset: 0, cornerRadius: 0 },
              { offset: 1, cornerRadius: 24 }
            ],
            timing: { durationMs: 100 }
          }
        ]
      }
    })
    graph.createNode('VECTOR', parent.id, {
      width: 80,
      height: 80,
      vectorNetwork: {
        vertices: [
          { x: 0, y: 0 },
          { x: 80, y: 80 }
        ],
        segments: [{ start: 0, end: 1, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } }],
        regions: []
      }
    })

    const root = collectTree(graph, pageId).children[0] as IRElement
    expect(root.rawHtml).toBeUndefined()
    expect(root.motion?.target?.kind).toBe('box')
    expect((root.children[0] as IRElement).rawHtml).toContain('<svg')
  })
})
