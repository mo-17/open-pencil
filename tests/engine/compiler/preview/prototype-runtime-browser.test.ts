/* eslint-disable max-lines -- browser runtime cases share one compiled preview harness */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { chromium, type Browser, type Page } from '@playwright/test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { createPreviewServer, type PreviewServer } from '@open-pencil/compiler/dev-server'
import type { PrototypeConnection, SceneGraph } from '@open-pencil/scene-graph'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

declare global {
  interface Window {
    __OPENPENCIL_PROTOTYPE_RUNTIME__?: PrototypeRuntimeTestHandle
    __prototypeSkips: number
    __prototypeTransitionInstrumentation: TransitionInstrumentation
    __prototypeViewTransitionCalls: number
    __openPencilReducedMotionListenerCount?: () => number
    __setOpenPencilReducedMotion?: (matches: boolean) => void
  }
}

interface PrototypeRuntimeTestHandle {
  dispose: () => void
  inspect: () => PrototypeInspectResult
  trigger: (sourceNodeId: string, connectionId?: string) => boolean
}

function connection(
  id: string,
  action: PrototypeConnection['action'],
  overrides: Partial<PrototypeConnection> = {}
): PrototypeConnection {
  return {
    id,
    trigger: { kind: 'click' },
    action,
    transition: { kind: 'instant' },
    interruption: 'replace',
    playback: 'forward',
    ...overrides
  }
}

function compileGraph(graph: SceneGraph): Map<string, string | Uint8Array> {
  return compile({
    graph,
    pageIds: graph.getPages().map((page) => page.id),
    options: withDefaults({ packageName: 'prototype-runtime-browser', devMode: false })
  }).files
}

function navigationFixture(durationMs = 30): Map<string, string | Uint8Array> {
  const graph = makeSceneGraph()
  const homeId = firstPageId(graph)
  graph.updateNode(homeId, { name: 'Home' })
  const details = graph.addPage('Details')
  graph.createNode('BUTTON', homeId, {
    name: 'Go details',
    interactiveProps: { text: 'Go details' },
    prototype: {
      version: 1,
      connections: [
        connection(
          'go',
          { kind: 'navigate', targetNodeId: details.id },
          {
            transition: {
              kind: 'slide',
              direction: 'left',
              durationMs,
              easing: 'linear'
            },
            interruption: 'queue'
          }
        )
      ]
    }
  })
  graph.createNode('TEXT', details.id, { name: 'Details title', text: 'Details screen' })
  graph.createNode('BUTTON', details.id, {
    name: 'Back home',
    interactiveProps: { text: 'Back home' },
    prototype: {
      version: 1,
      connections: [
        connection(
          'back',
          { kind: 'back' },
          {
            transition: {
              kind: 'push',
              direction: 'right',
              durationMs,
              easing: 'ease-out'
            },
            playback: 'reverse'
          }
        )
      ]
    }
  })
  return compileGraph(graph)
}

function delayedNavigationFixture(): Map<string, string | Uint8Array> {
  const graph = makeSceneGraph()
  const homeId = firstPageId(graph)
  const destination = graph.addPage('Automatic')
  graph.updateNode(homeId, {
    name: 'Home',
    prototype: {
      version: 1,
      connections: [
        connection(
          'automatic',
          { kind: 'navigate', targetNodeId: destination.id },
          {
            trigger: { kind: 'afterDelay', delayMs: 40 }
          }
        ),
        connection(
          'stale-page-back',
          { kind: 'back' },
          {
            trigger: { kind: 'afterDelay', delayMs: 120 }
          }
        )
      ]
    }
  })
  graph.createNode('TEXT', homeId, { text: 'Waiting' })
  graph.createNode('TEXT', destination.id, { text: 'Arrived automatically' })
  return compileGraph(graph)
}

function overlayFixture(): Map<string, string | Uint8Array> {
  const graph = makeSceneGraph()
  const pageId = firstPageId(graph)
  const opener = graph.createNode('BUTTON', pageId, {
    name: 'Open dialog',
    interactiveProps: { text: 'Open dialog' }
  })
  const dialog = graph.createNode('FRAME', pageId, { name: 'Dialog' })
  const close = graph.createNode('BUTTON', dialog.id, {
    name: 'Close dialog',
    interactiveProps: { text: 'Close dialog' }
  })
  graph.createNode('BUTTON', dialog.id, {
    name: 'Last action',
    y: 60,
    interactiveProps: { text: 'Last action' }
  })
  graph.updateNode(opener.id, {
    prototype: {
      version: 1,
      connections: [
        connection('open', {
          kind: 'openOverlay',
          targetNodeId: dialog.id,
          placement: 'center',
          dismissOnOutside: true
        })
      ]
    }
  })
  graph.updateNode(close.id, {
    prototype: {
      version: 1,
      connections: [connection('close', { kind: 'closeOverlay' })]
    }
  })
  return compileGraph(graph)
}

