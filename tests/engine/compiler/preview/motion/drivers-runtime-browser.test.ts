import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { chromium, type Browser, type Page } from '@playwright/test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { createPreviewServer, type PreviewServer } from '@open-pencil/compiler/dev-server'
import type { MotionDriverSpecV1, MotionSpec } from '@open-pencil/scene-graph'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

declare global {
  interface Window {
    __setOpenPencilReducedMotion?: (matches: boolean) => void
  }
}

function motion(): MotionSpec {
  return {
    version: 1,
    reducedMotion: 'reduce',
    tracks: [
      {
        id: 'progress',
        trigger: 'mount',
        keyframes: [
          { offset: 0, x: 0, opacity: 0.2 },
          { offset: 1, x: 100, opacity: 1 }
        ],
        timing: { durationMs: 1_000, easing: 'linear', fill: 'both' }
      }
    ]
  }
}

function spec(
  id: string,
  source: MotionDriverSpecV1['drivers'][number]['source'],
  targetNodeId: string,
  inputMax = 1
): MotionDriverSpecV1 {
  return {
    version: 1,
    drivers: [
      {
        id,
        source,
        target: { targetNodeId, trackId: 'progress' },
        mapping: { inputMin: 0, inputMax, clamp: true }
      }
    ]
  }
}

function buildFixture() {
  const graph = makeSceneGraph()
  const pageId = firstPageId(graph)
  graph.updateNode(graph.rootId, {
    lowcodeDocumentState: [
      { id: 'document-progress', name: 'documentProgress', type: 'number', defaultValue: 0 }
    ]
  })
  const stateTarget = graph.createNode('RECTANGLE', pageId, {
    name: 'State target',
    width: 30,
    height: 30,
    motion: motion()
  })
  graph.updateNode(pageId, {
    state: [{ id: 'page-progress', name: 'pageProgress', type: 'number', defaultValue: 0 }],
    motionDrivers: spec(
      'page-progress-driver',
      { kind: 'pageState', stateId: 'page-progress' },
      stateTarget.id
    )
  })
  const visibilitySource = graph.createNode('RECTANGLE', pageId, {
    name: 'Visibility source',
    x: 520,
    y: 100,
    width: 100,
    height: 100
  })
  const visibilityTarget = graph.createNode('RECTANGLE', pageId, {
    name: 'Visibility target',
    x: 520,
    y: 220,
    width: 30,
    height: 30,
    motion: motion()
  })
  const pageDrivers = graph.getNode(pageId)?.motionDrivers
  if (!pageDrivers) throw new Error('Expected page Motion drivers')
  graph.updateNode(pageId, {
    motionDrivers: {
      version: 1,
      drivers: [
        ...pageDrivers.drivers,
        ...spec(
          'visibility-driver',
          { kind: 'visibility', sourceNodeId: visibilitySource.id },
          visibilityTarget.id
        ).drivers
      ]
    }
  })
  const stateButton = graph.createNode('BUTTON', pageId, {
    name: 'Drive page state',
    x: 40,
    width: 120,
    height: 40,
    interactiveProps: { text: 'Drive page' },
    events: {
      onClick: [
        {
          id: 'drive-page-state',
          kind: 'setState',
          targetStateId: 'page-progress',
          valueExpr: '0.65'
        }
      ]
    }
  })

  const documentTarget = graph.createNode('RECTANGLE', pageId, {
    name: 'Document state target',
    x: 170,
    width: 30,
    height: 30,
    motion: motion()
  })
  const documentOwner = graph.createNode('FRAME', pageId, {
    name: 'Document state owner',
    x: 160,
    width: 180,
    height: 48,
    motionDrivers: spec(
      'document-progress-driver',
      { kind: 'documentState', stateId: 'document-progress' },
      documentTarget.id
    )
  })
  graph.reparentNode(documentTarget.id, documentOwner.id)
  const documentButton = graph.createNode('BUTTON', pageId, {
    name: 'Drive document state',
    x: 350,
    y: 260,
    width: 140,
    height: 40,
    interactiveProps: { text: 'Drive document' },
    events: {
      onClick: [
        {
          id: 'drive-document-state',
          kind: 'setVariable',
          targetName: 'documentProgress',
          valueExpr: '0.4'
        }
      ]
    }
  })

  const scrollOwner = graph.createNode('FRAME', pageId, {
    name: 'Scroll owner',
    y: 50,
    width: 180,
    height: 80
  })
  const scrollSource = graph.createNode('FRAME', scrollOwner.id, {
    name: 'Scroll source',
    width: 80,
    height: 50
  })
  const scrollTarget = graph.createNode('RECTANGLE', scrollOwner.id, {
    name: 'Scroll target',
    x: 100,
    width: 30,
    height: 30,
    motion: motion()
  })
  graph.updateNode(scrollOwner.id, {
    motionDrivers: spec(
      'scroll-driver',
      { kind: 'scroll', sourceNodeId: scrollSource.id, axis: 'y', metric: 'progress' },
      scrollTarget.id
    )
  })

  const componentPage = graph.addPage('Components')
  const master = graph.createNode('COMPONENT', componentPage.id, {
    name: 'Driver Card',
    width: 180,
    height: 100
  })
  const pointerOwner = graph.createNode('FRAME', master.id, {
    name: 'Pointer owner',
    width: 180,
    height: 100
  })
  const pointerTarget = graph.createNode('RECTANGLE', pointerOwner.id, {
    name: 'Pointer target',
    width: 30,
    height: 30,
    motion: motion()
  })
  graph.updateNode(pointerOwner.id, {
    motionDrivers: spec(
      'pointer-driver',
      { kind: 'pointer', axis: 'x', space: 'local' },
      pointerTarget.id,
      180
    )
  })
  const first = graph.createInstance(master.id, pageId)
  const second = graph.createInstance(master.id, pageId)
  if (!first || !second) throw new Error('Expected component instances')
  graph.updateNode(first.id, { x: 200, y: 20 })
  graph.updateNode(second.id, { x: 400, y: 20 })

  return {
    files: compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'motion-drivers-browser', devMode: false })
    }).files,
    stateTargetId: stateTarget.id,
    stateButtonId: stateButton.id,
    visibilitySourceId: visibilitySource.id,
    visibilityTargetId: visibilityTarget.id,
    documentTargetId: documentTarget.id,
    documentButtonId: documentButton.id,
    scrollSourceId: scrollSource.id,
    scrollTargetId: scrollTarget.id,
    pointerTargetId: pointerTarget.id
  }
}

