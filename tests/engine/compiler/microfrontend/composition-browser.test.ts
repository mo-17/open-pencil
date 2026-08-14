import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'

import {
  chromium,
  expect as playwrightExpect,
  type Browser,
  type Page,
  type Route
} from '@playwright/test'

import { compile, withDefaults } from '@open-pencil/compiler'
import {
  buildCompositionShell,
  buildMicrofrontendProject,
  microfrontendSha256Base64URL,
  type OpenPencilMicrofrontendCompositionManifestV1
} from '@open-pencil/compiler/microfrontend'
import { SceneGraph } from '@open-pencil/scene-graph'

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css',
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json'
}

async function fulfillStaticShellRoute(
  route: Route,
  outDir: string,
  deployedBase: string
): Promise<void> {
  const url = new URL(route.request().url())
  const relative = url.pathname.startsWith(deployedBase)
    ? url.pathname.slice(deployedBase.length)
    : ''
  const candidate = join(outDir, relative)
  const path =
    relative && existsSync(candidate) && lstatSync(candidate).isFile()
      ? candidate
      : join(outDir, 'index.html')
  await route.fulfill({
    status: 200,
    contentType: CONTENT_TYPES[extname(path)] ?? 'application/octet-stream',
    body: readFileSync(path)
  })
}

function compileGeneratedApp(target: 'react' | 'vue', appId: string, label: string) {
  const graph = new SceneGraph()
  const home = graph.getPages()[0]
  home.name = 'Home'
  const settings = graph.addPage('Settings')
  for (const [pageId, text] of [
    [home.id, `${label} Home`],
    [settings.id, `${label} Settings`]
  ] as const) {
    const frame = graph.createNode('FRAME', pageId, {
      width: 320,
      height: 180,
      layoutMode: 'VERTICAL'
    })
    graph.createNode('TEXT', frame.id, { text, width: 240, height: 40 })
  }
  return compile({
    graph,
    pageIds: [home.id, settings.id],
    options: withDefaults({
      packageName: appId,
      productName: label,
      target,
      router: target === 'react' ? 'react-router-v6' : 'vue-router-v4',
      devMode: false,
      packaging: { kind: 'microfrontend', appId, version: '1.0.0' }
    })
  })
}

const RUNTIME = (appId: string, extraExport = false): string => `
const log = () => (window.__openpencilTestEvents ??= [])
let currentContainer
let currentContext
export async function bootstrap() { log().push(${JSON.stringify(appId)} + ':bootstrap') }
export async function mount(container, context) {
  currentContainer = container
  currentContext = context
  container.innerHTML = '<article data-test-app="${appId}" data-base="' + context.basePath + '"><button type="button">navigate</button><span>${appId}</span></article>'
  context.portalTarget.innerHTML = '<aside data-test-portal="${appId}">portal</aside>'
  container.querySelector('button').onclick = () => context.navigate('/orders/revisit')
  log().push(${JSON.stringify(appId)} + ':mount:' + context.location.pathname)
}
export async function update(context) {
  currentContext = context
  currentContainer?.firstElementChild?.setAttribute('data-updated-path', context.location.pathname)
  log().push(${JSON.stringify(appId)} + ':update:' + context.location.pathname)
}
export async function unmount() {
  log().push(${JSON.stringify(appId)} + ':unmount')
  currentContainer = undefined
  currentContext = undefined
}
${extraExport ? 'export const unsupported = true' : ''}
`

