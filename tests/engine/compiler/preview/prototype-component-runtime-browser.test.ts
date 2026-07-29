import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { chromium, type Browser, type Locator, type Page } from '@playwright/test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { createPreviewServer, type PreviewServer } from '@open-pencil/compiler/dev-server'
import type { PrototypeConnection } from '@open-pencil/scene-graph'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

declare global {
  interface Window {
    __componentPrototypeTransitions: { oldNames: string[]; newNames: string[] }[]
  }
}

interface ComponentPrototypeRuntimeHandle {
  dispose(): void
  inspect(): {
    activeConnectionId: string | null
    delaySourceCount: number
    delayTimerCount: number
    overlayNodeIds: string[]
  }
}

type ComponentPrototypeWindow = Window & {
  __OPENPENCIL_PROTOTYPE_RUNTIME__?: ComponentPrototypeRuntimeHandle
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

function scoped(scope: string, value: string): string {
  return JSON.stringify([scope, value])
}

function componentPrototypeFixture(): {
  files: Map<string, string | Uint8Array>
  firstSourceId: string
  firstTargetId: string
  secondSourceId: string
  secondTargetId: string
  delayMs: number
} {
  const delayMs = 260
  const graph = makeSceneGraph()
  const pageId = firstPageId(graph)
  const library = graph.addPage('Components')
  const master = graph.createNode('COMPONENT', library.id, {
    name: 'Runtime Scoped Card',
    width: 220,
    height: 170
  })
  const source = graph.createNode('RECTANGLE', master.id, {
    name: 'Open scoped dialog',
    width: 160,
    height: 44,
    transitionKey: 'scoped-hero'
  })
  graph.createNode('TEXT', source.id, { text: 'Open scoped dialog' })
  const target = graph.createNode('FRAME', master.id, {
    name: 'Scoped dialog',
    y: 60,
    width: 190,
    height: 100,
    transitionKey: 'scoped-hero'
  })
  const delayedClose = graph.createNode('FRAME', target.id, {
    name: 'Auto close scoped dialog',
    width: 160,
    height: 44
  })
  graph.createNode('TEXT', delayedClose.id, { text: 'Scoped dialog content' })
  graph.updateNode(source.id, {
    prototype: {
      version: 1,
      connections: [
        connection(
          'open-scoped-dialog',
          {
            kind: 'openOverlay',
            targetNodeId: target.id,
            placement: 'center'
          },
          {
            transition: {
              kind: 'smartMatch',
              durationMs: 80,
              easing: 'linear',
              fallback: 'dissolve'
            }
          }
        )
      ]
    }
  })
  graph.updateNode(delayedClose.id, {
    prototype: {
      version: 1,
      connections: [
        connection(
          'auto-close-scoped-dialog',
          { kind: 'closeOverlay' },
          {
            trigger: { kind: 'afterDelay', delayMs }
          }
        )
      ]
    }
  })
  const first = graph.createInstance(master.id, pageId, { x: 20, y: 20 })
  const second = graph.createInstance(master.id, pageId, { x: 280, y: 20 })
  if (!first || !second) throw new Error('missing scoped component instances')
  return {
    files: compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'component-prototype-browser', devMode: false })
    }).files,
    firstSourceId: scoped(first.id, source.id),
    firstTargetId: scoped(first.id, target.id),
    secondSourceId: scoped(second.id, source.id),
    secondTargetId: scoped(second.id, target.id),
    delayMs
  }
}

