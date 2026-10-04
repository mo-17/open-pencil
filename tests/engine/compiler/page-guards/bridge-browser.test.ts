import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { buildPreviewBridge } from '#compiler/adapters/preview-bridge'
import { buildBrowserPreviewHTML } from '#compiler/browser-preview/html'
import { prepareBrowserPreviewReactFiles } from '#compiler/browser-preview/routing'
import { chromium, expect as browserExpect, type Browser, type Page } from '@playwright/test'

const CHANNEL = 'page_guard_bridge_browser_0001'
const CURRENT_ROUTE = '/products/42?tab=edit#details'
const EDITOR_SOURCE = 'op-lowcode-editor'
const TRANSPORTS = ['http', 'blob'] as const
type Transport = 'http' | 'blob'

interface GuardRequest {
  route: string
  allowed: boolean
  bootPending: boolean
}

interface GuardSnapshot {
  route: string
  allowed: boolean
  bootPending: boolean
  mounts: boolean[]
  requests: GuardRequest[]
  cancellations: number
  choices: number
  pending: boolean
}

interface BridgeMessage {
  type: string
  source: string
  channel: string
  route?: string
}

interface GuardFixture {
  install(): void
  choose(): void
  snapshot(): GuardSnapshot
  probe(): void
}

interface FixtureWindow extends Window {
  __GUARD_FIXTURE__?: GuardFixture
}

interface HostWindow extends Window {
  __GUARD_MESSAGES__?: BridgeMessage[]
  __GUARD_PORT__?: MessagePort
  __GUARD_BLOB__?: string
}

interface LoadedFixture {
  page: Page
  transport: Transport
  origin: string
}

// Guard and DocStore are deliberately mocked. The full generated bridge, its
// Blob route adaptation, bootstrap, and browser transports remain production code.
// React/Vue mount/permission semantics belong to the framework integration suite.
function fixtureSource(transport: Transport): string {
  return `
let documentState: Record<string, unknown> = { allowed: true }
const subscribers = new Set<(state: Record<string, unknown>, previous: Record<string, unknown>) => void>()
const mounts: boolean[] = []
const requests: { route: string; allowed: boolean; bootPending: boolean }[] = []
let cancellations = 0, choices = 0
let pending: { canceled: boolean; finish: (accepted: boolean) => void } | undefined
let lateChoice: (() => void) | undefined
const current = () => ${transport === 'blob' ? 'location.hash.slice(1)' : 'location.pathname + location.search + location.hash'}
const snapshot = () => ({ route: current(), allowed: documentState.allowed === true, bootPending: window.__opApplicationGuardBootPending === true, mounts: [...mounts], requests: [...requests], cancellations, choices, pending: Boolean(pending) })
const probe = () => {
  if (window.__opApplicationGuardBootPending !== true && documentState.allowed === true) mounts.push(true)
}
const commit = (route: string, replace: boolean) => {
  if (route === current()) return
  const href = ${transport === 'blob' ? "'#' + route" : 'route'}
  if (replace) history.replaceState(history.state, '', href)
  else history.pushState(null, '', href)
  window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }))
}
window.__opDocStore = {
  getState: () => documentState,
  setState(partial) {
    const previous = documentState
    documentState = { ...documentState, ...partial }
    for (const listener of subscribers) listener(documentState, previous)
    probe()
  },
  subscribe(listener) { subscribers.add(listener); return () => { subscribers.delete(listener) } }
}
;(window as Window & { __GUARD_FIXTURE__: unknown }).__GUARD_FIXTURE__ = {
  snapshot, probe,
  choose() { choices++; lateChoice?.() },
  install() {
    window.__opApplicationNavigationGuard = {
      cancelPending() {
        if (!pending) return
        cancellations++
        pending.canceled = true
        pending.finish(false)
        pending = undefined
      },
      async requestRoute(route, replace = false) {
        requests.push({ route, allowed: documentState.allowed === true, bootPending: window.__opApplicationGuardBootPending === true })
        // This is the framework Guard API's release-before-reading-scope contract.
        window.__opApplicationGuardBootPending = false
        probe()
        if (route === '/home') return new Promise<boolean>((resolve) => {
          const request = { canceled: false, finish: resolve }
          pending = request
          lateChoice = () => {
            if (!request.canceled) { commit(route, replace); pending = undefined; resolve(true) }
          }
        })
        if (documentState.allowed !== true) { commit('/login', true); return false }
        commit(route, replace)
        return true
      }
    }
    window.dispatchEvent(new Event('op-application-guards-ready'))
  }
}
`
}