function writeRuntime(sourceDir: string, appId: string, extraExport = false): void {
  const directory = join(sourceDir, appId)
  const entry = new TextEncoder().encode(RUNTIME(appId, extraExport))
  const css = new TextEncoder().encode(`:host { --mounted-${appId}: 1; }\n`)
  mkdirSync(join(directory, 'assets'), { recursive: true })
  writeFileSync(join(directory, 'assets/app.js'), entry)
  writeFileSync(join(directory, 'assets/app.css'), css)
  writeFileSync(
    join(directory, 'openpencil.microfrontend.json'),
    JSON.stringify({
      format: 'openpencil-microfrontend',
      schemaVersion: 1,
      abi: 'openpencil.microfrontend.v1',
      app: { id: appId, name: appId, version: '1.0.0', framework: 'react' },
      artifact: {
        entry: {
          path: './assets/app.js',
          mediaType: 'text/javascript',
          byteLength: entry.byteLength,
          digest: microfrontendSha256Base64URL(entry)
        },
        styles: [
          {
            path: './assets/app.css',
            mediaType: 'text/css',
            byteLength: css.byteLength,
            digest: microfrontendSha256Base64URL(css)
          }
        ]
      },
      routes: ['/']
    })
  )
}

function writeThrowingRuntime(sourceDir: string): void {
  const directory = join(sourceDir, 'throwing')
  const entry = new TextEncoder().encode(`
const log = () => (window.__openpencilTestEvents ??= [])
let mounted = false
export async function bootstrap() { log().push('throwing:bootstrap') }
export async function mount() {
  if (mounted) throw new Error('Microfrontend is already mounted')
  mounted = true
  log().push('throwing:mount')
  throw new Error('intentional partial mount failure')
}
export async function update() {}
export async function unmount() {
  mounted = false
  log().push('throwing:unmount')
}
`)
  mkdirSync(join(directory, 'assets'), { recursive: true })
  writeFileSync(join(directory, 'assets/app.js'), entry)
  writeFileSync(
    join(directory, 'openpencil.microfrontend.json'),
    JSON.stringify({
      format: 'openpencil-microfrontend',
      schemaVersion: 1,
      abi: 'openpencil.microfrontend.v1',
      app: { id: 'throwing', name: 'throwing', version: '1.0.0', framework: 'react' },
      artifact: {
        entry: {
          path: './assets/app.js',
          mediaType: 'text/javascript',
          byteLength: entry.byteLength,
          digest: microfrontendSha256Base64URL(entry)
        },
        styles: []
      },
      routes: ['/']
    })
  )
}

function writeFaultyUpdateRuntime(sourceDir: string): void {
  const directory = join(sourceDir, 'faulty')
  const entry = new TextEncoder().encode(`
const log = () => (window.__openpencilTestEvents ??= [])
export async function bootstrap() {}
export async function mount(container) {
  container.innerHTML = '<p data-test-app="faulty">Faulty runtime</p>'
}
export async function update() {
  log().push('faulty:update')
  throw new Error('intentional update failure')
}
export async function unmount() {
  log().push('faulty:unmount')
  throw new Error('intentional unmount failure')
}
`)
  mkdirSync(join(directory, 'assets'), { recursive: true })
  writeFileSync(join(directory, 'assets/app.js'), entry)
  writeFileSync(
    join(directory, 'openpencil.microfrontend.json'),
    JSON.stringify({
      format: 'openpencil-microfrontend',
      schemaVersion: 1,
      abi: 'openpencil.microfrontend.v1',
      app: { id: 'faulty', name: 'faulty', version: '1.0.0', framework: 'react' },
      artifact: {
        entry: {
          path: './assets/app.js',
          mediaType: 'text/javascript',
          byteLength: entry.byteLength,
          digest: microfrontendSha256Base64URL(entry)
        },
        styles: []
      },
      routes: ['/']
    })
  )
}