function delayedOverlayFixture(): {
  delayMs: number
  files: Map<string, string | Uint8Array>
  overlayId: string
} {
  const delayMs = 260
  const graph = makeSceneGraph()
  const pageId = firstPageId(graph)
  const opener = graph.createNode('BUTTON', pageId, {
    name: 'Open delayed dialog',
    interactiveProps: { text: 'Open delayed dialog' }
  })
  const dialog = graph.createNode('FRAME', pageId, {
    name: 'Delayed dialog',
    width: 280,
    height: 180
  })
  const delaySource = graph.createNode('FRAME', dialog.id, {
    name: 'Delayed close source',
    width: 180,
    height: 44
  })
  graph.createNode('TEXT', delaySource.id, { text: 'Timer is active' })
  const close = graph.createNode('BUTTON', dialog.id, {
    name: 'Close delayed dialog',
    y: 80,
    interactiveProps: { text: 'Close delayed dialog' }
  })
  graph.updateNode(opener.id, {
    prototype: {
      version: 1,
      connections: [
        connection('open-delayed-dialog', {
          kind: 'openOverlay',
          targetNodeId: dialog.id,
          placement: 'center',
          dismissOnOutside: false
        })
      ]
    }
  })
  graph.updateNode(delaySource.id, {
    prototype: {
      version: 1,
      connections: [
        connection(
          'close-delayed-dialog',
          { kind: 'closeOverlay' },
          {
            trigger: { kind: 'afterDelay', delayMs }
          }
        )
      ]
    }
  })
  graph.updateNode(close.id, {
    prototype: {
      version: 1,
      connections: [connection('close-delayed-dialog-manually', { kind: 'closeOverlay' })]
    }
  })
  return { delayMs, files: compileGraph(graph), overlayId: dialog.id }
}

function keyboardFixture(): Map<string, string | Uint8Array> {
  const graph = makeSceneGraph()
  const homeId = firstPageId(graph)
  graph.updateNode(homeId, { name: 'Home' })
  const details = graph.addPage('Keyboard destination')
  graph.createNode('TEXT', details.id, { text: 'Keyboard destination reached' })

  const navigateSource = graph.createNode('RECTANGLE', homeId, {
    name: 'Keyboard navigate source',
    width: 180,
    height: 44,
    prototype: {
      version: 1,
      connections: [connection('keyboard-navigate', { kind: 'navigate', targetNodeId: details.id })]
    }
  })
  graph.createNode('TEXT', navigateSource.id, { text: 'Keyboard navigate' })

  const dialog = graph.createNode('FRAME', homeId, { name: 'Keyboard dialog target', y: 140 })
  graph.createNode('TEXT', dialog.id, { text: 'Keyboard dialog content' })
  const overlaySource = graph.createNode('FRAME', homeId, {
    name: 'Keyboard overlay source',
    y: 60,
    width: 180,
    height: 44
  })
  graph.createNode('TEXT', overlaySource.id, { text: 'Keyboard overlay' })
  graph.updateNode(overlaySource.id, {
    prototype: {
      version: 1,
      connections: [
        connection('keyboard-overlay', {
          kind: 'openOverlay',
          targetNodeId: dialog.id,
          placement: 'center'
        })
      ]
    }
  })
  graph.createNode('BUTTON', homeId, {
    name: 'Native overlay source',
    y: 110,
    interactiveProps: { text: 'Native overlay' },
    prototype: {
      version: 1,
      connections: [
        connection('native-overlay', {
          kind: 'openOverlay',
          targetNodeId: dialog.id,
          placement: 'center'
        })
      ]
    }
  })
  return compileGraph(graph)
}

