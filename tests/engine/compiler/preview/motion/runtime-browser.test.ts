import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { chromium, type Browser, type Page } from '@playwright/test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { createPreviewServer, type PreviewServer } from '@open-pencil/compiler/dev-server'
import type { MotionSpec, MotionTrack, SceneGraph } from '@open-pencil/scene-graph'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

interface MotionBrowserFixture {
  files: Map<string, string | Uint8Array>
  finiteId: string
  loopingId: string
  precedenceId: string
  componentTriggerId: string
  componentSiblingId: string
}

interface BrowserMotionDebugEntry {
  trackId: string
  source: string
}

interface BrowserMotionDebugSnapshot {
  activeAnimationCount: number
  entries: BrowserMotionDebugEntry[]
}

interface BrowserMotionRuntime {
  inspect(targetNodeId?: string): BrowserMotionDebugSnapshot
  pageExit(options?: { timeoutMs?: number }): Promise<{
    status: 'finished' | 'stopped' | 'timeout' | 'missing'
  }>
  play(targetNodeId: string, trackId?: string, scope?: Element): void
  stop(targetNodeId: string, trackId?: string, scope?: Element): void
}

interface BrowserMotionWindow extends Window {
  __OPENPENCIL_MOTION_RUNTIME__?: BrowserMotionRuntime
}

function motion(tracks: MotionTrack[]): MotionSpec {
  return { version: 1, reducedMotion: 'allow', tracks }
}

function opacityTrack(
  id: string,
  trigger: MotionTrack['trigger'],
  opacity: number,
  durationMs: number,
  extra: Partial<MotionTrack['timing']> = {}
): MotionTrack {
  return {
    id,
    trigger,
    keyframes: [
      { offset: 0, opacity: 1 },
      { offset: 1, opacity }
    ],
    timing: { durationMs, fill: 'both', ...extra },
    exit: 'reset'
  }
}

function buildMotionBrowserFixture(): MotionBrowserFixture {
  const graph = makeSceneGraph()
  const pageId = firstPageId(graph)
  const finite = graph.createNode('RECTANGLE', pageId, {
    name: 'Finite',
    x: 20,
    y: 20,
    width: 80,
    height: 40,
    motion: motion([opacityTrack('enter', 'mount', 0.6, 80)])
  })
  const looping = graph.createNode('RECTANGLE', pageId, {
    name: 'Looping',
    x: 20,
    y: 80,
    width: 80,
    height: 40,
    motion: motion([
      opacityTrack('long-mount', 'mount', 0.7, 4_000),
      opacityTrack('long-loop', 'loop', 0.8, 6_000, { iterations: 'infinite' })
    ])
  })
  const precedence = graph.createNode('RECTANGLE', pageId, {
    name: 'Precedence',
    x: 20,
    y: 140,
    width: 80,
    height: 40,
    motion: motion([
      opacityTrack('press-first', 'press', 0.8, 60),
      opacityTrack('hover-later', 'hover', 0.4, 60)
    ])
  })
  const sourcePage = graph.addPage('Components')
  const master = graph.createNode('COMPONENT', sourcePage.id, { name: 'Scoped Runtime Card' })
  const componentTrigger = graph.createNode('BUTTON', master.id, {
    interactiveProps: { text: 'Play' },
    motion: motion([opacityTrack('trigger', 'hover', 0.9, 4_000)])
  })
  const componentSibling = graph.createNode('RECTANGLE', master.id, {
    width: 40,
    height: 40,
    motion: motion([opacityTrack('sibling', 'hover', 0.5, 4_000)])
  })
  graph.updateNode(componentTrigger.id, {
    events: {
      onClick: [
        { id: 'self', kind: 'playMotion', targetNodeId: componentTrigger.id },
        { id: 'sibling', kind: 'playMotion', targetNodeId: componentSibling.id }
      ]
    }
  })
  const firstInstance = graph.createInstance(master.id, pageId)
  const secondInstance = graph.createInstance(master.id, pageId)
  if (!firstInstance || !secondInstance) throw new Error('missing scoped component instances')
  graph.updateNode(firstInstance.id, { x: 140, y: 20 })
  graph.updateNode(secondInstance.id, { x: 240, y: 20 })
  addProgrammaticTrigger(graph, pageId, finite.id)
  const files = compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({ packageName: 'motion-runtime-browser', devMode: false })
  }).files
  return {
    files,
    finiteId: finite.id,
    loopingId: looping.id,
    precedenceId: precedence.id,
    componentTriggerId: componentTrigger.id,
    componentSiblingId: componentSibling.id
  }
}

