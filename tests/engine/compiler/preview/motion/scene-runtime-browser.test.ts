import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { chromium, type Browser, type Page } from '@playwright/test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { createPreviewServer, type PreviewServer } from '@open-pencil/compiler/dev-server'
import type { MotionSceneSpec, MotionSpec, MotionTrack } from '@open-pencil/scene-graph'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

interface MotionSceneBrowserFixture {
  files: Map<string, string | Uint8Array>
  homeId: string
  targetId: string
  frameId: string
  frameTargetId: string
}

interface BrowserSceneRuntime {
  inspect(
    ownerId?: string,
    scope?: Element
  ): {
    activeRunCount: number
    runs: Array<{ sequenceId: string; status: string }>
  }
  play(
    ownerId: string,
    sequenceId: string,
    options?: { scope?: Element; timeoutMs?: number }
  ): {
    status: string
    animationCount: number
    finished: Promise<{ status: string; animationCount: number }>
  }
}

interface BrowserSceneWindow extends Window {
  __OPENPENCIL_MOTION_SCENE_RUNTIME__?: BrowserSceneRuntime
}

function track(
  id: string,
  opacity: [number, number],
  durationMs: number,
  delayMs = 0
): MotionTrack {
  return {
    id,
    trigger: 'click',
    keyframes: [
      { offset: 0, opacity: opacity[0] },
      { offset: 1, opacity: opacity[1] }
    ],
    timing: { durationMs, delayMs, easing: 'linear', fill: 'both' },
    exit: 'reset'
  }
}

function buildFixture(): MotionSceneBrowserFixture {
  const graph = makeSceneGraph()
  const homeId = firstPageId(graph)
  graph.updateNode(homeId, { name: 'Home' })
  const motion: MotionSpec = {
    version: 1,
    reducedMotion: 'reduce',
    tracks: [
      track('enter-track', [0, 0.6], 160, 40),
      track('exit-track', [0.6, 0], 180),
      track('manual-track', [0.6, 0.9], 200)
    ]
  }
  const target = graph.createNode('RECTANGLE', homeId, {
    name: 'Scene target',
    width: 100,
    height: 60,
    motion
  })
  const frame = graph.createNode('FRAME', homeId, {
    name: 'Nested scene owner',
    y: 100,
    width: 110,
    height: 70
  })
  const frameTarget = graph.createNode('RECTANGLE', frame.id, {
    name: 'Nested scene target',
    width: 90,
    height: 50,
    motion: {
      version: 1,
      reducedMotion: 'reduce',
      tracks: [
        track('frame-enter-track', [0, 0.5], 120, 20),
        track('frame-exit-track', [0.5, 0], 120),
        track('frame-manual-track', [0.5, 1], 160)
      ]
    }
  })
  graph.createNode('BUTTON', homeId, {
    name: 'Go',
    x: 120,
    width: 80,
    height: 40,
    interactiveProps: { text: 'Go' },
    events: { onClick: [{ id: 'go', kind: 'navigate', to: '/about' }] }
  })
  const about = graph.addPage('About')
  graph.createNode('TEXT', about.id, { text: 'Arrived', width: 120, height: 30 })
  const motionScene: MotionSceneSpec = {
    version: 1,
    id: 'home-scene',
    sequences: [
      {
        id: 'enter-sequence',
        trigger: 'pageEnter',
        cues: [
          {
            id: 'enter-cue',
            targetNodeId: target.id,
            trackId: 'enter-track',
            startMs: 60,
            timeScale: 2
          }
        ]
      },
      {
        id: 'exit-sequence',
        trigger: 'pageExit',
        cues: [
          {
            id: 'exit-cue',
            targetNodeId: target.id,
            trackId: 'exit-track',
            startMs: 0
          }
        ]
      },
      {
        id: 'manual-sequence',
        trigger: 'manual',
        cues: [
          {
            id: 'manual-cue',
            targetNodeId: target.id,
            trackId: 'manual-track',
            startMs: 20,
            timeScale: 2
          }
        ]
      }
    ]
  }
  graph.updateNode(homeId, { motionScene })
  graph.updateNode(frame.id, {
    motionScene: {
      version: 1,
      id: 'frame-scene',
      sequences: [
        {
          id: 'frame-enter-sequence',
          trigger: 'pageEnter',
          cues: [
            {
              id: 'frame-enter-cue',
              targetNodeId: frameTarget.id,
              trackId: 'frame-enter-track',
              startMs: 30,
              timeScale: 2
            }
          ]
        },
        {
          id: 'frame-exit-sequence',
          trigger: 'pageExit',
          cues: [
            {
              id: 'frame-exit-cue',
              targetNodeId: frameTarget.id,
              trackId: 'frame-exit-track',
              startMs: 0
            }
          ]
        },
        {
          id: 'frame-manual-sequence',
          trigger: 'manual',
          cues: [
            {
              id: 'frame-manual-cue',
              targetNodeId: frameTarget.id,
              trackId: 'frame-manual-track',
              startMs: 10,
              timeScale: 2
            }
          ]
        }
      ]
    }
  })
  return {
    files: compile({
      graph,
      pageIds: [homeId, about.id],
      options: withDefaults({ packageName: 'motion-scene-browser', devMode: false })
    }).files,
    homeId,
    targetId: target.id,
    frameId: frame.id,
    frameTargetId: frameTarget.id
  }
}