const composition: OpenPencilMicrofrontendCompositionManifestV1 = {
  format: 'openpencil-microfrontend-composition',
  schemaVersion: 1,
  abi: 'openpencil.microfrontend.v1',
  composition: { id: 'browser-shell', name: 'Browser Shell', version: '1.0.0' },
  slots: [{ id: 'main' }, { id: 'sidebar' }],
  apps: [
    {
      appId: 'home',
      manifest: { kind: 'local', path: './home/openpencil.microfrontend.json' },
      routeBase: '/',
      slotId: 'main'
    },
    {
      appId: 'orders',
      manifest: { kind: 'local', path: './orders/openpencil.microfrontend.json' },
      routeBase: '/orders',
      slotId: 'main'
    },
    {
      appId: 'bad',
      manifest: { kind: 'local', path: './bad/openpencil.microfrontend.json' },
      routeBase: '/bad',
      slotId: 'main'
    },
    {
      appId: 'throwing',
      manifest: { kind: 'local', path: './throwing/openpencil.microfrontend.json' },
      routeBase: '/throwing',
      slotId: 'main'
    },
    {
      appId: 'faulty',
      manifest: { kind: 'local', path: './faulty/openpencil.microfrontend.json' },
      routeBase: '/faulty',
      slotId: 'main'
    },
    {
      appId: 'navigation',
      manifest: { kind: 'local', path: './navigation/openpencil.microfrontend.json' },
      routeBase: '/',
      slotId: 'sidebar'
    }
  ]
}

