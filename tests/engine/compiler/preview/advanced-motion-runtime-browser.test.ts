import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { chromium, type Browser, type Page } from '@playwright/test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { createPreviewServer, type PreviewServer } from '@open-pencil/compiler/dev-server'
import { vectorNetworkToSVGPaths } from '@open-pencil/core/io/formats/svg'
import { motionVectorTopologyId } from '@open-pencil/core/motion'
import type { MotionKeyframe, MotionSpec, VectorNetwork } from '@open-pencil/scene-graph'
import type { Vector } from '@open-pencil/scene-graph/primitives'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

interface AdvancedFixture {
  files: Map<string, string | Uint8Array>
  boxId: string
  textId: string
  vectorId: string
  vectorMidPath: string
}

function structuredSpec(id: string, frames: MotionKeyframe[]): MotionSpec {
  return {
    version: 3,
    reducedMotion: 'allow',
    tracks: [
      {
        id,
        trigger: 'click',
        keyframes: frames,
        timing: { durationMs: 1_000, easing: 'linear', fill: 'both' },
        exit: 'reset'
      }
    ]
  }
}

function network(points: Vector[]): VectorNetwork {
  return {
    vertices: points,
    segments: [
      { start: 0, end: 1, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
      { start: 1, end: 2, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
      { start: 2, end: 3, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
      { start: 3, end: 0, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } }
    ],
    regions: [{ windingRule: 'NONZERO', loops: [[0, 1, 2, 3]] }]
  }
}

function buildFixture(): AdvancedFixture {
  const graph = makeSceneGraph()
  const pageId = firstPageId(graph)
  const box = graph.createNode('RECTANGLE', pageId, {
    name: 'Structured box',
    x: 20,
    y: 20,
    width: 120,
    height: 80,
    fills: [
      { type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 }, opacity: 1, visible: true },
      {
        type: 'GRADIENT_LINEAR',
        color: { r: 0, g: 0, b: 0, a: 0 },
        opacity: 1,
        visible: true,
        gradientStops: [
          { position: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
          { position: 1, color: { r: 1, g: 1, b: 1, a: 1 } }
        ],
        gradientTransform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }
      }
    ],
    strokes: [
      {
        color: { r: 0, g: 0, b: 0, a: 1 },
        weight: 2,
        opacity: 1,
        visible: true,
        align: 'CENTER'
      }
    ],
    effects: [
      {
        type: 'DROP_SHADOW',
        color: { r: 0, g: 0, b: 0, a: 0.5 },
        offset: { x: 0, y: 2 },
        radius: 4,
        spread: 0,
        visible: true
      },
      {
        type: 'LAYER_BLUR',
        color: { r: 0, g: 0, b: 0, a: 0 },
        offset: { x: 0, y: 0 },
        radius: 0,
        spread: 0,
        visible: true
      }
    ],
    motion: structuredSpec('box-structured', [
      {
        offset: 0,
        paints: [
          { kind: 'fill', index: 0, color: { r: 1, g: 0, b: 0, a: 1 }, opacity: 1 },
          { kind: 'stroke', index: 0, color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1 }
        ],
        gradientStops: [
          {
            kind: 'fill',
            paintIndex: 1,
            stopIndex: 0,
            position: 0,
            color: { r: 0, g: 0, b: 0, a: 1 }
          }
        ],
        effects: [
          {
            kind: 'shadow',
            index: 0,
            x: 0,
            y: 2,
            blur: 4,
            spread: 0,
            color: { r: 0, g: 0, b: 0, a: 0.5 }
          },
          { kind: 'blur', index: 1, radius: 0 }
        ],
        cornerRadii: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 }
      },
      {
        offset: 1,
        paints: [
          { kind: 'fill', index: 0, color: { r: 0, g: 0, b: 1, a: 1 }, opacity: 0.5 },
          { kind: 'stroke', index: 0, color: { r: 0, g: 1, b: 0, a: 1 }, opacity: 0.5 }
        ],
        gradientStops: [
          {
            kind: 'fill',
            paintIndex: 1,
            stopIndex: 0,
            position: 0.5,
            color: { r: 0, g: 1, b: 0, a: 1 }
          }
        ],
        effects: [
          {
            kind: 'shadow',
            index: 0,
            x: 10,
            y: 12,
            blur: 14,
            spread: 4,
            color: { r: 1, g: 0, b: 1, a: 0.5 }
          },
          { kind: 'blur', index: 1, radius: 6 }
        ],
        cornerRadii: { topLeft: 10, topRight: 20, bottomRight: 30, bottomLeft: 40 }
      }
    ])
  })

  const text = graph.createNode('TEXT', pageId, {
    name: 'Structured text',
    x: 20,
    y: 120,
    width: 160,
    height: 40,
    text: 'A😀BC',
    fontVariations: [{ axis: 'wght', value: 400 }],
    motion: structuredSpec('text-structured', [
      { offset: 0, textReveal: 0, fontAxes: [{ tag: 'wght', value: 400 }] },
      { offset: 1, textReveal: 1, fontAxes: [{ tag: 'wght', value: 700 }] }
    ])
  })

  const authored = network([
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    { x: 40, y: 40 },
    { x: 0, y: 40 }
  ])
  const destination = [
    { x: 10, y: 0 },
    { x: 50, y: 10 },
    { x: 30, y: 50 },
    { x: -10, y: 30 }
  ]
  const vector = graph.createNode('VECTOR', pageId, {
    name: 'Structured vector',
    x: 220,
    y: 20,
    width: 60,
    height: 60,
    vectorNetwork: authored,
    fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 1, a: 1 }, opacity: 1, visible: true }]
  })
  const topologyId = motionVectorTopologyId(vector)
  if (!topologyId) throw new Error('expected vector topology')
  graph.updateNode(vector.id, {
    motion: structuredSpec('vector-structured', [
      {
        offset: 0,
        vectorMorph: {
          topologyId,
          points: authored.vertices.map(({ x, y }) => ({ x, y }))
        }
      },
      { offset: 1, vectorMorph: { topologyId, points: destination } }
    ])
  })
  const mid = network(
    authored.vertices.map((point, index) => ({
      x: (point.x + destination[index].x) / 2,
      y: (point.y + destination[index].y) / 2
    }))
  )
  return {
    files: compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'advanced-motion-runtime', devMode: false })
    }).files,
    boxId: box.id,
    textId: text.id,
    vectorId: vector.id,
    vectorMidPath: vectorNetworkToSVGPaths(mid)[0]
  }
}

