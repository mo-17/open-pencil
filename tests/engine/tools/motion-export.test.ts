import { describe, expect, test } from 'bun:test'

import { FigmaAPI } from '@open-pencil/core/figma-api'
import { MotionExportCancelledError } from '@open-pencil/core/io/motion-export'
import { ALL_TOOLS, CORE_TOOLS } from '@open-pencil/core/tools'
import { SceneGraph, type MotionSpec } from '@open-pencil/scene-graph'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])

function fixture() {
  const graph = new SceneGraph()
  const page = graph.addPage('Page')
  const motion: MotionSpec = {
    version: 1,
    tracks: [
      {
        id: 'fade',
        trigger: 'mount',
        keyframes: [
          { offset: 0, opacity: 0 },
          { offset: 1, opacity: 1 }
        ],
        timing: { durationMs: 100, easing: 'linear' }
      }
    ]
  }
  const node = graph.createNode('RECTANGLE', page.id, { width: 20, height: 10, motion })
  const figma = new FigmaAPI(graph)
  figma.currentPage = figma.wrapNode(page.id)
  figma.currentPage.selection = [figma.wrapNode(node.id)]
  return { figma, node }
}

describe('export_motion_animation tool', () => {
  test('is available to built-in AI as well as MCP', () => {
    expect(CORE_TOOLS.some((candidate) => candidate.name === 'export_motion_animation')).toBe(true)
    expect(
      ALL_TOOLS.filter((candidate) => candidate.name === 'export_motion_animation')
    ).toHaveLength(1)
  })

  test('exports bounded sampled frames through the host raster adapter', async () => {
    const { figma, node } = fixture()
    const opacities: number[] = []
    const generatedEffectFrames: Array<{ timeMs: number | undefined; mode: string | undefined }> =
      []
    figma.exportImage = async (_ids, options) => {
      opacities.push(options.motionVisualStates?.get(node.id)?.opacity ?? -1)
      generatedEffectFrames.push({
        timeMs: options.generatedEffectTimeMs,
        mode: options.generatedEffectMode
      })
      return PNG
    }
    const tool = ALL_TOOLS.find((candidate) => candidate.name === 'export_motion_animation')
    expect(tool).toBeDefined()
    const result = (await tool?.execute(figma, {
      path: 'sequence',
      fps: 30,
      format: 'png-sequence',
      reduced_motion: 'reduce'
    })) as {
      format: string
      frames: Array<{ file: string; base64: string; byteLength: number }>
      manifest: { frameCount: number }
    }

    expect(result.format).toBe('png-sequence')
    expect(result.manifest.frameCount).toBe(3)
    expect(result.frames.map((frame) => frame.file)).toEqual([
      'frame-0000.png',
      'frame-0001.png',
      'frame-0002.png'
    ])
    expect(result.frames.every((frame) => frame.byteLength === PNG.length)).toBe(true)
    expect(opacities[0]).toBe(0)
    expect(opacities[1]).toBeCloseTo(0.33333, 5)
    expect(opacities[2]).toBeCloseTo(0.66666, 5)
    expect(generatedEffectFrames).toEqual([
      { timeMs: 0, mode: 'reduce' },
      { timeMs: 33.333, mode: 'reduce' },
      { timeMs: 66.666, mode: 'reduce' }
    ])
  })

  test('propagates request progress and cancellation through ToolCtx', async () => {
    const { figma } = fixture()
    figma.exportImage = async () => PNG
    const tool = ALL_TOOLS.find((candidate) => candidate.name === 'export_motion_animation')
    const progress: Array<{ phase: string; completed: number; total: number }> = []
    await tool?.execute(
      figma,
      { path: 'sequence', fps: 30, format: 'png-sequence' },
      { onProgress: (value) => progress.push(value) }
    )
    expect(progress[0]).toEqual({ phase: 'prepare', completed: 0, total: 1 })
    expect(progress.some(({ phase, completed }) => phase === 'render' && completed > 0)).toBe(true)

    const controller = new AbortController()
    controller.abort()
    await expect(
      tool?.execute(
        figma,
        { path: 'cancelled', fps: 30, format: 'png-sequence' },
        { signal: controller.signal }
      )
    ).rejects.toBeInstanceOf(MotionExportCancelledError)
  })

  test('lets an app host commit the artifact without returning base64 to the model', async () => {
    const { figma } = fixture()
    figma.exportImage = async () => PNG
    const tool = ALL_TOOLS.find((candidate) => candidate.name === 'export_motion_animation')
    let savedFormat = ''
    const result = await tool?.execute(
      figma,
      { path: 'AI export', fps: 30, format: 'png-sequence' },
      {
        async saveMotionExport(animation, name) {
          savedFormat = `${animation.format}:${name}`
          return true
        }
      }
    )

    expect(savedFormat).toBe('png-sequence:AI export')
    expect(result).toMatchObject({
      saved: true,
      cancelled: false,
      format: 'png-sequence',
      frameCount: 3
    })
    if (!result || typeof result !== 'object') throw new Error('Expected Motion export result')
    expect('base64' in result ? result.base64 : undefined).toBeUndefined()
    expect('frames' in result ? result.frames : undefined).toBeUndefined()
  })
})