describe('preview browser — generated continuous Motion drivers', () => {
  const hookTimeoutMs = 30_000
  let server: PreviewServer
  let browser: Browser
  let page: Page

  beforeAll(async () => {
    server = await createPreviewServer({})
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 1 })
  }, hookTimeoutMs)

  afterAll(async () => {
    await page?.close()
    await browser?.close()
    await server?.close()
  }, hookTimeoutMs)

  test('drives state, scroll, and one component scope, then releases removed owners', async () => {
    const fixture = buildFixture()
    await installReducedMotionController(page)
    server.updateFiles(fixture.files)
    await page.goto(server.url, { waitUntil: 'networkidle' })
    await page.waitForFunction(() => '__OPENPENCIL_MOTION_DRIVERS__' in window)

    await page.getByRole('button', { name: 'Drive page' }).click()
    await page.waitForTimeout(40)
    expect(await controlledTime(page, fixture.stateTargetId)).toBeCloseTo(650, -1)

    await setReducedMotion(page, true)
    await waitForControlledProgress(page, fixture.stateTargetId, 0.65, 120)
    const reducedTime = await controlledTime(page, fixture.stateTargetId)
    expect(reducedTime).toBeCloseTo(78, -1)
    await page.waitForTimeout(100)
    expect(await controlledTime(page, fixture.stateTargetId)).toBeCloseTo(reducedTime ?? 0, -1)

    await setReducedMotion(page, false)
    await waitForControlledProgress(page, fixture.stateTargetId, 0.65, 1_000)
    const restoredTime = await controlledTime(page, fixture.stateTargetId)
    expect(restoredTime).toBeCloseTo(650, -1)
    await page.waitForTimeout(100)
    expect(await controlledTime(page, fixture.stateTargetId)).toBeCloseTo(restoredTime ?? 0, -1)

    await page.getByRole('button', { name: 'Drive document' }).click()
    await page.waitForTimeout(40)
    expect(await controlledTime(page, fixture.documentTargetId)).toBeCloseTo(400, -1)
    const remountedDocumentTime = await page
      .locator(`[data-node-id="${fixture.documentTargetId}"]`)
      .evaluate(async (target) => {
        const owner = target.closest('[data-op-motion-scope]')
        const parent = owner?.parentElement
        if (!owner || !parent) throw new Error('Missing document-state driver owner')
        owner.remove()
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 30)
        })
        parent.append(owner)
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 50)
        })
        const animation = target
          .getAnimations()
          .find((candidate) => candidate.constructor.name === 'Animation')
        return animation?.currentTime === null || animation?.currentTime === undefined
          ? null
          : Number(animation.currentTime)
      })
    expect(remountedDocumentTime).toBeCloseTo(400, -1)

    await waitForControlledProgress(page, fixture.visibilityTargetId, 1, 1_000)
    await page.locator(`[data-node-id="${fixture.visibilitySourceId}"]`).evaluate((source) => {
      const html = source as HTMLElement
      const rect = html.getBoundingClientRect()
      html.style.transform = `translateY(${-rect.top - rect.height / 2}px)`
    })
    await waitForControlledProgress(page, fixture.visibilityTargetId, 0.5, 1_000)
    expect(await controlledTime(page, fixture.visibilityTargetId)).toBeCloseTo(500, -1)

    await page.locator(`[data-node-id="${fixture.scrollSourceId}"]`).evaluate((source) => {
      const html = source as HTMLElement
      html.style.height = '50px'
      html.style.overflow = 'auto'
      const filler = document.createElement('div')
      filler.style.height = '450px'
      filler.style.width = '1px'
      html.append(filler)
      html.scrollTop = (html.scrollHeight - html.clientHeight) / 2
      html.dispatchEvent(new Event('scroll'))
    })
    await page.waitForTimeout(40)
    expect(await controlledTime(page, fixture.scrollTargetId)).toBeCloseTo(500, -1)

    const pointerTargets = page.locator(`[data-node-id="${fixture.pointerTargetId}"]`)
    expect(await pointerTargets.count()).toBe(2)
    const scopedTimes = await pointerTargets.evaluateAll((targets) => {
      const firstOwner = targets[0].closest('[data-op-motion-scope]')
      const rect = firstOwner?.getBoundingClientRect()
      if (!firstOwner || !rect) throw new Error('Missing component driver owner')
      firstOwner.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top
        })
      )
      return targets.map((target) => target.getAnimations().length)
    })
    expect(scopedTimes).toEqual([0, 0])
    await page.waitForTimeout(40)
    const controlledTimes = await pointerTargets.evaluateAll((targets) =>
      targets.map((target) => {
        const animation = target
          .getAnimations()
          .find((candidate) => candidate.constructor.name === 'Animation')
        return animation?.currentTime === null || animation?.currentTime === undefined
          ? null
          : Number(animation.currentTime)
      })
    )
    expect(controlledTimes[0]).toBeCloseTo(500, -1)
    expect(controlledTimes[1]).toBeNull()

    const animationsAfterRemoval = await pointerTargets.nth(0).evaluate(async (target) => {
      const owner = target.closest('[data-op-motion-scope]')
      if (!owner) throw new Error('Missing removable driver scope')
      owner.remove()
      await new Promise<void>((resolve) => {
        setTimeout(() => resolve(), 30)
      })
      return target.getAnimations().length
    })
    expect(animationsAfterRemoval).toBe(0)
  }, 30_000)
})