function addProgrammaticTrigger(graph: SceneGraph, pageId: string, targetNodeId: string): void {
  graph.createNode('BUTTON', pageId, {
    name: 'Replay',
    x: 120,
    y: 20,
    width: 80,
    height: 40,
    interactiveProps: { text: 'Replay' },
    events: {
      onClick: [{ id: 'replay', kind: 'playMotion', targetNodeId, trackId: 'enter' }]
    }
  })
}

function buildPageExitNavigationFixture(): {
  files: Map<string, string | Uint8Array>
  exitingNodeId: string
} {
  const graph = makeSceneGraph()
  const homeId = firstPageId(graph)
  graph.updateNode(homeId, { name: 'Home' })
  const exiting = graph.createNode('RECTANGLE', homeId, {
    name: 'Leaving',
    width: 80,
    height: 40,
    motion: motion([opacityTrack('leave', 'pageExit', 0, 180)])
  })
  graph.createNode('BUTTON', homeId, {
    name: 'Go',
    y: 60,
    width: 80,
    height: 40,
    interactiveProps: { text: 'Go' },
    events: { onClick: [{ id: 'go', kind: 'navigate', to: '/about' }] }
  })
  const about = graph.addPage('About')
  graph.createNode('TEXT', about.id, { text: 'Arrived', width: 120, height: 30 })
  return {
    files: compile({
      graph,
      pageIds: [homeId, about.id],
      options: withDefaults({ packageName: 'motion-page-exit-navigation', devMode: false })
    }).files,
    exitingNodeId: exiting.id
  }
}

