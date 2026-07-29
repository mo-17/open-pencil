import { describe, expect, test } from 'bun:test'

import { getCanvasKit } from '@open-pencil/core/canvaskit'
import {
  exportGraphMotion,
  getMotionExportCapabilities,
  MotionExportCancelledError,
  MotionExportCapabilityError,
  planGraphMotionExport,
  planMotionFrames,
  type MotionFrameRenderRequest
} from '@open-pencil/core/io'
import { SceneGraph, type MotionSpec } from '@open-pencil/scene-graph'

import { generatedEffect } from '#tests/helpers/generated-effect'

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const

function pngForFrame(request: MotionFrameRenderRequest): Uint8Array {
  const bytes = new Uint8Array(12)
  bytes.set(PNG_SIGNATURE)
  new DataView(bytes.buffer).setUint32(8, request.frame.timestampUs, true)
  return bytes
}

function graphFixture() {
  const graph = new SceneGraph()
  const page = graph.addPage('Motion export')
  const motion: MotionSpec = {
    version: 1,
    tracks: [
      {
        id: 'move',
        trigger: 'mount',
        keyframes: [
          { offset: 0, x: 0 },
          { offset: 1, x: 90 }
        ],
        timing: { durationMs: 100, easing: 'linear' }
      }
    ]
  }
  const node = graph.createNode('RECTANGLE', page.id, {
    x: 10,
    y: 20,
    width: 40,
    height: 30,
    motion
  })
  return { graph, page, node }
}

describe('deterministic Motion frame planning', () => {
  test('uses integer microsecond timestamps without accumulated frame error', () => {
    const plan = planMotionFrames({ durationMs: 100, fps: 30, loops: 2, width: 40, height: 30 })

    expect(plan.frameCount).toBe(6)
    expect(plan.timebase).toEqual({ numerator: 1, denominator: 30 })
    expect(plan.frames.map((frame) => frame.timestampUs)).toEqual([
      0, 33_333, 66_666, 100_000, 133_333, 166_666
    ])
    expect(plan.frames.map((frame) => frame.localTimeUs)).toEqual([
      0, 33_333, 66_666, 0, 33_333, 66_666
    ])
    expect(plan.frames.map((frame) => frame.loopIndex)).toEqual([0, 0, 0, 1, 1, 1])
    expect(plan.frames.at(-1)?.durationUs).toBe(33_334)
  })

  test('rejects fractional fps and unbounded pixel work', () => {
    expect(() => planMotionFrames({ durationMs: 100, fps: 29.97, width: 40, height: 30 })).toThrow(
      'fps must be an integer'
    )
    expect(() =>
      planMotionFrames({ durationMs: 10_000, fps: 120, width: 1_000, height: 1_000 })
    ).toThrow('total rendered pixels')
  })
})