function smartMatchFixture(matching: boolean): Map<string, string | Uint8Array> {
  const graph = makeSceneGraph()
  const homeId = firstPageId(graph)
  graph.updateNode(homeId, { name: 'Home' })
  const details = graph.addPage('Smart target')
  graph.createNode('BUTTON', homeId, {
    name: 'Smart navigate',
    interactiveProps: { text: 'Smart navigate' },
    transitionKey: matching ? 'shared-hero' : 'source-only',
    prototype: {
      version: 1,
      connections: [
        connection(
          'smart',
          { kind: 'navigate', targetNodeId: details.id },
          {
            transition: {
              kind: 'smartMatch',
              durationMs: 40,
              easing: 'linear',
              fallback: 'dissolve'
            }
          }
        )
      ]
    }
  })
  graph.createNode('FRAME', details.id, {
    name: 'Target hero',
    transitionKey: matching ? 'shared-hero' : 'target-only'
  })
  return compileGraph(graph)
}

function smartMatchOverlayFixture(): {
  files: Map<string, string | Uint8Array>
  overlayId: string
} {
  const graph = makeSceneGraph()
  const pageId = firstPageId(graph)
  const overlay = graph.createNode('FRAME', pageId, {
    name: 'Reduced Motion dialog',
    transitionKey: 'overlay-only'
  })
  graph.createNode('TEXT', overlay.id, { text: 'Overlay remains open' })
  graph.createNode('BUTTON', pageId, {
    name: 'Open reduced dialog',
    interactiveProps: { text: 'Open reduced dialog' },
    transitionKey: 'source-only',
    prototype: {
      version: 1,
      connections: [
        connection(
          'smart-overlay',
          {
            kind: 'openOverlay',
            targetNodeId: overlay.id,
            placement: 'center'
          },
          {
            transition: {
              kind: 'smartMatch',
              durationMs: 1_500,
              easing: 'linear',
              fallback: 'dissolve'
            }
          }
        )
      ]
    }
  })
  return { files: compileGraph(graph), overlayId: overlay.id }
}

function interruptionFixture(): {
  files: Map<string, string | Uint8Array>
  sourceId: string
  overlayIds: [string, string, string]
} {
  const graph = makeSceneGraph()
  const pageId = firstPageId(graph)
  const source = graph.createNode('BUTTON', pageId, {
    name: 'Scheduler',
    interactiveProps: { text: 'Scheduler' }
  })
  const overlays = ['A', 'B', 'C'].map((name) =>
    graph.createNode('FRAME', pageId, { name: `Overlay ${name}` })
  )
  const open = (index: number, interruption: 'replace' | 'queue'): PrototypeConnection =>
    connection(
      `open-${index}`,
      {
        kind: 'openOverlay',
        targetNodeId: overlays[index].id,
        placement: 'center'
      },
      {
        interruption,
        transition: { kind: 'dissolve', durationMs: 120, easing: 'linear' }
      }
    )
  graph.updateNode(source.id, {
    prototype: {
      version: 1,
      connections: [open(0, 'queue'), open(1, 'queue'), open(2, 'replace')]
    }
  })
  return {
    files: compileGraph(graph),
    sourceId: source.id,
    overlayIds: [overlays[0].id, overlays[1].id, overlays[2].id]
  }
}