describe('preview browser — generated Motion runtime', () => {
  const hookTimeoutMs = 30_000
  let server: PreviewServer | null = null
  let browser: Browser | null = null
  let page: Page | null = null

  beforeEach(async () => {
    server = await createPreviewServer({})
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 360, height: 240 }, deviceScaleFactor: 1 })
  }, hookTimeoutMs)

  afterEach(async () => {
    try {
      if (page) await page.close()
    } finally {
      try {
        if (browser) await browser.close()
      } finally {
        if (server) await server.close()
        page = null
        browser = null
        server = null
      }
    }
  }, hookTimeoutMs)

  test('stops CSS/WAAPI precisely, preserves fill, and honors authored order', async () => {
    if (!server || !page) throw new Error('missing preview test runtime')
    const fixture = buildMotionBrowserFixture()
    server.updateFiles(fixture.files)
    await page.goto(server.url, { waitUntil: 'networkidle' })
    await page.waitForFunction(() => '__OPENPENCIL_MOTION_RUNTIME__' in window)

    await page.evaluate((nodeId) => {
      const element = document.querySelector(`[data-node-id="${nodeId}"]`)
      if (!element) throw new Error('missing finite motion element')
      ;(element as HTMLElement).dataset.cssAnimationStarts = '0'
      element.addEventListener('animationstart', () => {
        const html = element as HTMLElement
        html.dataset.cssAnimationStarts = String(Number(html.dataset.cssAnimationStarts ?? '0') + 1)
      })
      const runtime = (window as BrowserMotionWindow).__OPENPENCIL_MOTION_RUNTIME__
      if (!runtime) throw new Error('missing generated motion runtime')
      runtime.play(nodeId, 'enter')
    }, fixture.finiteId)
    await page.waitForTimeout(180)
    const finiteAfterFinish = await motionState(page, fixture.finiteId)
    await page.waitForTimeout(160)
    const finiteAfterSettled = await motionState(page, fixture.finiteId)
    expect(finiteAfterFinish.cssAnimationStarts).toBe(0)
    expect(finiteAfterFinish.animationTypes).toEqual(['Animation'])
    expect(finiteAfterFinish.playStates).toEqual(['finished'])
    expect(finiteAfterFinish.suppressedCssTracks).toBeGreaterThan(0)
    expect(finiteAfterSettled).toEqual(finiteAfterFinish)

    await callMotionRuntime(page, 'stop', fixture.finiteId, 'enter')
    expect((await motionState(page, fixture.finiteId)).animationTypes).toEqual([])

    await callMotionRuntime(page, 'stop', fixture.loopingId, 'long-mount')
    const oneLoopLeft = await motionState(page, fixture.loopingId)
    expect(oneLoopLeft.durations).toEqual([6_000])
    await callMotionRuntime(page, 'stop', fixture.loopingId)
    expect((await motionState(page, fixture.loopingId)).animationTypes).toEqual([])

    await page.evaluate((nodeId) => {
      const element = document.querySelector(`[data-node-id="${nodeId}"]`)
      if (!element) throw new Error('missing precedence motion element')
      element.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, relatedTarget: null }))
      const runtime = (window as BrowserMotionWindow).__OPENPENCIL_MOTION_RUNTIME__
      runtime?.play(nodeId, 'press-first', element)
    }, fixture.precedenceId)
    await page.waitForTimeout(120)
    const finalOpacity = await page
      .locator(`[data-node-id="${fixture.precedenceId}"]`)
      .evaluate((element) => Number.parseFloat(getComputedStyle(element).opacity))
    expect(finalOpacity).toBeCloseTo(0.4, 2)

    const scopes = page.locator('[data-op-motion-scope]')
    expect(await scopes.count()).toBe(2)
    await scopes
      .nth(0)
      .locator(`[data-node-id="${fixture.componentTriggerId}"]`)
      .dispatchEvent('click')
    const scopedAnimationCounts = await scopes.evaluateAll(
      (roots, ids) =>
        roots.map((root) =>
          ids.map(
            (id) => root.querySelector(`[data-node-id="${id}"]`)?.getAnimations().length ?? -1
          )
        ),
      [fixture.componentTriggerId, fixture.componentSiblingId]
    )
    expect(scopedAnimationCounts).toEqual([
      [1, 1],
      [0, 0]
    ])
  }, 30_000)

  test('waits for pageExit before routing and does not block when the runtime is missing', async () => {
    if (!server || !page) throw new Error('missing preview test runtime')
    const fixture = buildPageExitNavigationFixture()
    server.updateFiles(fixture.files)
    await page.goto(server.url, { waitUntil: 'networkidle' })
    await page.waitForFunction(() => '__OPENPENCIL_MOTION_RUNTIME__' in window)

    await page.getByRole('button', { name: 'Go' }).click()
    await page.waitForTimeout(50)
    expect(new URL(page.url()).pathname).toBe('/')
    expect((await motionState(page, fixture.exitingNodeId)).playStates).toEqual(['running'])
    await page.waitForURL((url) => url.pathname === '/about')
    await page.getByText('Arrived').waitFor()

    await page.goto(server.url, { waitUntil: 'networkidle' })
    await page.waitForFunction(() => '__OPENPENCIL_MOTION_RUNTIME__' in window)
    await page.evaluate(() => {
      delete (window as BrowserMotionWindow).__OPENPENCIL_MOTION_RUNTIME__
    })
    await page.getByRole('button', { name: 'Go' }).click()
    await page.waitForURL((url) => url.pathname === '/about')
    await page.getByText('Arrived').waitFor()
  }, 30_000)

  test('hot-adding the first runtime module reloads the preview and evaluates its entry import', async () => {
    if (!server || !page) throw new Error('missing preview test runtime')
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const node = graph.createNode('RECTANGLE', pageId, {
      name: 'HotAddedMotion',
      x: 20,
      y: 20,
      width: 80,
      height: 40
    })
    const compilePreview = () =>
      compile({
        graph,
        pageIds: [pageId],
        options: withDefaults({ packageName: 'motion-runtime-hmr', devMode: false })
      }).files

    server.updateFiles(compilePreview())
    await page.goto(server.url, { waitUntil: 'networkidle' })
    expect(await page.evaluate(() => '__OPENPENCIL_MOTION_RUNTIME__' in window)).toBeFalse()

    graph.updateNode(node.id, {
      motion: motion([
        opacityTrack('hot-enter', 'mount', 0.5, 900),
        opacityTrack('hot-hover', 'hover', 0.7, 600)
      ])
    })
    const reloaded = page.waitForEvent('load')
    server.updateFiles(compilePreview())
    await reloaded
    await page.waitForFunction(() => '__OPENPENCIL_MOTION_RUNTIME__' in window)

    const inspected = await page.evaluate((nodeId) => {
      const runtime = (window as BrowserMotionWindow).__OPENPENCIL_MOTION_RUNTIME__
      const element = document.querySelector(`[data-node-id="${CSS.escape(nodeId)}"]`)
      if (!runtime || !element) throw new Error('hot-added Motion runtime was not installed')
      return {
        snapshot: runtime.inspect(nodeId),
        browserAnimationTypes: element
          .getAnimations()
          .map((animation) => animation.constructor.name)
      }
    }, node.id)
    expect(inspected.snapshot).toMatchObject({
      activeAnimationCount: 1,
      entries: [
        { trackId: 'hot-enter', source: 'automatic' },
        { trackId: 'hot-hover', source: 'idle' }
      ]
    })
    expect(inspected.browserAnimationTypes).toEqual(['Animation'])
  }, 30_000)

  test('hot-adding the first CSS Motion refreshes the dev inspection runtime without manual reload', async () => {
    if (!server || !page) throw new Error('missing preview test runtime')
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const node = graph.createNode('RECTANGLE', pageId, {
      name: 'HotAddedDevMotion',
      width: 80,
      height: 40
    })
    const compilePreview = () =>
      compile({
        graph,
        pageIds: [pageId],
        options: withDefaults({ packageName: 'motion-dev-hmr', devMode: true })
      }).files

    server.updateFiles(compilePreview())
    await page.goto(server.url, { waitUntil: 'networkidle' })
    expect(
      await page.evaluate(() => {
        const runtime = (window as BrowserMotionWindow).__OPENPENCIL_MOTION_RUNTIME__
        return runtime?.inspect().entries.length
      })
    ).toBe(0)

    graph.updateNode(node.id, {
      motion: motion([opacityTrack('dev-enter', 'mount', 0.5, 900)])
    })
    const reloaded = page.waitForEvent('load')
    server.updateFiles(compilePreview())
    await reloaded
    await page.waitForFunction((nodeId) => {
      const runtime = (window as BrowserMotionWindow).__OPENPENCIL_MOTION_RUNTIME__
      return runtime?.inspect(nodeId as string).entries.length === 1
    }, node.id)

    const inspected = await page.evaluate((nodeId) => {
      const runtime = (window as BrowserMotionWindow).__OPENPENCIL_MOTION_RUNTIME__
      const element = document.querySelector(`[data-node-id="${CSS.escape(nodeId)}"]`)
      if (!runtime || !element) throw new Error('hot-added dev Motion was not installed')
      return {
        snapshot: runtime.inspect(nodeId),
        browserAnimationTypes: element
          .getAnimations()
          .map((animation) => animation.constructor.name)
      }
    }, node.id)
    expect(inspected.snapshot).toMatchObject({
      activeAnimationCount: 0,
      entries: [{ trackId: 'dev-enter', source: 'automatic' }]
    })
    expect(inspected.browserAnimationTypes).toEqual(['CSSAnimation'])
  }, 30_000)
})