describe('preview browser — component-scoped prototype runtime', () => {
  const timeoutMs = 30_000
  let server: PreviewServer | null = null
  let browser: Browser | null = null
  let page: Page | null = null

  beforeEach(async () => {
    server = await createPreviewServer({})
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 720, height: 420 } })
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
    'two instances isolate click/afterDelay/overlay/Smart Match identity and clean up keyboard state',
    async () => {
      if (!server || !page) throw new Error('missing preview runtime')
      await installTransitionInstrumentation(page)
      const fixture = componentPrototypeFixture()
      server.updateFiles(fixture.files)
      await page.goto(server.url, { waitUntil: 'networkidle' })
      await page.waitForFunction(() => '__OPENPENCIL_PROTOTYPE_RUNTIME__' in window)

      const keys = await page
        .locator('[data-op-transition-key]')
        .evaluateAll((elements) =>
          elements.map((element) => element.getAttribute('data-op-transition-key'))
        )
      expect(keys).toHaveLength(4)
      expect(new Set(keys).size).toBe(2)

      const sources = page.getByRole('button', { name: 'Open scoped dialog' })
      await expectSourceIdentity(sources.nth(0), fixture.firstSourceId)
      await expectSourceIdentity(sources.nth(1), fixture.secondSourceId)
      await sources.nth(0).focus()
      await page.keyboard.press('Enter')
      await page.getByRole('dialog').waitFor()
      await page.waitForFunction(
        (targetId) =>
          (window as ComponentPrototypeWindow).__OPENPENCIL_PROTOTYPE_RUNTIME__?.inspect()
            .overlayNodeIds[0] === targetId,
        fixture.firstTargetId
      )
      await page.waitForFunction(() => window.__componentPrototypeTransitions.length === 1)
      const firstTransition = await page.evaluate(() => window.__componentPrototypeTransitions[0])
      expect(firstTransition.oldNames).toHaveLength(1)
      expect(firstTransition.newNames).toEqual(firstTransition.oldNames)
      expect(firstTransition.oldNames[0]).toStartWith('opm-')
      expect(await page.getByRole('dialog').getAttribute('data-op-prototype-node')).toBe(
        fixture.firstTargetId
      )
      await page.waitForFunction(
        () =>
          (window as ComponentPrototypeWindow).__OPENPENCIL_PROTOTYPE_RUNTIME__?.inspect()
            .delayTimerCount === 1
      )

      await page.getByRole('dialog').waitFor({ state: 'hidden' })
      expect(
        await page.evaluate(() => document.activeElement?.getAttribute('data-op-prototype-node'))
      ).toBe(fixture.firstSourceId)
      expect(await inspectPrototype(page)).toMatchObject({
        activeConnectionId: null,
        delaySourceCount: 0,
        delayTimerCount: 0,
        overlayNodeIds: []
      })

      await sources.nth(1).focus()
      await page.keyboard.press(' ')
      await page.getByRole('dialog').waitFor()
      expect((await inspectPrototype(page)).overlayNodeIds).toEqual([fixture.secondTargetId])
      expect(await page.getByRole('dialog').getAttribute('data-op-prototype-node')).toBe(
        fixture.secondTargetId
      )
      await page.waitForFunction(
        () =>
          (window as ComponentPrototypeWindow).__OPENPENCIL_PROTOTYPE_RUNTIME__?.inspect()
            .delayTimerCount === 1
      )

      const disposed = await page.evaluate(() => {
        const runtime = (window as ComponentPrototypeWindow).__OPENPENCIL_PROTOTYPE_RUNTIME__
        if (!runtime) throw new Error('missing component prototype runtime')
        runtime.dispose()
        return {
          installed: Boolean((window as ComponentPrototypeWindow).__OPENPENCIL_PROTOTYPE_RUNTIME__),
          state: runtime.inspect()
        }
      })
      expect(disposed.installed).toBeFalse()
      expect(disposed.state).toMatchObject({
        delaySourceCount: 0,
        delayTimerCount: 0,
        overlayNodeIds: []
      })
      expect(await page.getByRole('dialog').isVisible()).toBeFalse()
      await sources.nth(1).focus()
      await page.keyboard.press('Enter')
      await page.waitForTimeout(fixture.delayMs + 40)
      expect(await page.getByRole('dialog').isVisible()).toBeFalse()
    },
    timeoutMs
  )
})

async function expectSourceIdentity(source: Locator, expectedId: string): Promise<void> {
  expect(await source.getAttribute('data-op-prototype-node')).toBe(expectedId)
  expect(await source.getAttribute('data-op-prototype-keyboard')).toBe('true')
  expect(await source.getAttribute('tabindex')).toBe('0')
  expect(await source.getAttribute('role')).toBe('button')
}

async function inspectPrototype(page: Page) {
  return page.evaluate(() => {
    const runtime = (window as ComponentPrototypeWindow).__OPENPENCIL_PROTOTYPE_RUNTIME__
    if (!runtime) throw new Error('missing component prototype runtime')
    return runtime.inspect()
  })
}

async function installTransitionInstrumentation(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__componentPrototypeTransitions = []
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: (callback: () => Promise<void>) => {
        const oldNames = transitionNames()
        const updateCallbackDone = callback()
        const finished = updateCallbackDone.then(() => {
          window.__componentPrototypeTransitions.push({
            oldNames,
            newNames: transitionNames()
          })
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