describe('preview browser — generated Motion scene runtime', () => {
  const hookTimeoutMs = 30_000
  let server: PreviewServer | null = null
  let browser: Browser | null = null
  let page: Page | null = null

  beforeEach(async () => {
    server = await createPreviewServer({})
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 360, height: 240 } })
  }, hookTimeoutMs)

  afterEach(async () => {
    try {
      await page?.close()
    } finally {
      try {
        await browser?.close()
      } finally {
        await server?.close()
        page = null
        browser = null
        server = null
      }
    }
  }, hookTimeoutMs)

  test('runs enter/manual/exit sequences with scoped timing and cleans up after routing', async () => {
    if (!server || !page) throw new Error('missing preview test runtime')
    const fixture = buildFixture()
    server.updateFiles(fixture.files)
    await page.goto(server.url, { waitUntil: 'networkidle' })
    await page.waitForFunction(() => '__OPENPENCIL_MOTION_SCENE_RUNTIME__' in window)

    const enterTiming = await animationTiming(page, fixture.targetId)
    expect(enterTiming).toEqual({ delay: 80, duration: 80 })
    expect(await animationTiming(page, fixture.frameTargetId)).toEqual({ delay: 40, duration: 60 })

    const manual = await page.evaluate(
      async ({ homeId, targetId, frameId, frameTargetId }) => {
        const runtime = (window as BrowserSceneWindow).__OPENPENCIL_MOTION_SCENE_RUNTIME__
        const scope = document.querySelector(`[data-op-motion-scene-owner="${CSS.escape(homeId)}"]`)
        const frameScope = document.querySelector(
          `[data-op-motion-scene-owner="${CSS.escape(frameId)}"]`
        )
        if (!runtime || !scope || !frameScope) {
          throw new Error('missing generated scene runtime scope')
        }
        const invalid = runtime.play(homeId, 'enter-sequence', { scope })
        const target = document.querySelector(`[data-node-id="${CSS.escape(targetId)}"]`)
        const frameTarget = document.querySelector(`[data-node-id="${CSS.escape(frameTargetId)}"]`)
        if (!target || !frameTarget) throw new Error('missing scene target')
        const escaped = runtime.play(homeId, 'manual-sequence', { scope: target })
        const started = runtime.play(homeId, 'manual-sequence', { scope })
        const frameStarted = runtime.play(frameId, 'frame-manual-sequence', {
          scope: frameScope
        })
        const running = target
          .getAnimations()
          .find((animation) => animation.playState === 'running')
        const timing = running?.effect?.getTiming()
        return {
          invalidStatus: invalid.status,
          escapedStatus: escaped.status,
          startedStatus: started.status,
          duration: timing?.duration,
          delay: timing?.delay,
          completion: await started.finished,
          frameCompletion: await frameStarted.finished
        }
      },
      {
        homeId: fixture.homeId,
        targetId: fixture.targetId,
        frameId: fixture.frameId,
        frameTargetId: fixture.frameTargetId
      }
    )
    expect(manual).toMatchObject({
      invalidStatus: 'missing',
      escapedStatus: 'missing',
      startedStatus: 'running',
      duration: 100,
      delay: 20,
      completion: { status: 'finished', animationCount: 1 },
      frameCompletion: { status: 'finished', animationCount: 1 }
    })

    await page.getByRole('button', { name: 'Go' }).click()
    await page.waitForTimeout(50)
    expect(new URL(page.url()).pathname).toBe('/')
    expect(
      await page.evaluate((homeId) => {
        const runtime = (window as BrowserSceneWindow).__OPENPENCIL_MOTION_SCENE_RUNTIME__
        return runtime?.inspect(homeId).runs.some((run) => run.sequenceId === 'exit-sequence')
      }, fixture.homeId)
    ).toBe(true)
    await page.waitForURL((url) => url.pathname === '/about')
    await page.getByText('Arrived').waitFor()
    await page.waitForFunction((homeId) => {
      const runtime = (window as BrowserSceneWindow).__OPENPENCIL_MOTION_SCENE_RUNTIME__
      return runtime?.inspect(homeId).runs.length === 0
    }, fixture.homeId)
    expect(
      await page.evaluate((frameId) => {
        const runtime = (window as BrowserSceneWindow).__OPENPENCIL_MOTION_SCENE_RUNTIME__
        return runtime?.inspect(frameId).runs.length
      }, fixture.frameId)
    ).toBe(0)

    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto(server.url, { waitUntil: 'networkidle' })
    await page.waitForFunction(() => '__OPENPENCIL_MOTION_SCENE_RUNTIME__' in window)
    expect(await animationTiming(page, fixture.targetId)).toEqual({ delay: 0, duration: 80 })
    expect(await animationTiming(page, fixture.frameTargetId)).toEqual({ delay: 0, duration: 60 })
  }, 30_000)
})

async function animationTiming(
  page: Page,
  nodeId: string
): Promise<{ delay: number; duration: number }> {
  return page.locator(`[data-node-id="${nodeId}"]`).evaluate((element) => {
    const animation = element.getAnimations().at(-1)
    const timing = animation?.effect?.getTiming()
    if (!timing || typeof timing.duration !== 'number') {
      throw new Error('missing generated scene animation')
    }
    return { delay: timing.delay ?? 0, duration: timing.duration }
  })
}