async function controlledTime(page: Page, nodeId: string): Promise<number | null> {
  return await page.locator(`[data-node-id="${nodeId}"]`).evaluate((element) => {
    const animation = element
      .getAnimations()
      .find((candidate) => candidate.constructor.name === 'Animation')
    return animation?.currentTime === null || animation?.currentTime === undefined
      ? null
      : Number(animation.currentTime)
  })
}

async function waitForControlledProgress(
  page: Page,
  nodeId: string,
  progress: number,
  duration: number
): Promise<void> {
  await page.waitForFunction(
    ({ nodeId, progress, duration }) => {
      const runtime = (
        window as typeof window & {
          __OPENPENCIL_MOTION_RUNTIME__?: {
            inspect: (targetNodeId?: string) => {
              entries: Array<{
                source: string
                playState: string
                progress: number | null
                timing: { duration: number }
              }>
            }
          }
        }
      ).__OPENPENCIL_MOTION_RUNTIME__
      const entry = runtime?.inspect(nodeId).entries[0]
      return (
        entry?.source === 'controlled' &&
        entry.playState === 'paused' &&
        entry.timing.duration === duration &&
        entry.progress !== null &&
        Math.abs(entry.progress - progress) < 0.02
      )
    },
    { nodeId, progress, duration }
  )
}

async function installReducedMotionController(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const nativeMatchMedia = window.matchMedia.bind(window)
    const media = '(prefers-reduced-motion: reduce)'
    const target = new EventTarget()
    let matches = false
    Object.defineProperties(target, {
      matches: { get: () => matches },
      media: { value: media },
      onchange: { value: null, writable: true }
    })
    const query = target as MediaQueryList
    query.addListener = (listener) => target.addEventListener('change', listener)
    query.removeListener = (listener) => target.removeEventListener('change', listener)
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (value: string) => (value === media ? query : nativeMatchMedia(value))
    })
    window.__setOpenPencilReducedMotion = (value) => {
      if (matches === value) return
      matches = value
      target.dispatchEvent(new Event('change'))
    }
  })
}

async function setReducedMotion(page: Page, matches: boolean): Promise<void> {
  await page.evaluate((matches) => window.__setOpenPencilReducedMotion?.(matches), matches)
}