describe('preview browser — generated prototype runtime', () => {
  const timeoutMs = 30_000
  let server: PreviewServer | null = null
  let browser: Browser | null = null
  let page: Page | null = null

  beforeEach(async () => {
    server = await createPreviewServer({})
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 420, height: 360 } })
  }, timeoutMs)

  afterEach(async () => {
    try {
      await page?.close()
    } finally {
      try {
        await browser?.close()
      } finally {
        await server?.close()
        server = null
        browser = null
        page = null
      }
    }
  }, timeoutMs)

  test(
    'click navigate and back resolve compiled routes with forward/reverse transitions',
    async () => {
      if (!server || !page) throw new Error('missing preview runtime')
      server.updateFiles(navigationFixture())
      await page.goto(server.url, { waitUntil: 'networkidle' })
      await page.waitForFunction(() => '__OPENPENCIL_PROTOTYPE_RUNTIME__' in window)

      await page.getByRole('button', { name: 'Go details' }).click()
      await page.waitForURL((url) => url.pathname === '/details')
      await page.getByText('Details screen').waitFor()
      await page.getByRole('button', { name: 'Back home' }).click()
      await page.waitForURL((url) => url.pathname === '/')
      await page.getByRole('button', { name: 'Go details' }).waitFor()
    },
    timeoutMs
  )

  test(
    'page-level afterDelay trigger navigates exactly once',
    async () => {
      if (!server || !page) throw new Error('missing preview runtime')
      server.updateFiles(delayedNavigationFixture())
      await page.goto(server.url, { waitUntil: 'domcontentloaded' })
      await page.waitForURL((url) => url.pathname === '/automatic')
      await page.getByText('Arrived automatically').waitFor()
      await page.waitForTimeout(160)
      expect(new URL(page.url()).pathname).toBe('/automatic')
      expect((await prototypeInspect(page)).delayTimerCount).toBe(0)
    },
    timeoutMs
  )

  test(
    'overlay afterDelay only runs while open, cancels on close, rearms from zero, and disposes cleanly',
    async () => {
      if (!server || !page) throw new Error('missing preview runtime')
      await installReducedMotionController(page)
      const fixture = delayedOverlayFixture()
      server.updateFiles(fixture.files)
      await page.goto(server.url, { waitUntil: 'networkidle' })
      await page.waitForFunction(() => '__OPENPENCIL_PROTOTYPE_RUNTIME__' in window)

      const opener = page.getByRole('button', { name: 'Open delayed dialog' })
      const target = page.locator('[data-op-prototype-overlay-target]')
      expect(await target.isVisible()).toBeFalse()
      expect(await prototypeInspect(page)).toMatchObject({
        delaySourceCount: 0,
        delayTimerCount: 0,
        overlayNodeIds: []
      })
      await page.waitForTimeout(fixture.delayMs + 80)
      expect(await target.isVisible()).toBeFalse()
      expect((await prototypeInspect(page)).delayTimerCount).toBe(0)

      await opener.click()
      const dialog = page.getByRole('dialog')
      await dialog.waitFor()
      await waitForDelayTimerCount(page, 1)
      expect((await prototypeInspect(page)).delaySourceCount).toBe(1)
      await page.waitForTimeout(80)
      expect(await dialog.isVisible()).toBeTrue()
      await dialog.waitFor({ state: 'hidden' })
      expect(await prototypeInspect(page)).toMatchObject({
        delaySourceCount: 0,
        delayTimerCount: 0,
        overlayNodeIds: []
      })

      await opener.click()
      await dialog.waitFor()
      await waitForDelayTimerCount(page, 1)
      await page.waitForTimeout(70)
      await page.getByRole('button', { name: 'Close delayed dialog' }).click()
      await dialog.waitFor({ state: 'hidden' })
      expect((await prototypeInspect(page)).delayTimerCount).toBe(0)
      await page.waitForTimeout(fixture.delayMs + 80)
      expect(await dialog.isVisible()).toBeFalse()

      await opener.click()
      await dialog.waitFor()
      await waitForDelayTimerCount(page, 1)
      await page.waitForTimeout(fixture.delayMs - 90)
      expect(await dialog.isVisible()).toBeTrue()
      await dialog.waitFor({ state: 'hidden' })

      await opener.click()
      await dialog.waitFor()
      await waitForDelayTimerCount(page, 1)
      const cleanup = await page.evaluate(() => {
        const runtime = window.__OPENPENCIL_PROTOTYPE_RUNTIME__
        if (!runtime) throw new Error('missing prototype runtime')
        const before = runtime.inspect()
        runtime.dispose()
        return {
          after: runtime.inspect(),
          before,
          installed: Boolean(window.__OPENPENCIL_PROTOTYPE_RUNTIME__)
        }
      })
      expect(cleanup.before.delayTimerCount).toBe(1)
      expect(cleanup.after).toMatchObject({
        delaySourceCount: 0,
        delayTimerCount: 0,
        overlayNodeIds: []
      })
      expect(cleanup.installed).toBeFalse()
      expect(await page.evaluate(() => window.__openPencilReducedMotionListenerCount?.())).toBe(0)
    },
    timeoutMs
  )

  test(
    'overlay traps focus, inerts background, closes from action/Escape, and restores focus',
    async () => {
      if (!server || !page) throw new Error('missing preview runtime')
      server.updateFiles(overlayFixture())
      await page.goto(server.url, { waitUntil: 'networkidle' })
      const opener = page.getByRole('button', { name: 'Open dialog' })
      const dialogTarget = page.locator('[data-op-prototype-overlay-target]')
      const originalStyle = await dialogTarget.getAttribute('style')
      await opener.focus()
      await opener.click()

      const dialog = page.getByRole('dialog')
      await dialog.waitFor()
      expect(await page.locator('[data-op-prototype-page]').getAttribute('inert')).toBe('')
      expect(await page.evaluate(() => document.activeElement?.textContent)).toContain(
        'Close dialog'
      )

      await page.keyboard.press('Shift+Tab')
      expect(await page.evaluate(() => document.activeElement?.textContent)).toContain(
        'Last action'
      )
      await page.keyboard.press('Tab')
      expect(await page.evaluate(() => document.activeElement?.textContent)).toContain(
        'Close dialog'
      )

      await page.getByRole('button', { name: 'Close dialog' }).click()
      await dialog.waitFor({ state: 'hidden' })
      expect(await dialogTarget.getAttribute('style')).toBe(originalStyle)
      expect(await page.locator('[data-op-prototype-page]').getAttribute('inert')).toBeNull()
      expect(await page.evaluate(() => document.activeElement?.textContent)).toContain(
        'Open dialog'
      )

      await opener.click()
      await page.getByRole('dialog').waitFor()
      await page.keyboard.press('Escape')
      await page.getByRole('dialog').waitFor({ state: 'hidden' })
      expect(await page.evaluate(() => document.activeElement?.textContent)).toContain(
        'Open dialog'
      )
    },
    timeoutMs
  )

  test(
    'non-native click sources support Enter and Space while native buttons activate once and dispose removes keyboard handling',
    async () => {
      if (!server || !page) throw new Error('missing preview runtime')
      server.updateFiles(keyboardFixture())
      await page.goto(server.url, { waitUntil: 'networkidle' })

      const navigate = page.getByRole('button', { name: 'Keyboard navigate' })
      expect(await navigate.evaluate((element) => element.tagName)).toBe('DIV')
      expect(await navigate.getAttribute('tabindex')).toBe('0')
      expect(await navigate.getAttribute('data-op-prototype-keyboard')).toBe('true')
      await navigate.focus()
      await page.keyboard.press('Enter')
      await page.waitForURL((url) => url.pathname === '/keyboard-destination')
      await page.getByText('Keyboard destination reached').waitFor()

      await page.goto(server.url, { waitUntil: 'networkidle' })
      const overlaySource = page.getByRole('button', { name: 'Keyboard overlay' })
      const spacePrevented = await overlaySource.evaluate(
        (element) =>
          !element.dispatchEvent(
            new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })
          )
      )
      expect(spacePrevented).toBeTrue()
      await page.getByRole('dialog').waitFor()
      await page.keyboard.press('Escape')
      await page.getByRole('dialog').waitFor({ state: 'hidden' })

      const native = page.getByRole('button', { name: 'Native overlay' })
      expect(await native.getAttribute('data-op-prototype-keyboard')).toBeNull()
      await native.focus()
      await page.keyboard.press('Enter')
      await page.getByRole('dialog').waitFor()
      expect(
        await page.evaluate(
          () => window.__OPENPENCIL_PROTOTYPE_RUNTIME__?.inspect().overlayNodeIds.length
        )
      ).toBe(1)

      await page.keyboard.press('Escape')
      await page.getByRole('dialog').waitFor({ state: 'hidden' })
      await page.evaluate(() => window.__OPENPENCIL_PROTOTYPE_RUNTIME__?.dispose())
      await overlaySource.focus()
      await page.keyboard.press('Enter')
      await page.waitForTimeout(50)
      expect(new URL(page.url()).pathname).toBe('/')
      expect(await page.getByRole('dialog').isVisible()).toBeFalse()
    },
    timeoutMs
  )

  test(
    'prefers-reduced-motion forces instant and skips View Transitions API',
    async () => {
      if (!server || !page) throw new Error('missing preview runtime')
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.addInitScript(() => {
        window.__prototypeViewTransitionCalls = 0
        Object.defineProperty(document, 'startViewTransition', {
          configurable: true,
          value: async () => {
            window.__prototypeViewTransitionCalls++
          }
        })
      })
      server.updateFiles(navigationFixture())
      await page.goto(server.url, { waitUntil: 'networkidle' })
      await page.getByRole('button', { name: 'Go details' }).click()
      await page.waitForURL((url) => url.pathname === '/details')
      expect(await page.evaluate(() => window.__prototypeViewTransitionCalls)).toBe(0)
    },
    timeoutMs
  )

  test(
    'live reduced motion completes slide and push fallbacks without losing navigation state',
    async () => {
      if (!server || !page) throw new Error('missing preview runtime')
      await installReducedMotionController(page)
      await page.addInitScript(() => {
        Object.defineProperty(document, 'startViewTransition', {
          configurable: true,
          value: undefined
        })
      })
      server.updateFiles(navigationFixture(1_500))
      await page.goto(server.url, { waitUntil: 'networkidle' })

      await page.getByRole('button', { name: 'Go details' }).click()
      await page.waitForURL((url) => url.pathname === '/details')
      await waitForActivePrototype(page, 'go')
      await setReducedMotion(page, true)
      await waitForIdlePrototype(page)
      expect(new URL(page.url()).pathname).toBe('/details')
      expect(await page.getByText('Details screen').isVisible()).toBeTrue()
      await expectPrototypeTransitionCleanup(page)

      await setReducedMotion(page, false)
      await page.getByRole('button', { name: 'Back home' }).click()
      await page.waitForURL((url) => url.pathname === '/')
      await waitForActivePrototype(page, 'back')
      await setReducedMotion(page, true)
      await waitForIdlePrototype(page)
      expect(new URL(page.url()).pathname).toBe('/')
      expect(await page.getByRole('button', { name: 'Go details' }).isVisible()).toBeTrue()
      await expectPrototypeTransitionCleanup(page)
      expect(await page.evaluate(() => window.__openPencilReducedMotionListenerCount?.())).toBe(1)
      await page.evaluate(() => window.__OPENPENCIL_PROTOTYPE_RUNTIME__?.dispose())
      expect(await page.evaluate(() => window.__openPencilReducedMotionListenerCount?.())).toBe(0)
    },
    timeoutMs
  )

  test(
    'live reduced motion skips Smart Match and preserves its completed route',
    async () => {
      if (!server || !page) throw new Error('missing preview runtime')
      await installReducedMotionController(page)
      await installDelayedViewTransition(page, 1_500)
      server.updateFiles(smartMatchFixture(true))
      await page.goto(server.url, { waitUntil: 'networkidle' })

      await page.getByRole('button', { name: 'Smart navigate' }).click()
      await page.waitForURL((url) => url.pathname === '/smart-target')
      await waitForActivePrototype(page, 'smart')
      await setReducedMotion(page, true)
      await waitForIdlePrototype(page)

      expect(new URL(page.url()).pathname).toBe('/smart-target')
      expect(await page.evaluate(() => window.__prototypeSkips)).toBeGreaterThan(0)
      await expectPrototypeTransitionCleanup(page)
    },
    timeoutMs
  )

  test(
    'live reduced motion completes Smart Match fallback while keeping its overlay open',
    async () => {
      if (!server || !page) throw new Error('missing preview runtime')
      await installReducedMotionController(page)
      const fixture = smartMatchOverlayFixture()
      server.updateFiles(fixture.files)
      await page.goto(server.url, { waitUntil: 'networkidle' })

      await page.getByRole('button', { name: 'Open reduced dialog' }).click()
      await page.getByRole('dialog').waitFor()
      await waitForActivePrototype(page, 'smart-overlay')
      await setReducedMotion(page, true)
      await waitForIdlePrototype(page)

      const inspected = await prototypeInspect(page)
      expect(inspected.overlayNodeIds).toContain(fixture.overlayId)
      expect(await page.getByText('Overlay remains open').isVisible()).toBeTrue()
      await expectPrototypeTransitionCleanup(page)
    },
    timeoutMs
  )

  test(
    'Smart Match uses hashed names through View Transitions when explicit keys match',
    async () => {
      if (!server || !page) throw new Error('missing preview runtime')
      await installTransitionInstrumentation(page)
      server.updateFiles(smartMatchFixture(true))
      await page.goto(server.url, { waitUntil: 'networkidle' })
      await page.getByRole('button', { name: 'Smart navigate' }).click()
      await page.waitForURL((url) => url.pathname === '/smart-target')
      await page.waitForFunction(
        () => window.__prototypeTransitionInstrumentation.snapshots.length === 1
      )

      const snapshot = await transitionInstrumentation(page)
      expect(snapshot.viewTransitionCalls).toBe(1)
      expect(snapshot.snapshots).toHaveLength(1)
      expect(snapshot.snapshots[0].oldNames).toHaveLength(1)
      expect(snapshot.snapshots[0].newNames).toEqual(snapshot.snapshots[0].oldNames)
      expect(snapshot.snapshots[0].newNames[0]).toStartWith('opm-')
    },
    timeoutMs
  )

  test(
    'Smart Match with no unique explicit key skips View Transitions and dissolves',
    async () => {
      if (!server || !page) throw new Error('missing preview runtime')
      await installTransitionInstrumentation(page)
      server.updateFiles(smartMatchFixture(false))
      await page.goto(server.url, { waitUntil: 'networkidle' })
      await page.getByRole('button', { name: 'Smart navigate' }).click()
      await page.waitForURL((url) => url.pathname === '/smart-target')
      await page.waitForFunction(() => window.__prototypeTransitionInstrumentation.waapiCalls > 0)

      const snapshot = await transitionInstrumentation(page)
      expect(snapshot.viewTransitionCalls).toBe(0)
      expect(snapshot.waapiCalls).toBeGreaterThan(0)
    },
    timeoutMs
  )

  test(
    'queue serializes transitions while replace cancels active work and drops queued work',
    async () => {
      if (!server || !page) throw new Error('missing preview runtime')
      await installDelayedViewTransition(page)
      const fixture = interruptionFixture()
      server.updateFiles(fixture.files)
      await page.goto(server.url, { waitUntil: 'networkidle' })
      await page.waitForFunction(() => '__OPENPENCIL_PROTOTYPE_RUNTIME__' in window)

      await page.evaluate(
        ({ sourceId }) => {
          const runtime = window.__OPENPENCIL_PROTOTYPE_RUNTIME__
          runtime?.trigger(sourceId, 'open-0')
          runtime?.trigger(sourceId, 'open-1')
        },
        { sourceId: fixture.sourceId }
      )
      await page.waitForFunction(
        (overlayId) =>
          window.__OPENPENCIL_PROTOTYPE_RUNTIME__?.inspect().overlayNodeIds.includes(overlayId),
        fixture.overlayIds[0]
      )
      const queued = await prototypeInspect(page)
      expect(queued.overlayNodeIds).toEqual([fixture.overlayIds[0]])
      expect(queued.queued).toBeTrue()

      await page.evaluate(
        ({ sourceId }) => {
          window.__OPENPENCIL_PROTOTYPE_RUNTIME__?.trigger(sourceId, 'open-2')
        },
        { sourceId: fixture.sourceId }
      )
      await page.waitForFunction(
        (overlayId) =>
          window.__OPENPENCIL_PROTOTYPE_RUNTIME__?.inspect().overlayNodeIds.includes(overlayId),
        fixture.overlayIds[2]
      )
      await page.waitForTimeout(180)
      const replaced = await prototypeInspect(page)
      expect(replaced.overlayNodeIds).toEqual([fixture.overlayIds[0], fixture.overlayIds[2]])
      expect(replaced.overlayNodeIds).not.toContain(fixture.overlayIds[1])
      expect(await page.evaluate(() => window.__prototypeSkips)).toBeGreaterThan(0)
    },
    timeoutMs
  )
})

