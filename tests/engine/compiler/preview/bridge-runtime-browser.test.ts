import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { chromium, expect as playwrightExpect, type Browser, type Page } from '@playwright/test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { createPreviewServer, type PreviewServer } from '@open-pencil/compiler/dev-server'
import { SceneGraph } from '@open-pencil/scene-graph'

type WebTarget = 'react' | 'vue'
const WEB_TARGETS = ['react', 'vue'] as const

interface PreviewMessage {
  source?: unknown
  type?: unknown
  id?: unknown
  route?: unknown
  name?: unknown
  value?: unknown
  status?: unknown
}

interface BridgeFixture {
  files: Map<string, string | Uint8Array>
  inputId: string
}

interface LoadedBridge {
  page: Page
  server: PreviewServer
  inputId: string
}

function buildBridgeFixture(target: WebTarget): BridgeFixture {
  const graph = new SceneGraph()
  const home = graph.getPages()[0]
  graph.updateNode(home.id, { name: 'Home' })
  graph.updateNode(graph.rootId, {
    lowcodeDocumentState: [
      {
        id: 'preview-shared-value',
        name: 'sharedValue',
        type: 'string',
        defaultValue: 'initial'
      }
    ]
  })
  const input = graph.createNode('INPUT', home.id, {
    name: 'Shared preview value',
    x: 24,
    y: 24,
    width: 240,
    height: 40,
    interactiveProps: { placeholder: 'Shared preview value' },
    bindings: { value: { kind: 'docState', docStateName: 'sharedValue' } }
  })
  const about = graph.addPage('About')
  graph.createNode('TEXT', about.id, {
    name: 'About marker',
    text: `${target} about route`,
    x: 24,
    y: 24,
    width: 240,
    height: 40
  })
  const files = compile({
    graph,
    pageIds: [home.id, about.id],
    options: withDefaults({
      packageName: `${target}-preview-bridge`,
      target,
      router: target === 'vue' ? 'vue-router-v4' : 'react-router-v6',
      devMode: true
    })
  }).files
  return { files, inputId: input.id }
}

async function loadBridge(page: Page, target: WebTarget): Promise<LoadedBridge> {
  const fixture = buildBridgeFixture(target)
  const server = await createPreviewServer({ target, initialFiles: fixture.files })
  await page.setContent(`
    <!doctype html>
    <html>
      <body>
        <iframe id="preview" title="Generated ${target} preview"></iframe>
        <script>
          window.__OP_PREVIEW_MESSAGES__ = []
          window.addEventListener('message', (event) => {
            if (event.data?.source === 'op-lowcode-preview') {
              window.__OP_PREVIEW_MESSAGES__.push(event.data)
            }
          })
        </script>
      </body>
    </html>
  `)
  await page.locator('#preview').evaluate((element, url) => {
    ;(element as HTMLIFrameElement).src = url
  }, server.url)
  await playwrightExpect(
    page.frameLocator('#preview').getByPlaceholder('Shared preview value')
  ).toBeVisible()
  return { page, server, inputId: fixture.inputId }
}

async function postToPreview(page: Page, payload: Record<string, unknown>): Promise<void> {
  await page.locator('#preview').evaluate((element, value) => {
    ;(element as HTMLIFrameElement).contentWindow?.postMessage(
      { source: 'op-lowcode-editor', ...value },
      '*'
    )
  }, payload)
}

async function messages(page: Page): Promise<PreviewMessage[]> {
  return page.evaluate(
    () =>
      (
        window as Window & {
          __OP_PREVIEW_MESSAGES__?: PreviewMessage[]
        }
      ).__OP_PREVIEW_MESSAGES__ ?? []
  )
}

async function clearMessages(page: Page): Promise<void> {
  await page.evaluate(() => {
    const host = window as Window & { __OP_PREVIEW_MESSAGES__?: PreviewMessage[] }
    host.__OP_PREVIEW_MESSAGES__ = []
  })
}

async function expectTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await playwrightExpect
    .poll(() =>
      page
        .frameLocator('#preview')
        .locator('html')
        .evaluate((element) => ({
          dataTheme: element.dataset.theme,
          light: element.classList.contains('light'),
          dark: element.classList.contains('dark'),
          colorScheme: element.style.colorScheme
        }))
    )
    .toEqual({
      dataTheme: theme,
      light: theme === 'light',
      dark: theme === 'dark',
      colorScheme: theme
    })
}

async function exerciseSharedBridge(target: WebTarget, loaded: LoadedBridge): Promise<void> {
  const { page, inputId } = loaded
  const frame = page.frameLocator('#preview')
  const input = frame.getByPlaceholder('Shared preview value')

  await postToPreview(page, { type: 'theme', theme: 'dark' })
  await expectTheme(page, 'dark')
  await postToPreview(page, { type: 'theme', theme: 'sepia' })
  await expectTheme(page, 'dark')
  await postToPreview(page, { type: 'theme', theme: 'light' })
  await expectTheme(page, 'light')

  await postToPreview(page, { type: 'select', id: inputId })
  await playwrightExpect(frame.locator('[data-op-preview-overlay]')).toBeVisible()
  await clearMessages(page)
  await input.click({ modifiers: ['Alt'] })
  await playwrightExpect
    .poll(async () =>
      (await messages(page)).some((message) => message.type === 'select' && message.id === inputId)
    )
    .toBe(true)

  await clearMessages(page)
  await postToPreview(page, { type: 'docState', name: 'sharedValue', value: 'remote' })
  await playwrightExpect(input).toHaveValue('remote')
  expect((await messages(page)).filter((message) => message.type === 'docState')).toEqual([])
  await input.fill('local')
  await playwrightExpect
    .poll(async () =>
      (await messages(page)).some(
        (message) =>
          message.type === 'docState' && message.name === 'sharedValue' && message.value === 'local'
      )
    )
    .toBe(true)

  await clearMessages(page)
  await postToPreview(page, { type: 'navigate', route: '/about' })
  await playwrightExpect(frame.getByText(`${target} about route`)).toBeVisible()
  expect((await messages(page)).filter((message) => message.type === 'navigate')).toEqual([])
  await frame.locator('body').evaluate(() => history.pushState(null, '', '/'))
  await playwrightExpect
    .poll(async () =>
      (await messages(page)).some((message) => message.type === 'navigate' && message.route === '/')
    )
    .toBe(true)
}

describe('generated web preview bridge in a real parent/iframe channel', () => {
  let browser: Browser | null = null

  beforeAll(async () => {
    browser = await chromium.launch()
  }, 30_000)

  afterAll(async () => {
    await browser?.close()
  }, 30_000)

  WEB_TARGETS.forEach((target) => {
    test(`${target} closes select, navigate, docState, and Theme message loops`, async () => {
      if (!browser) throw new Error('Browser did not start')
      const page = await browser.newPage()
      let loaded: LoadedBridge | null = null
      try {
        loaded = await loadBridge(page, target)
        await exerciseSharedBridge(target, loaded)
        if (target === 'vue') {
          await clearMessages(page)
          await postToPreview(page, { type: 'motionDebug', enabled: true })
          await playwrightExpect
            .poll(async () =>
              (await messages(page)).some(
                (message) => message.type === 'motionDebug' && message.status === 'unavailable'
              )
            )
            .toBe(true)
          await postToPreview(page, { type: 'motionDebug', enabled: false })
        }
      } finally {
        await page.close()
        await loaded?.server.close()
      }
    }, 30_000)
  })
})
