import { describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { collectTree } from '@open-pencil/compiler/ir/collect/tree'
import type { IRElement } from '@open-pencil/compiler/ir/types'
import type { MotionSpec } from '@open-pencil/scene-graph'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

function composedMotion(): MotionSpec {
  return {
    version: 3,
    reducedMotion: 'allow',
    tracks: [
      {
        id: 'high-first',
        trigger: 'mount',
        keyframes: [
          { offset: 0, x: 100, opacity: 0.2, rotate: 10 },
          { offset: 1, x: 120, opacity: 0.6, rotate: 20 }
        ],
        timing: { durationMs: 200, easing: 'linear', fill: 'both' },
        composition: { mode: 'replace', weight: 0.25, priority: 10 }
      },
      {
        id: 'low',
        trigger: 'mount',
        keyframes: [
          { offset: 0, x: 20, scaleX: 2, scaleY: 3 },
          { offset: 1, x: 40, scaleX: 3, scaleY: 4 }
        ],
        timing: { durationMs: 200, easing: 'linear', fill: 'both' },
        composition: { mode: 'add', weight: 0.5, priority: -5 }
      },
      {
        id: 'high-tie',
        trigger: 'mount',
        keyframes: [
          { offset: 0, x: 0, scaleX: 1, scaleY: 1 },
          { offset: 1, x: 10, scaleX: 2, scaleY: 2 }
        ],
        timing: {
          durationMs: 100,
          easing: 'linear',
          iterations: 3,
          fill: 'forwards'
        },
        composition: { mode: 'accumulate', priority: 10 }
      },
      {
        id: 'advanced',
        trigger: 'mount',
        keyframes: [
          { offset: 0, width: 80 },
          { offset: 1, width: 120 }
        ],
        timing: { durationMs: 200, easing: 'linear', fill: 'both' },
        composition: { mode: 'replace', weight: 1, priority: 20 }
      }
    ]
  }
}

function fixture(spec: MotionSpec = composedMotion()) {
  const graph = makeSceneGraph()
  const pageId = firstPageId(graph)
  const node = graph.createNode('RECTANGLE', pageId, {
    name: 'Composed',
    width: 80,
    height: 40,
    opacity: 0.4,
    rotation: 30,
    motion: spec
  })
  const tree = collectTree(graph, pageId)
  const element = tree.children[0] as IRElement
  const output = compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({ packageName: 'motion-v3-test', devMode: false })
  })
  return { element, node, output, tree }
}

function runtimeRegistry(runtime: string): Record<
  string,
  {
    version?: 3
    tracks: Array<{
      id: string
      composition?: {
        mode: 'replace' | 'add' | 'accumulate'
        weight: number
        priority: number
        sourceIndex: number
        variables: Record<string, string>
        sampling: {
          keyframes: Array<{ values: Record<string, number> }>
        }
      }
      keyframes: Array<Record<string, string | number>>
    }>
  }
> {
  const source = /const registry: Record<string, MotionSpec> = (.+)\n/.exec(runtime)?.[1]
  if (!source) throw new Error('Expected generated Motion runtime registry')
  return JSON.parse(source)
}