async function callMotionRuntime(
  page: Page,
  method: 'play' | 'stop',
  nodeId: string,
  trackId?: string
): Promise<void> {
  await page.evaluate(
    ({ method, nodeId, trackId }) => {
      const runtime = (window as BrowserMotionWindow).__OPENPENCIL_MOTION_RUNTIME__
      if (!runtime) throw new Error('missing generated motion runtime')
      runtime[method](nodeId, trackId)
    },
    { method, nodeId, trackId }
  )
}

async function motionState(
  page: Page,
  nodeId: string
): Promise<{
  animationTypes: string[]
  playStates: AnimationPlayState[]
  durations: number[]
  cssAnimationStarts: number
  suppressedCssTracks: number
}> {
  return await page.locator(`[data-node-id="${nodeId}"]`).evaluate((element) => {
    const animations = element.getAnimations()
    return {
      animationTypes: animations.map((animation) => animation.constructor.name),
      playStates: animations.map((animation) => animation.playState),
      durations: animations.map((animation) => Number(animation.effect?.getTiming().duration ?? 0)),
      cssAnimationStarts: Number((element as HTMLElement).dataset.cssAnimationStarts ?? '0'),
      suppressedCssTracks: [...(element as HTMLElement).style].filter(
        (property) => property.startsWith('--op-') && property.endsWith('-name')
      ).length
    }
  })
}