describe('Motion animation export', () => {
  test('preflights the exact animated envelope used by export', async () => {
    const { graph, page, node } = graphFixture()
    const input = {
      graph,
      pageId: page.id,
      source: { kind: 'nodes' as const, nodeIds: [node.id], trigger: 'all' as const },
      fps: 30,
      padding: 5
    }
    const preflight = await planGraphMotionExport(input)
    let renderedBounds: MotionFrameRenderRequest['bounds'] | undefined
    const exported = await exportGraphMotion({
      ...input,
      renderFrame: async (request) => {
        renderedBounds ??= request.bounds
        return pngForFrame(request)
      }
    })

    expect(preflight.plan).toEqual(exported.plan)
    expect(preflight.bounds).toEqual(renderedBounds)
    expect(preflight.plan).toMatchObject({ fps: 30, pixelWidth: 110, pixelHeight: 40 })
  })

  test('samples fixed bounds and produces byte-identical PNG sequences', async () => {
    const { graph, page, node } = graphFixture()
    const requests: MotionFrameRenderRequest[] = []
    const run = () =>
      exportGraphMotion({
        graph,
        pageId: page.id,
        source: { kind: 'nodes', nodeIds: [node.id], trigger: 'all' },
        fps: 30,
        padding: 5,
        renderFrame: async (request) => {
          requests.push(request)
          return pngForFrame(request)
        }
      })

    const first = await run()
    const second = await run()
    expect(first.format).toBe('png-sequence')
    expect(second.format).toBe('png-sequence')
    if (first.format !== 'png-sequence' || second.format !== 'png-sequence') return

    expect(first.manifest.frameCount).toBe(3)
    expect(first.frames.map((frame) => [...frame.bytes])).toEqual(
      second.frames.map((frame) => [...frame.bytes])
    )
    expect(requests.slice(0, 3).every((request) => request.bounds === requests[0].bounds)).toBe(
      true
    )
    expect(requests.slice(3).every((request) => request.bounds === requests[3].bounds)).toBe(true)
    expect(requests[0].bounds).toEqual(requests[3].bounds)
    const sampledX = requests.slice(0, 3).map((request) => request.visuals.get(node.id)?.x)
    expect(sampledX[0]).toBe(0)
    expect(sampledX[1]).toBeCloseTo(29.9997, 8)
    expect(sampledX[2]).toBeCloseTo(59.9994, 8)
    expect(first.plan).toEqual(second.plan)
  })

  test('applies the explicit disable policy without mutating authored Motion', async () => {
    const { graph, page, node } = graphFixture()
    const original = structuredClone(node.motion)
    const visualSizes: number[] = []
    await exportGraphMotion({
      graph,
      pageId: page.id,
      source: { kind: 'nodes', nodeIds: [node.id] },
      reducedMotion: 'disable',
      renderFrame: async (request) => {
        visualSizes.push(request.visuals.size)
        return pngForFrame(request)
      }
    })

    expect(visualSizes).toEqual([0, 0, 0])
    expect(node.motion).toEqual(original)
  })

  test('exports referenced descendant tracks from a Motion scene sequence', async () => {
    const graph = new SceneGraph()
    const page = graph.addPage('Scene')
    const owner = graph.createNode('FRAME', page.id, { width: 100, height: 100 })
    const target = graph.createNode('RECTANGLE', owner.id, {
      width: 20,
      height: 20,
      motion: {
        version: 1,
        tracks: [
          {
            id: 'move',
            trigger: 'mount',
            keyframes: [
              { offset: 0, x: 0 },
              { offset: 1, x: 40 }
            ],
            timing: { durationMs: 100, easing: 'linear' }
          }
        ]
      }
    })
    graph.updateNode(owner.id, {
      motionScene: {
        version: 1,
        id: 'scene',
        sequences: [
          {
            id: 'intro',
            trigger: 'pageEnter',
            cues: [{ id: 'moveCue', targetNodeId: target.id, trackId: 'move', startMs: 50 }]
          }
        ]
      }
    })
    const sampled: number[] = []
    const result = await exportGraphMotion({
      graph,
      pageId: page.id,
      source: { kind: 'scene', ownerNodeId: owner.id, sequenceId: 'intro' },
      fps: 20,
      renderFrame: async (request) => {
        sampled.push(request.visuals.get(target.id)?.x ?? -1)
        return pngForFrame(request)
      }
    })

    expect(result.plan.frameCount).toBe(3)
    expect(sampled[0]).toBe(0)
    expect(sampled[1]).toBe(0)
    expect(sampled[2]).toBe(20)
  })

  test('reports progress and cancels before another frame is rendered', async () => {
    const { graph, page, node } = graphFixture()
    const controller = new AbortController()
    let rendered = 0
    const promise = exportGraphMotion({
      graph,
      pageId: page.id,
      source: { kind: 'nodes', nodeIds: [node.id] },
      signal: controller.signal,
      onProgress(progress) {
        if (progress.phase === 'render' && progress.completed === 1) controller.abort()
      },
      renderFrame: async (request) => {
        rendered++
        return pngForFrame(request)
      }
    })

    await expect(promise).rejects.toBeInstanceOf(MotionExportCancelledError)
    expect(rendered).toBe(1)
  })

  test('encodes a byte-stable built-in GIF that CanvasKit can decode', async () => {
    const { graph, page, node } = graphFixture()
    graph.updateNode(node.id, {
      fills: [
        {
          type: 'SOLID',
          color: { r: 1, g: 0, b: 0, a: 1 },
          opacity: 1,
          visible: true
        }
      ]
    })
    const run = () =>
      exportGraphMotion({
        graph,
        pageId: page.id,
        source: { kind: 'nodes', nodeIds: [node.id] },
        format: 'gif',
        fps: 20
      })
    const first = await run()
    const second = await run()
    if (first.format !== 'gif' || second.format !== 'gif') return

    expect([...first.bytes.subarray(0, 6)]).toEqual([...new TextEncoder().encode('GIF89a')])
    expect(first.bytes).toEqual(second.bytes)
    const ck = await getCanvasKit()
    const decoded = ck.MakeImageFromEncoded(first.bytes)
    expect(decoded).not.toBeNull()
    expect(decoded?.width()).toBe(first.plan.pixelWidth)
    expect(decoded?.height()).toBe(first.plan.pixelHeight)
    decoded?.delete()
    expect(first.alpha).toBe('binary-threshold')
    expect(first.determinism).toBe('bit-exact')
    expect(getMotionExportCapabilities().find((item) => item.format === 'gif')).toMatchObject({
      format: 'gif',
      available: true,
      mode: 'builtin',
      alpha: 'binary-threshold',
      determinism: 'bit-exact'
    })
  })

  test('fails closed for unavailable or fake encoded formats', async () => {
    const { graph, page, node } = graphFixture()
    const base = {
      graph,
      pageId: page.id,
      source: { kind: 'nodes' as const, nodeIds: [node.id] },
      renderFrame: async (request: MotionFrameRenderRequest) => pngForFrame(request)
    }

    await expect(exportGraphMotion({ ...base, format: 'webm' })).rejects.toBeInstanceOf(
      MotionExportCapabilityError
    )
    await expect(
      exportGraphMotion({
        ...base,
        format: 'gif',
        encoders: [
          {
            format: 'gif',
            mimeType: 'image/gif',
            extension: 'gif',
            capability: 'test encoder',
            async encode() {
              return new TextEncoder().encode('not a gif')
            }
          }
        ]
      })
    ).rejects.toThrow('expected file signature')
    expect(getMotionExportCapabilities().find((item) => item.format === 'mp4')).toEqual({
      format: 'mp4',
      available: false,
      mode: 'unavailable',
      reason: 'no allowlisted desktop ffmpeg/MP4 encoder capability is registered in this runtime'
    })
  })

  test('renders exact local generated-effect time through the real headless CanvasKit path', async () => {
    const { graph, page, node } = graphFixture()
    graph.updateNode(node.id, {
      generatedEffect: generatedEffect('particles'),
      fills: [
        {
          type: 'SOLID',
          color: { r: 1, g: 0, b: 0, a: 1 },
          opacity: 1,
          visible: true
        }
      ]
    })
    const run = () =>
      exportGraphMotion({
        graph,
        pageId: page.id,
        source: { kind: 'nodes', nodeIds: [node.id] },
        fps: 20,
        loops: 2
      })

    const first = await run()
    const second = await run()
    if (first.format !== 'png-sequence' || second.format !== 'png-sequence') return
    expect(first.frames.map((frame) => [...frame.bytes])).toEqual(
      second.frames.map((frame) => [...frame.bytes])
    )
    expect(first.plan.width).toBe(85)
    expect(first.frames[0].bytes).not.toEqual(first.frames[1].bytes)
    expect(first.frames[0].bytes).toEqual(first.frames[2].bytes)
    expect(first.frames[1].bytes).toEqual(first.frames[3].bytes)
  }, 20_000)
})