function previewHTML(transport: Transport): string {
  let bridge = buildPreviewBridge({ applicationGuards: true })
  if (transport === 'blob') {
    const files = new Map<string, string>([
      ['src/App.tsx', 'export default function App() { return null }'],
      ['src/__preview-bridge.ts', bridge]
    ])
    const prepared = prepareBrowserPreviewReactFiles(files, CHANNEL).files.get(
      'src/__preview-bridge.ts'
    )
    if (typeof prepared !== 'string') throw new Error('Missing generated Blob bridge')
    bridge = prepared
  }
  const javascript = new Bun.Transpiler({ loader: 'ts' }).transformSync(
    fixtureSource(transport) + '\n' + bridge + '\nprobe()\n'
  )
  if (transport === 'blob') {
    return buildBrowserPreviewHTML({
      channel: CHANNEL,
      javascript,
      css: '',
      imports: {},
      reviewedDataURLBytes: 0
    })
  }
  return (
    '<!doctype html><html><body><script type="module">' +
    javascript.replaceAll('</script', '<\\/script') +
    '</script></body></html>'
  )
}

async function loadFixture(page: Page, transport: Transport): Promise<LoadedFixture> {
  const origin = 'http://127.0.0.1:19583'
  const html = previewHTML(transport)
  await page.route(origin + '/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body:
        new URL(route.request().url()).pathname === '/host'
          ? '<!doctype html><html><body></body></html>'
          : html
    })
  )
  await page.goto(origin + '/host')
  await page.evaluate(
    ({ transport, html, route, channel }) => {
      const host = window as HostWindow
      host.__GUARD_MESSAGES__ = []
      const iframe = document.createElement('iframe')
      iframe.id = 'preview'
      iframe.name = JSON.stringify({
        protocol: 'open-pencil-preview-v2',
        channel,
        parentOrigin: location.origin,
        transport: transport === 'blob' ? 'message-port' : 'window',
        automation: false
      })
      window.addEventListener('message', (event) => {
        if (
          event.source !== iframe.contentWindow ||
          event.origin !== (transport === 'blob' ? 'null' : location.origin) ||
          event.data?.source !== 'op-lowcode-preview' ||
          event.data?.channel !== channel
        )
          return
        if (transport === 'blob' && event.data.type === 'ready' && event.ports.length === 1) {
          const port = event.ports[0]
          host.__GUARD_PORT__ = port
          port.addEventListener('message', (message) => host.__GUARD_MESSAGES__?.push(message.data))
          port.start()
        } else host.__GUARD_MESSAGES__?.push(event.data)
      })
      if (transport === 'blob') {
        iframe.sandbox.add('allow-scripts')
        host.__GUARD_BLOB__ = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
        iframe.src = host.__GUARD_BLOB__ + '#' + route
      } else iframe.src = location.origin + route
      document.body.append(iframe)
    },
    { transport, html, route: CURRENT_ROUTE, channel: CHANNEL }
  )
  await browserExpect
    .poll(() =>
      page
        .frameLocator('#preview')
        .locator('html')
        .evaluate(
          () =>
            Boolean((window as FixtureWindow).__GUARD_FIXTURE__) &&
            (window as Window & { __openPencilPreviewBridge?: boolean })
              .__openPencilPreviewBridge === true
        )
    )
    .toBe(true)
  if (transport === 'blob')
    await page.waitForFunction(() => Boolean((window as HostWindow).__GUARD_PORT__))
  return { page, transport, origin }
}

async function readSnapshot(loaded: LoadedFixture): Promise<GuardSnapshot> {
  return loaded.page
    .frameLocator('#preview')
    .locator('html')
    .evaluate(() => {
      const fixture = (window as FixtureWindow).__GUARD_FIXTURE__
      if (!fixture) throw new Error('Missing Guard fixture')
      return fixture.snapshot()
    })
}

async function control(loaded: LoadedFixture, action: 'install' | 'choose'): Promise<void> {
  await loaded.page
    .frameLocator('#preview')
    .locator('html')
    .evaluate((_, action) => {
      const fixture = (window as FixtureWindow).__GUARD_FIXTURE__
      if (!fixture) throw new Error('Missing Guard fixture')
      fixture[action]()
    }, action)
}

async function send(
  loaded: LoadedFixture,
  payload: Record<string, unknown>,
  valid = true
): Promise<void> {
  await loaded.page.evaluate(
    ({ payload, transport, origin, valid, channel, source }) => {
      const message = {
        source,
        channel: valid ? channel : channel + '_wrong',
        ...payload
      }
      if (transport === 'blob') (window as HostWindow).__GUARD_PORT__?.postMessage(message)
      else
        (document.querySelector('#preview') as HTMLIFrameElement).contentWindow?.postMessage(
          message,
          origin
        )
    },
    {
      payload,
      transport: loaded.transport,
      origin: loaded.origin,
      valid,
      channel: CHANNEL,
      source: EDITOR_SOURCE
    }
  )
}

async function barrier(loaded: LoadedFixture, theme: 'light' | 'dark'): Promise<void> {
  await send(loaded, { type: 'theme', theme })
  await browserExpect(loaded.page.frameLocator('#preview').locator('html')).toHaveAttribute(
    'data-theme',
    theme
  )
}