interface PrototypeInspectResult {
  activeConnectionId: string | null
  delaySourceCount: number
  delayTimerCount: number
  overlayNodeIds: string[]
  queued: boolean
}

async function prototypeInspect(page: Page): Promise<PrototypeInspectResult> {
  return page.evaluate(() => {
    const runtime = window.__OPENPENCIL_PROTOTYPE_RUNTIME__
    if (!runtime) throw new Error('missing prototype runtime')
    return runtime.inspect()
  })
}

async function waitForDelayTimerCount(page: Page, count: number): Promise<void> {
  await page.waitForFunction(
    (count) => window.__OPENPENCIL_PROTOTYPE_RUNTIME__?.inspect().delayTimerCount === count,
    count
  )
}

async function installReducedMotionController(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const nativeMatchMedia = window.matchMedia.bind(window)
    const media = '(prefers-reduced-motion: reduce)'
    const target = new EventTarget()
    const listeners = new Set<EventListenerOrEventListenerObject>()
    let matches = false
    Object.defineProperties(target, {
      matches: { get: () => matches },
      media: { value: media },
      onchange: { value: null, writable: true }
    })
    const query = target as MediaQueryList
    const nativeAddEventListener = target.addEventListener.bind(target)
    const nativeRemoveEventListener = target.removeEventListener.bind(target)
    query.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject) => {
      if (type === 'change') listeners.add(listener)
      nativeAddEventListener(type, listener)
    }) as MediaQueryList['addEventListener']
    query.removeEventListener = ((type: string, listener: EventListenerOrEventListenerObject) => {
      if (type === 'change') listeners.delete(listener)
      nativeRemoveEventListener(type, listener)
    }) as MediaQueryList['removeEventListener']
    query.addListener = (listener) => query.addEventListener('change', listener)
    query.removeListener = (listener) => query.removeEventListener('change', listener)
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (value: string) => (value === media ? query : nativeMatchMedia(value))
    })
    window.__setOpenPencilReducedMotion = (value) => {
      if (matches === value) return
      matches = value
      target.dispatchEvent(new Event('change'))
    }
    window.__openPencilReducedMotionListenerCount = () => listeners.size
  })
}