describe('compiler — MotionSpec v3 composition', () => {
  test('lowers normalized composition without baking the authored transform', () => {
    const { element, tree } = fixture()
    const motion = element.motion
    expect(motion?.version).toBe(3)
    expect(motion?.target?.kind).toBe('box')
    expect(motion?.authoredTransform).toEqual({ opacity: 0.4, rotate: 30 })
    expect(motion?.tracks.map((track) => track.composition)).toEqual([
      { mode: 'replace', weight: 0.25, priority: 10, sourceIndex: 0 },
      { mode: 'add', weight: 0.5, priority: -5, sourceIndex: 1 },
      { mode: 'accumulate', weight: 1, priority: 10, sourceIndex: 2 },
      { mode: 'replace', weight: 1, priority: 20, sourceIndex: 3 }
    ])
    expect(motion?.tracks[0]?.keyframes[0]).toMatchObject({ opacity: 0.2, rotate: 10 })
    expect(tree.warnings.some((warning) => warning.code === 'motion-channel-conflict')).toBe(false)
  })

  test('emits numeric composition variables and stable priority-ordered runtime tracks', () => {
    const { output } = fixture()
    const app = output.files.get('src/App.tsx') as string
    const css = output.files.get('src/__motion.css') as string
    const runtime = output.files.get('src/__motion-runtime.ts') as string
    const token = /data-op-motion="([^"]+)"/.exec(app)?.[1]
    expect(token).toBeDefined()
    if (!token) throw new Error('Expected Motion token')

    expect(css).toContain(`@property --op-${token}-0-opacity`)
    expect(css).toContain(`@property --op-${token}-0-clock`)
    expect(css).toContain(`@property --op-${token}-0-weight`)
    expect(css).toContain(`@property --op-${token}-2-scaleX`)
    expect(css).toContain('inherits: false')
    expect(css).toContain('opacity: clamp(0, calc(0.4 *')
    expect(css).toContain('rotate: calc(30deg +')
    expect(css).not.toContain('@keyframes')

    const registry = runtimeRegistry(runtime)
    const registered = Object.values(registry)[0]
    expect(registered?.version).toBe(3)
    expect(registered?.tracks.map((track) => track.id)).toEqual([
      'low',
      'high-first',
      'high-tie',
      'advanced'
    ])
    expect(registered?.tracks.map((track) => track.composition?.sourceIndex)).toEqual([1, 0, 2, 3])
    const accumulated = registered?.tracks.find((track) => track.id === 'high-tie')
    const scaleVariable = accumulated?.composition?.variables.scaleX
    const xVariable = accumulated?.composition?.variables.x
    expect(scaleVariable).toBe(`--op-${token}-2-scaleX`)
    expect(xVariable).toBe(`--op-${token}-2-x`)
    expect(
      accumulated?.composition?.sampling.keyframes.map((frame) => frame.values.scaleX)
    ).toEqual([1, 2])
    expect(accumulated?.composition?.sampling.keyframes.map((frame) => frame.values.x)).toEqual([
      0, 10
    ])
    expect(runtime).toContain('function manualTrackProgress')
    expect(runtime).toContain('timing.completedIterations')
    expect(registered?.tracks.find((track) => track.id === 'advanced')?.keyframes[0]?.width).toBe(
      '80px'
    )
  })

  test('keeps tokens sensitive to composition policy and authored baselines', () => {
    const first = fixture().output.files.get('src/App.tsx') as string
    const changed = composedMotion()
    const composition = changed.tracks[0]?.composition
    if (!composition) throw new Error('Expected composition metadata')
    composition.priority = 11
    const second = fixture(changed).output.files.get('src/App.tsx') as string
    const token = (source: string) => /data-op-motion="([^"]+)"/.exec(source)?.[1]
    expect(token(second)).not.toBe(token(first))
  })

  test('pre-samples v3 cubic paths into persistent composition keyframes', () => {
    const { element, output } = fixture({
      version: 3,
      reducedMotion: 'allow',
      tracks: [
        {
          id: 'weighted-path',
          trigger: 'mount',
          path: {
            version: 2,
            start: { x: 0, y: 0 },
            segments: [
              {
                control1: { x: 0, y: 120 },
                control2: { x: 120, y: -40 },
                end: { x: 120, y: 80 }
              },
              {
                control1: { x: 120, y: 150 },
                control2: { x: 20, y: 150 },
                end: { x: 40, y: 200 }
              }
            ],
            autoRotate: true
          },
          keyframes: [
            { offset: 0, pathProgress: 0 },
            { offset: 1, pathProgress: 1 }
          ],
          timing: { durationMs: 100, easing: 'linear', fill: 'both' },
          composition: { mode: 'replace', weight: 1 }
        }
      ]
    })

    const track = element.motion?.tracks[0]
    expect(track?.composition).toEqual({
      mode: 'replace',
      weight: 1,
      priority: 0,
      sourceIndex: 0
    })
    expect(track?.keyframes.at(-1)?.x).toBe(40)
    const quarter = track?.keyframes.find((frame) => frame.offset === 0.25)
    expect(quarter?.x).toBeCloseTo(51.42186299841438, 9)

    const runtime = output.files.get('src/__motion-runtime.ts') as string
    const registered = Object.values(runtimeRegistry(runtime))[0]
    const registeredTrack = registered?.tracks[0]
    const xVariable = registeredTrack?.composition?.variables.x
    expect(xVariable).toBeDefined()
    if (!xVariable) throw new Error('Expected sampled path x composition variable')
    expect(
      registeredTrack?.keyframes.find((frame) => frame.offset === 0.25)?.[xVariable]
    ).toBeCloseTo(51.42186299841438, 9)
    expect(registeredTrack?.keyframes.some((frame) => frame.offsetPath !== undefined)).toBe(false)
  })

  test('keeps a box target when a v3 all-vector container animates corner radius', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const parent = graph.createNode('FRAME', pageId, {
      width: 80,
      height: 80,
      motion: {
        version: 3,
        tracks: [
          {
            id: 'round-container',
            trigger: 'mount',
            keyframes: [
              { offset: 0, cornerRadius: 0 },
              { offset: 1, cornerRadius: 24 }
            ],
            timing: { durationMs: 100 },
            composition: { mode: 'replace', weight: 1, priority: 2 }
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
        segments: [
          {
            start: 0,
            end: 1,
            tangentStart: { x: 0, y: 0 },
            tangentEnd: { x: 0, y: 0 }
          }
        ],
        regions: []
      }
    })

    const root = collectTree(graph, pageId).children[0] as IRElement
    expect(root.rawHtml).toBeUndefined()
    expect(root.motion?.target?.kind).toBe('box')
    expect((root.children[0] as IRElement).rawHtml).toContain('<svg')
  })

  test('omits v3 animated vector blur and shadow from the static SVG', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const vector = graph.createNode('VECTOR', pageId, {
      width: 80,
      height: 80,
      vectorNetwork: {
        vertices: [
          { x: 0, y: 0 },
          { x: 80, y: 80 }
        ],
        segments: [
          {
            start: 0,
            end: 1,
            tangentStart: { x: 0, y: 0 },
            tangentEnd: { x: 0, y: 0 }
          }
        ],
        regions: []
      },
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
          spread: 2,
          offset: { x: 2, y: 3 },
          color: { r: 0, g: 0, b: 0, a: 0.4 }
        }
      ],
      motion: {
        version: 3,
        tracks: [
          {
            id: 'animated-effects',
            trigger: 'mount',
            keyframes: [
              { offset: 0, blur: 0, shadowBlur: 0 },
              { offset: 1, blur: 12, shadowBlur: 16 }
            ],
            timing: { durationMs: 100 },
            composition: { mode: 'replace', weight: 1 }
          }
        ]
      }
    })

    const root = collectTree(graph, pageId).children[0] as IRElement
    expect(root.sourceId).toBe(vector.id)
    expect(root.motion?.target?.kind).toBe('vector')
    expect(root.rawHtml).toContain('<svg')
    expect(root.rawHtml).not.toContain('<feGaussianBlur')
    expect(root.rawHtml).not.toContain('<feDropShadow')
  })
})