async function navigationMessages(loaded: LoadedFixture): Promise<BridgeMessage[]> {
  return loaded.page.evaluate(
    () =>
      (window as HostWindow).__GUARD_MESSAGES__?.filter((message) => message.type === 'navigate') ??
      []
  )
}

async function closeFixture(page: Page): Promise<void> {
  await page.evaluate(() => {
    const host = window as HostWindow
    host.__GUARD_PORT__?.close()
    if (host.__GUARD_BLOB__) URL.revokeObjectURL(host.__GUARD_BLOB__)
  })
  await page.close()
}

describe('actual generated guarded bridge in Chromium (mock Guard API only)', () => {
  let browser: Browser | undefined
  beforeAll(async () => {
    browser = await chromium.launch()
  }, 30_000)
  afterAll(async () => {
    await browser?.close()
  }, 30_000)

  TRANSPORTS.forEach((transport) => {
    test(`${transport} restores document state before releasing the first guarded navigation`, async () => {
      if (!browser) throw new Error('Chromium did not start')
      const page = await browser.newPage()
      try {
        const loaded = await loadFixture(page, transport)
        expect(await readSnapshot(loaded)).toMatchObject({
          allowed: true,
          bootPending: true,
          mounts: [],
          requests: []
        })
        // A wrong-channel recovery cannot unlock or restore the first page.
        await send(loaded, { type: 'docState', name: 'allowed', value: false }, false)
        await send(loaded, { type: 'navigate', route: CURRENT_ROUTE, replace: true }, false)
        await barrier(loaded, 'dark')
        expect(await readSnapshot(loaded)).toMatchObject({
          allowed: true,
          bootPending: true,
          mounts: [],
          requests: []
        })
        await send(loaded, { type: 'docState', name: 'allowed', value: false })
        await send(loaded, { type: 'navigate', route: CURRENT_ROUTE, replace: true })
        await barrier(loaded, 'light')
        expect(await readSnapshot(loaded)).toMatchObject({
          allowed: false,
          bootPending: true,
          mounts: [],
          requests: []
        })
        await control(loaded, 'install')
        await browserExpect.poll(async () => (await readSnapshot(loaded)).route).toBe('/login')
        expect(await readSnapshot(loaded)).toMatchObject({
          allowed: false,
          bootPending: false,
          mounts: [],
          requests: [{ route: CURRENT_ROUTE, allowed: false, bootPending: true }]
        })
        await browserExpect
          .poll(async () => (await navigationMessages(loaded)).length)
          .toBeGreaterThan(0)
        expect(
          (await navigationMessages(loaded)).every(
            (message) =>
              message.source === 'op-lowcode-preview' &&
              message.channel === CHANNEL &&
              message.route === '/login'
          )
        ).toBe(true)
      } finally {
        await closeFixture(page)
      }
    }, 30_000)

    test(`${transport} newer current-route replay cancels pending navigation and ignores a late choice`, async () => {
      if (!browser) throw new Error('Chromium did not start')
      const page = await browser.newPage()
      try {
        const loaded = await loadFixture(page, transport)
        // Both navigations arrive before API registration. Only the newest may drain.
        await send(loaded, { type: 'navigate', route: '/login', replace: true })
        await send(loaded, { type: 'navigate', route: CURRENT_ROUTE, replace: true })
        await barrier(loaded, 'dark')
        await control(loaded, 'install')
        await browserExpect
          .poll(async () => (await readSnapshot(loaded)).requests.map((request) => request.route))
          .toEqual([CURRENT_ROUTE])
        await send(loaded, { type: 'navigate', route: '/home' })
        await browserExpect.poll(async () => (await readSnapshot(loaded)).pending).toBe(true)
        // Wrong-channel withdrawal must leave the actual pending choice untouched.
        await send(loaded, { type: 'navigate', route: CURRENT_ROUTE, replace: true }, false)
        await barrier(loaded, 'light')
        expect(await readSnapshot(loaded)).toMatchObject({
          route: CURRENT_ROUTE,
          pending: true,
          cancellations: 0
        })
        await send(loaded, { type: 'navigate', route: CURRENT_ROUTE, replace: true })
        await browserExpect
          .poll(async () => (await readSnapshot(loaded)).requests.map((request) => request.route))
          .toEqual([CURRENT_ROUTE, '/home', CURRENT_ROUTE])
        expect(await readSnapshot(loaded)).toMatchObject({
          route: CURRENT_ROUTE,
          pending: false,
          cancellations: 1
        })
        await control(loaded, 'choose')
        await barrier(loaded, 'dark')
        expect(await readSnapshot(loaded)).toMatchObject({
          route: CURRENT_ROUTE,
          pending: false,
          cancellations: 1,
          choices: 1
        })
        expect(
          (await navigationMessages(loaded)).some((message) => message.route === '/home')
        ).toBe(false)
      } finally {
        await closeFixture(page)
      }
    }, 30_000)
  })
})