async function setReducedMotion(page: Page, matches: boolean): Promise<void> {
  await page.evaluate((matches) => window.__setOpenPencilReducedMotion?.(matches), matches)
}

async function installDelayedViewTransition(page: Page, durationMs = 120): Promise<void> {
  await page.addInitScript((durationMs) => {
    window.__prototypeSkips = 0
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: (callback: () => Promise<void>) => {
        let finish: (() => void) | undefined
        const updateCallbackDone = callback()
        const finished = updateCallbackDone.then(
          () =>
            new Promise<void>((resolve) => {
              finish = resolve
              setTimeout(resolve, durationMs)
            })
        )
        return {
          ready: Promise.resolve(),
          updateCallbackDone,
          finished,
          skipTransition: () => {
            window.__prototypeSkips++
            finish?.()
          }
        }
      }
    })
  }, durationMs)
}

async function waitForActivePrototype(page: Page, connectionId: string): Promise<void> {
  await page.waitForFunction(
    (connectionId) =>
      window.__OPENPENCIL_PROTOTYPE_RUNTIME__?.inspect().activeConnectionId === connectionId,
    connectionId
  )
}

async function waitForIdlePrototype(page: Page): Promise<void> {
  await page.waitForFunction(
    () => window.__OPENPENCIL_PROTOTYPE_RUNTIME__?.inspect().activeConnectionId === null
  )
}