describe('microfrontend composition browser runtime', () => {
  let browser: Browser | undefined
  let page: Page | undefined
  let sourceDir = ''
  let outDir = ''

  beforeAll(async () => {
    sourceDir = mkdtempSync(join(tmpdir(), 'op-mfe-browser-source-'))
    outDir = mkdtempSync(join(tmpdir(), 'op-mfe-browser-shell-'))
    writeRuntime(sourceDir, 'home')
    writeRuntime(sourceDir, 'orders')
    writeRuntime(sourceDir, 'bad', true)
    writeThrowingRuntime(sourceDir)
    writeFaultyUpdateRuntime(sourceDir)
    writeRuntime(sourceDir, 'navigation')
    await buildCompositionShell({ composition, sourceDir, outDir, base: '/suite/' })

    browser = await chromium.launch()
    page = await browser.newPage()
    await page.route('https://shell.example/**', async (route) => {
      await fulfillStaticShellRoute(route, outDir, '/suite/')
    })
  }, 30_000)

  afterAll(async () => {
    await page?.close()
    await browser?.close()
    if (sourceDir) rmSync(sourceDir, { recursive: true, force: true })
    if (outDir) rmSync(outDir, { recursive: true, force: true })
  }, 30_000)

  test('mounts longest-prefix slots from a deep base route and reconciles navigation', async () => {
    if (!page) throw new Error('Browser fixture did not start')
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))

    await page.goto('https://shell.example/suite/orders/detail?tab=open', {
      waitUntil: 'networkidle'
    })
    const orders = page.locator('[data-test-app="orders"]')
    const navigation = page.locator('[data-test-app="navigation"]')
    await playwrightExpect(orders).toBeVisible()
    await playwrightExpect(navigation).toBeVisible()
    await playwrightExpect(orders).toHaveAttribute('data-base', '/suite/orders')
    await playwrightExpect(page.locator('[data-test-portal="orders"]')).toBeVisible()
    expect(await page.locator('head [data-openpencil-microfrontend-style]').count()).toBe(0)

    await orders.getByRole('button', { name: 'navigate' }).click()
    await playwrightExpect(page).toHaveURL('https://shell.example/suite/orders/revisit')
    await playwrightExpect(orders).toHaveAttribute('data-updated-path', '/suite/orders/revisit')

    await page.evaluate(() => history.pushState(null, '', '/suite/home'))
    await playwrightExpect(page.locator('[data-test-app="home"]')).toBeVisible()
    await playwrightExpect(page.locator('[data-test-app="orders"]')).toHaveCount(0)
    await playwrightExpect(navigation).toHaveAttribute('data-updated-path', '/suite/home')

    const events = await page.evaluate(
      () => (window as Window & { __openpencilTestEvents?: string[] }).__openpencilTestEvents
    )
    expect(events).toContain('orders:mount:/suite/orders/detail')
    expect(events).toContain('orders:unmount')
    expect(events?.filter((entry) => entry === 'navigation:bootstrap')).toHaveLength(1)
    expect(errors).toEqual([])
  }, 30_000)

  test('rejects a runtime namespace with extra exports inside the visible shadow error surface', async () => {
    if (!page) throw new Error('Browser fixture did not start')
    await page.evaluate(() => history.pushState(null, '', '/suite/bad'))
    const main = page.locator('[data-openpencil-slot="main"]')
    await playwrightExpect(main.locator('[data-openpencil-error-message]')).toHaveText(
      'Unable to load bad'
    )
    await playwrightExpect(main).toHaveAttribute('data-openpencil-error', 'true')
    await playwrightExpect(page.locator('[data-test-app="bad"]')).toHaveCount(0)
  }, 30_000)

  test('best-effort unmounts and evicts a runtime whose mount partially fails', async () => {
    if (!page) throw new Error('Browser fixture did not start')
    await page.goto('https://shell.example/suite/throwing', { waitUntil: 'networkidle' })
    const main = page.locator('[data-openpencil-slot="main"]')
    await playwrightExpect(main.locator('[data-openpencil-error-message]')).toBeVisible()
    await page.evaluate(() => history.pushState(null, '', '/suite/home'))
    await playwrightExpect(page.locator('[data-test-app="home"]')).toBeVisible()
    await page.evaluate(() => history.pushState(null, '', '/suite/throwing'))
    await playwrightExpect(main.locator('[data-openpencil-error-message]')).toBeVisible()

    const events = await page.evaluate(
      () => (window as Window & { __openpencilTestEvents?: string[] }).__openpencilTestEvents ?? []
    )
    expect(events.filter((event) => event === 'throwing:bootstrap')).toHaveLength(2)
    expect(events.filter((event) => event === 'throwing:mount')).toHaveLength(2)
    expect(events.filter((event) => event === 'throwing:unmount')).toHaveLength(2)
  }, 30_000)

  test('clears stale UI and shows a recoverable error when update and cleanup throw', async () => {
    if (!page) throw new Error('Browser fixture did not start')
    await page.goto('https://shell.example/suite/faulty', { waitUntil: 'networkidle' })
    const main = page.locator('[data-openpencil-slot="main"]')
    await playwrightExpect(page.locator('[data-test-app="faulty"]')).toBeVisible()
    await page.evaluate(() => history.pushState(null, '', '/suite/faulty/detail'))
    await playwrightExpect(main.locator('[data-openpencil-error-message]')).toHaveText(
      'Unable to load faulty'
    )
    await playwrightExpect(page.locator('[data-test-app="faulty"]')).toHaveCount(0)
    const events = await page.evaluate(
      () => (window as Window & { __openpencilTestEvents?: string[] }).__openpencilTestEvents ?? []
    )
    expect(events).toContain('faulty:update')
    expect(events).toContain('faulty:unmount')
  }, 30_000)

  test('mounts, updates, and unmounts real generated React and Vue apps in isolated slots', async () => {
    if (!browser) throw new Error('Browser fixture did not start')
    const generatedSource = mkdtempSync(join(tmpdir(), 'op-mfe-generated-source-'))
    const generatedOut = mkdtempSync(join(tmpdir(), 'op-mfe-generated-shell-'))
    const generatedPage = await browser.newPage()
    try {
      const reactOutput = compileGeneratedApp('react', 'generated-react', 'Generated React')
      const vueOutput = compileGeneratedApp('vue', 'generated-vue', 'Generated Vue')
      await buildMicrofrontendProject({
        output: reactOutput,
        outDir: join(generatedSource, 'react')
      })
      await buildMicrofrontendProject({
        output: vueOutput,
        outDir: join(generatedSource, 'vue')
      })
      const generatedComposition: OpenPencilMicrofrontendCompositionManifestV1 = {
        format: 'openpencil-microfrontend-composition',
        schemaVersion: 1,
        abi: 'openpencil.microfrontend.v1',
        composition: {
          id: 'generated-browser-shell',
          name: 'Generated Browser Shell',
          version: '1.0.0'
        },
        slots: [{ id: 'react' }, { id: 'vue' }],
        apps: [
          {
            appId: 'generated-react',
            manifest: { kind: 'local', path: './react/openpencil.microfrontend.json' },
            routeBase: '/apps',
            slotId: 'react'
          },
          {
            appId: 'generated-vue',
            manifest: { kind: 'local', path: './vue/openpencil.microfrontend.json' },
            routeBase: '/apps',
            slotId: 'vue'
          }
        ]
      }
      await buildCompositionShell({
        composition: generatedComposition,
        sourceDir: generatedSource,
        outDir: generatedOut,
        base: '/generated/'
      })
      await generatedPage.route('https://generated.example/**', async (route) => {
        await fulfillStaticShellRoute(route, generatedOut, '/generated/')
      })

      const errors: string[] = []
      const consoleMessages: string[] = []
      generatedPage.on('pageerror', (error) => errors.push(error.message))
      generatedPage.on('console', (message) => consoleMessages.push(message.text()))
      await generatedPage.goto('https://generated.example/generated/apps', {
        waitUntil: 'networkidle'
      })
      const reactSlot = generatedPage.locator('[data-openpencil-slot="react"]')
      const vueSlot = generatedPage.locator('[data-openpencil-slot="vue"]')
      await generatedPage.waitForTimeout(250)
      await playwrightExpect(reactSlot.getByText('Generated React Home')).toBeVisible()
      await playwrightExpect(vueSlot.getByText('Generated Vue Home')).toBeVisible()
      expect(await reactSlot.locator('style[data-openpencil-microfrontend-style]').count()).toBe(1)
      expect(await vueSlot.locator('style[data-openpencil-microfrontend-style]').count()).toBe(1)
      expect(
        await generatedPage.locator('head style[data-openpencil-microfrontend-style]').count()
      ).toBe(0)

      const overlayBounds = await reactSlot.evaluate((slot) => {
        const target = slot.shadowRoot?.querySelector<HTMLElement>(
          '[data-openpencil-microfrontend-portal]'
        )
        if (!target) throw new Error('portal target missing')
        const overlay = document.createElement('div')
        overlay.style.cssText = 'position:fixed;inset:0'
        target.append(overlay)
        const slotRect = slot.getBoundingClientRect()
        const overlayRect = overlay.getBoundingClientRect()
        overlay.remove()
        return {
          slot: { x: slotRect.x, width: slotRect.width, height: slotRect.height },
          overlay: {
            x: overlayRect.x,
            width: overlayRect.width,
            height: overlayRect.height
          }
        }
      })
      expect(overlayBounds.overlay).toEqual(overlayBounds.slot)

      await generatedPage.evaluate(() => history.pushState(null, '', '/generated/apps/settings'))
      await playwrightExpect(reactSlot.getByText('Generated React Settings')).toBeVisible()
      await playwrightExpect(vueSlot.getByText('Generated Vue Settings')).toBeVisible()

      await generatedPage.evaluate(() => history.pushState(null, '', '/generated/outside'))
      await playwrightExpect(reactSlot.getByText('Generated React Settings')).toHaveCount(0)
      await playwrightExpect(vueSlot.getByText('Generated Vue Settings')).toHaveCount(0)
      expect(await reactSlot.locator('[data-openpencil-microfrontend-mount]').count()).toBe(0)
      expect(await vueSlot.locator('[data-openpencil-microfrontend-mount]').count()).toBe(0)

      await generatedPage.evaluate(() => history.pushState(null, '', '/generated/apps'))
      await playwrightExpect(reactSlot.getByText('Generated React Home')).toBeVisible()
      await playwrightExpect(vueSlot.getByText('Generated Vue Home')).toBeVisible()
      expect(errors).toEqual([])
      expect(consoleMessages).toEqual([])
    } finally {
      await generatedPage.close()
      rmSync(generatedSource, { recursive: true, force: true })
      rmSync(generatedOut, { recursive: true, force: true })
    }
  }, 60_000)
})