async function seek(page: Page, nodeId: string, trackId: string): Promise<void> {
  await page.evaluate(
    ({ nodeId, trackId }) => {
      const runtime = (
        window as Window & {
          __OPENPENCIL_MOTION_RUNTIME__?: {
            stop(nodeId: string): void
            play(nodeId: string, trackId?: string): void
          }
        }
      ).__OPENPENCIL_MOTION_RUNTIME__
      const element = document.querySelector(`[data-node-id="${nodeId}"]`)
      if (!runtime || !element) throw new Error('missing advanced runtime target')
      runtime.stop(nodeId)
      runtime.play(nodeId, trackId)
      const animation = element.getAnimations().find((candidate) => candidate.playState !== 'idle')
      if (!animation) throw new Error('missing controlled animation')
      animation.pause()
      animation.currentTime = 500
    },
    { nodeId, trackId }
  )
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve())
        })
      })
  )
}

describe('preview browser — MotionSpec v3 structured runtime parity', () => {
  let server: PreviewServer | null = null
  let browser: Browser | null = null
  let page: Page | null = null

  beforeEach(async () => {
    server = await createPreviewServer({})
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 420, height: 260 } })
  }, 30_000)

  afterEach(async () => {
    await page?.close()
    await browser?.close()
    await server?.close()
    page = null
    browser = null
    server = null
  }, 30_000)

  test('projects paints, stops, effects, corners, text, font axes, and vector paths at fixed time', async () => {
    if (!server || !page) throw new Error('missing browser fixture')
    const fixture = buildFixture()
    server.updateFiles(fixture.files)
    await page.goto(server.url, { waitUntil: 'networkidle' })
    await page.waitForFunction(() => '__OPENPENCIL_MOTION_RUNTIME__' in window)

    await seek(page, fixture.boxId, 'box-structured')
    const box = await page.locator(`[data-node-id="${fixture.boxId}"]`).evaluate((element) => {
      const style = (element as HTMLElement).style
      return {
        backgroundImage: style.backgroundImage,
        borderColor: style.borderColor,
        borderRadius: style.borderRadius,
        filter: style.filter,
        boxShadow: style.boxShadow
      }
    })
    expect(box.backgroundImage).toContain('rgba(128, 0, 128, 0.75)')
    expect(box.backgroundImage).toContain('rgb(0, 128, 0) 25%')
    expect(box.borderColor).toBe('rgba(0, 128, 0, 0.75)')
    expect(box.borderRadius).toBe('5px 10px 15px 20px')
    expect(box.filter).toBe('blur(3px)')
    expect(box.boxShadow).toContain('5px 7px 9px 2px')

    await seek(page, fixture.textId, 'text-structured')
    const text = await page.locator(`[data-node-id="${fixture.textId}"]`).evaluate((element) => ({
      text: element.textContent,
      axes: (element as HTMLElement).style.fontVariationSettings
    }))
    expect(text).toEqual({ text: 'A😀', axes: '"wght" 550' })

    await seek(page, fixture.vectorId, 'vector-structured')
    const path = await page
      .locator(`[data-node-id="${fixture.vectorId}"] [data-op-morph-path-index="0"]`)
      .getAttribute('d')
    expect(path).toBe(fixture.vectorMidPath)
  }, 30_000)
})