async function expectPrototypeTransitionCleanup(page: Page): Promise<void> {
  expect(
    await page.evaluate(() => ({
      prototypeAnimationCount: document
        .getAnimations()
        .filter((animation) => animation.id === 'openpencil-prototype-transition').length,
      duration: document.documentElement.style.getPropertyValue('--op-prototype-duration'),
      kind: document.documentElement.dataset.opPrototypeKind ?? null,
      transitionNames: [...document.querySelectorAll<HTMLElement>('[data-op-transition-key]')]
        .map((element) => element.style.getPropertyValue('view-transition-name'))
        .filter(Boolean)
    }))
  ).toEqual({ prototypeAnimationCount: 0, duration: '', kind: null, transitionNames: [] })
}

interface TransitionInstrumentation {
  viewTransitionCalls: number
  waapiCalls: number
  snapshots: { oldNames: string[]; newNames: string[] }[]
}

async function installTransitionInstrumentation(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const state: TransitionInstrumentation = {
      viewTransitionCalls: 0,
      waapiCalls: 0,
      snapshots: []
    }
    window.__prototypeTransitionInstrumentation = state
    const nativeAnimate = Reflect.get(Element.prototype, 'animate') as Element['animate']
    Element.prototype.animate = function (...args: Parameters<Element['animate']>) {
      state.waapiCalls++
      return Reflect.apply(nativeAnimate, this, args) as Animation
    }
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: (callback: () => Promise<void>) => {
        state.viewTransitionCalls++
        const oldNames = transitionNames()
        const updateCallbackDone = callback()
        const finished = updateCallbackDone.then(() => {
          state.snapshots.push({ oldNames, newNames: transitionNames() })
          return undefined
        })
        return {
          ready: Promise.resolve(),
          updateCallbackDone,
          finished,
          skipTransition: () => undefined
        }
      }
    })

    function transitionNames(): string[] {
      return [...document.querySelectorAll<HTMLElement>('[data-op-transition-key]')]
        .map((element) => element.style.getPropertyValue('view-transition-name'))
        .filter(Boolean)
    }
  })
}

async function transitionInstrumentation(page: Page): Promise<TransitionInstrumentation> {
  return page.evaluate(() => window.__prototypeTransitionInstrumentation)
}
