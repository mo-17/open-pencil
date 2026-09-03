/* oxlint-disable eslint/max-lines -- One browser lifecycle exercises the complete cross-origin bridge. */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { chromium, expect as playwrightExpect, type Browser, type Page } from '@playwright/test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { createPreviewServer, type PreviewServer } from '@open-pencil/compiler/dev-server'
import { SceneGraph } from '@open-pencil/scene-graph'

type WebTarget = 'react' | 'vue'
const WEB_TARGETS = ['react', 'vue'] as const
const CHANNEL_PROTOCOL = 'open-pencil-preview-v2'
const EDITOR_SOURCE = 'op-lowcode-editor'

interface PreviewMessage {
  source?: unknown
  channel?: unknown
  type?: unknown
  id?: unknown
  route?: unknown
  name?: unknown
  value?: unknown
  status?: unknown
  snapshot?: unknown
  error?: unknown
  observedOrigin?: unknown
  observedSource?: unknown
  requestId?: unknown
  ok?: unknown
  text?: unknown
}

interface BridgeFixture {
  files: Map<string, string | Uint8Array>
  inputId: string
}

interface LoadedBridge {
  page: Page
  server: PreviewServer
  inputId: string
  channel: string
  parentOrigin: string
  previewOrigin: string
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
  const browserErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  page.on('pageerror', (error) => browserErrors.push(error.message))
  page.on('requestfailed', (request) => {
    browserErrors.push(`${request.url()}: ${request.failure()?.errorText ?? 'request failed'}`)
  })
  const fixture = buildBridgeFixture(target)
  const server = await createPreviewServer({ target, initialFiles: fixture.files })
  const previewOrigin = new URL(server.url).origin
  const hostURL = new URL('/__open-pencil-preview-bridge-host__', server.url)
  const parentOrigin = hostURL.origin
  const channel = `runtime_bridge_${target}_0001`
  await page.route(hostURL.href, async (route) => {
    await route.fulfill({
      contentType: 'text/html',
      body: `
    <!doctype html>
    <html>
      <body>
        <script>
          window.__OP_PREVIEW_MESSAGES__ = []
          window.addEventListener('message', (event) => {
            if (event.data?.source === 'op-lowcode-preview') {
              const preview = document.querySelector('#preview')
              window.__OP_PREVIEW_MESSAGES__.push({
                ...event.data,
                observedOrigin: event.origin,
                observedSource: event.source === preview?.contentWindow
              })
            }
          })
        </script>
      </body>
    </html>
  `
    })
  })
  await page.goto(hostURL.href)
  await page.locator('body').evaluate(
    (body, context) => {
      const frame = document.createElement('iframe')
      frame.id = 'preview'
      frame.title = context.title
      frame.name = JSON.stringify({
        protocol: context.protocol,
        channel: context.channel,
        parentOrigin: context.parentOrigin,
        transport: 'window',
        automation: true
      })
      frame.src = context.url
      body.prepend(frame)
    },
    {
      protocol: CHANNEL_PROTOCOL,
      channel,
      parentOrigin,
      title: `Generated ${target} preview`,
      url: server.url
    }
  )
  try {
    await playwrightExpect(
      page.frameLocator('#preview').getByPlaceholder('Shared preview value')
    ).toBeVisible()
  } catch (error) {
    const frameURLs = page.frames().map((frame) => frame.url())
    throw new Error(
      `Preview bridge fixture did not load. frames=${JSON.stringify(frameURLs)} errors=${JSON.stringify(browserErrors)}`,
      { cause: error }
    )
  }
  const bridgeBoot = await page
    .frameLocator('#preview')
    .locator('html')
    .evaluate(() => ({
      name: window.name,
      mounted:
        (window as Window & { __openPencilPreviewBridge?: boolean }).__openPencilPreviewBridge ===
        true,
      overlayCount: document.querySelectorAll('[data-op-preview-overlay]').length,
      origin: location.origin
    }))
  if (!bridgeBoot.mounted) {
    throw new Error(`Preview bridge did not mount: ${JSON.stringify(bridgeBoot)}`)
  }
  return { page, server, inputId: fixture.inputId, channel, parentOrigin, previewOrigin }
}

async function postToPreview(
  loaded: LoadedBridge,
  payload: Record<string, unknown>,
  options: { source?: string; channel?: string } = {}
): Promise<void> {
  await loaded.page.locator('#preview').evaluate(
    (element, value) => {
      ;(element as HTMLIFrameElement).contentWindow?.postMessage(
        { source: value.source, channel: value.channel, ...value.payload },
        value.targetOrigin
      )
    },
    {
      source: options.source ?? EDITOR_SOURCE,
      channel: options.channel ?? loaded.channel,
      payload,
      targetOrigin: loaded.previewOrigin
    }
  )
}

async function dispatchSyntheticMessage(
  loaded: LoadedBridge,
  payload: Record<string, unknown>,
  options: { origin: string; source: 'parent' | 'self' }
): Promise<void> {
  await loaded.page
    .frameLocator('#preview')
    .locator('html')
    .evaluate(
      (_, value) => {
        window.dispatchEvent(
          new MessageEvent('message', {
            data: value.payload,
            origin: value.origin,
            source: value.source === 'parent' ? window.parent : window
          })
        )
      },
      { payload, ...options }
    )
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
  const { page, inputId, channel, previewOrigin } = loaded
  const frame = page.frameLocator('#preview')
  const input = frame.getByPlaceholder('Shared preview value')

  await postToPreview(loaded, { type: 'theme', theme: 'dark' })
  await expectTheme(page, 'dark')
  await postToPreview(loaded, { type: 'theme', theme: 'sepia' })
  await expectTheme(page, 'dark')
  await postToPreview(loaded, { type: 'theme', theme: 'light' })
  await expectTheme(page, 'light')

  await postToPreview(loaded, { type: 'select', id: inputId })
  await playwrightExpect(frame.locator('[data-op-preview-overlay]')).toBeVisible()
  await clearMessages(page)
  await input.click({ modifiers: ['Alt'] })
  await playwrightExpect
    .poll(async () =>
      (await messages(page)).some(
        (message) =>
          message.type === 'select' &&
          message.id === inputId &&
          message.channel === channel &&
          message.observedOrigin === previewOrigin &&
          message.observedSource === true
      )
    )
    .toBe(true)

  await clearMessages(page)
  await postToPreview(loaded, { type: 'docState', name: 'sharedValue', value: 'remote' })
  await playwrightExpect(input).toHaveValue('remote')
  expect((await messages(page)).filter((message) => message.type === 'docState')).toEqual([])
  await input.fill('local')
  await playwrightExpect
    .poll(async () =>
      (await messages(page)).some(
        (message) =>
          message.type === 'docState' &&
          message.name === 'sharedValue' &&
          message.value === 'local' &&
          message.channel === channel
      )
    )
    .toBe(true)

  await clearMessages(page)
  await postToPreview(loaded, { type: 'navigate', route: '/about' })
  await playwrightExpect(frame.getByText(`${target} about route`)).toBeVisible()
  expect((await messages(page)).filter((message) => message.type === 'navigate')).toEqual([])
  await frame.locator('body').evaluate(() => history.pushState(null, '', '/'))
  await playwrightExpect
    .poll(async () =>
      (await messages(page)).some(
        (message) =>
          message.type === 'navigate' && message.route === '/' && message.channel === channel
      )
    )
    .toBe(true)
}

async function exerciseInboundValidation(loaded: LoadedBridge): Promise<void> {
  const { page, channel, inputId, parentOrigin } = loaded
  const frame = page.frameLocator('#preview')
  const overlay = frame.locator('[data-op-preview-overlay]')

  async function expectRejected(sendInvalid: () => Promise<void>): Promise<void> {
    await postToPreview(loaded, { type: 'theme', theme: 'light' })
    await expectTheme(page, 'light')
    await postToPreview(loaded, { type: 'select', id: null })
    await playwrightExpect(overlay).toBeHidden()
    await sendInvalid()
    // This valid message is a FIFO barrier for real parent postMessage calls.
    // Once the overlay is visible, the preceding invalid message was already
    // inspected by the generated bridge.
    await postToPreview(loaded, { type: 'select', id: inputId })
    await playwrightExpect(overlay).toBeVisible()
    await expectTheme(page, 'light')
  }

  await expectRejected(() =>
    postToPreview(loaded, { type: 'theme', theme: 'dark' }, { source: 'attacker' })
  )
  await expectRejected(() =>
    dispatchSyntheticMessage(
      loaded,
      { source: EDITOR_SOURCE, channel, type: 'theme', theme: 'dark' },
      { origin: parentOrigin, source: 'self' }
    )
  )
  await expectRejected(() =>
    dispatchSyntheticMessage(
      loaded,
      { source: EDITOR_SOURCE, channel, type: 'theme', theme: 'dark' },
      { origin: 'https://attacker.invalid', source: 'parent' }
    )
  )
  await expectRejected(() =>
    postToPreview(loaded, { type: 'theme', theme: 'dark' }, { channel: `${channel}_wrong` })
  )
  await expectRejected(() =>
    postToPreview(loaded, { type: 'theme', theme: 'dark', unexpected: true })
  )

  await postToPreview(loaded, { type: 'theme', theme: 'dark' })
  await expectTheme(page, 'dark')
}

async function exerciseFrameContextOriginPolicy(loaded: LoadedBridge): Promise<void> {
  async function mountContextFrame(
    id: string,
    parentOrigin: string,
    automation?: boolean
  ): Promise<void> {
    await loaded.page.locator('body').evaluate(
      (body, value) => {
        const frame = document.createElement('iframe')
        frame.id = value.id
        frame.name = JSON.stringify({
          protocol: value.protocol,
          channel: value.channel,
          parentOrigin: value.parentOrigin,
          transport: 'window',
          ...(value.automation === undefined ? {} : { automation: value.automation })
        })
        frame.src = value.url
        body.appendChild(frame)
      },
      {
        id,
        protocol: CHANNEL_PROTOCOL,
        channel: loaded.channel,
        parentOrigin,
        automation,
        url: loaded.server.url
      }
    )
    await playwrightExpect(
      loaded.page.frameLocator(`#${id}`).getByPlaceholder('Shared preview value')
    ).toBeVisible()
  }

  await mountContextFrame('tauri-context-preview', 'tauri://localhost')
  await playwrightExpect(
    loaded.page.frameLocator('#tauri-context-preview').locator('[data-op-preview-overlay]')
  ).toHaveCount(1)

  await mountContextFrame('untrusted-context-preview', 'openpencil://localhost')
  await playwrightExpect(
    loaded.page.frameLocator('#untrusted-context-preview').locator('[data-op-preview-overlay]')
  ).toHaveCount(0)

  await mountContextFrame('disabled-automation-preview', loaded.parentOrigin, false)
  const disabledFrame = loaded.page.frameLocator('#disabled-automation-preview')
  await disabledFrame.locator('body').evaluate((body) => {
    const button = document.createElement('button')
    button.dataset.testid = 'disabled-automation-button'
    button.dataset.clicks = '0'
    button.textContent = 'Disabled automation'
    button.addEventListener('click', () => {
      button.dataset.clicks = String(Number(button.dataset.clicks ?? '0') + 1)
    })
    body.append(button)
  })
  await clearMessages(loaded.page)
  await loaded.page.locator('#disabled-automation-preview').evaluate(
    (element, context) => {
      ;(element as HTMLIFrameElement).contentWindow?.postMessage(
        {
          source: context.source,
          channel: context.channel,
          type: 'automation',
          requestId: 'webdriver_disabled_gate_0001',
          action: 'click',
          by: 'testId',
          locator: 'disabled-automation-button'
        },
        context.targetOrigin
      )
    },
    { channel: loaded.channel, source: EDITOR_SOURCE, targetOrigin: loaded.previewOrigin }
  )
  await loaded.page.waitForTimeout(100)
  expect(
    (await messages(loaded.page)).some(
      (message) =>
        message.type === 'automationResult' && message.requestId === 'webdriver_disabled_gate_0001'
    )
  ).toBe(false)
  await playwrightExpect(disabledFrame.getByTestId('disabled-automation-button')).toHaveAttribute(
    'data-clicks',
    '0'
  )
}

async function exerciseMotionDebugValidation(loaded: LoadedBridge): Promise<void> {
  type InspectMode = 'ready' | 'oversized' | 'nonportable' | 'throws'

  async function installInspector(mode: InspectMode): Promise<void> {
    await loaded.page
      .frameLocator('#preview')
      .locator('html')
      .evaluate((_, value) => {
        const host = window as Window & {
          __OPENPENCIL_MOTION_RUNTIME__?: { inspect: () => unknown }
        }
        host.__OPENPENCIL_MOTION_RUNTIME__ = {
          inspect: () => {
            if (value === 'oversized') {
              return { entries: Array.from({ length: 257 }, () => ({})) }
            }
            if (value === 'nonportable') {
              return { entries: [{ handler: () => undefined }] }
            }
            if (value === 'throws') throw new Error('x'.repeat(70_000))
            return { entries: [{ id: 'motion-1', phase: 'idle' }] }
          }
        }
      }, mode)
  }

  async function inspect(mode: InspectMode): Promise<PreviewMessage> {
    await installInspector(mode)
    await clearMessages(loaded.page)
    await postToPreview(loaded, { type: 'motionDebug', enabled: true })
    await playwrightExpect
      .poll(async () =>
        (await messages(loaded.page)).some((message) => message.type === 'motionDebug')
      )
      .toBe(true)
    await postToPreview(loaded, { type: 'motionDebug', enabled: false })
    const barrierTheme = mode === 'ready' || mode === 'nonportable' ? 'dark' : 'light'
    await postToPreview(loaded, {
      type: 'theme',
      theme: barrierTheme
    })
    await expectTheme(loaded.page, barrierTheme)
    const message = (await messages(loaded.page)).find(
      (candidate) => candidate.type === 'motionDebug'
    )
    if (!message) throw new Error(`Motion ${mode} result was not posted`)
    expect(message.channel).toBe(loaded.channel)
    return message
  }

  const ready = await inspect('ready')
  expect(ready.status).toBe('ready')
  expect(ready.snapshot).toEqual({ entries: [{ id: 'motion-1', phase: 'idle' }] })

  for (const mode of ['oversized', 'nonportable'] as const) {
    const rejected = await inspect(mode)
    expect(rejected.status).toBe('error')
    expect(rejected.error).toBe('Motion diagnostics exceed the preview safety limit.')
  }

  const thrown = await inspect('throws')
  expect(thrown.status).toBe('error')
  expect(typeof thrown.error).toBe('string')
  expect((thrown.error as string).length).toBe(65_536)
}

async function exerciseWebDriverAutomation(loaded: LoadedBridge): Promise<void> {
  const frame = loaded.page.frameLocator('#preview')
  await frame.locator('body').evaluate((body) => {
    const region = document.createElement('section')
    region.dataset.testid = 'webdriver-crud-region'
    const marker = document.createElement('p')
    marker.dataset.testid = 'webdriver-marker'
    marker.setAttribute('data-op-automation-readable', '')
    const sensitiveMarker = document.createElement('span')
    sensitiveMarker.setAttribute('data-op-sensitive', '')
    sensitiveMarker.textContent = 'nested-sensitive-value'
    const nestedControl = document.createElement('button')
    nestedControl.textContent = 'nested-control-value'
    marker.append('Visible task marker', sensitiveMarker, nestedControl)
    const ordinary = document.createElement('p')
    ordinary.dataset.nodeId = 'webdriver-unmarked-node'
    ordinary.textContent = 'ordinary-unmarked-value'
    const editable = document.createElement('div')
    editable.dataset.testid = 'webdriver-contenteditable'
    editable.contentEditable = 'true'
    editable.textContent = 'contenteditable-value'
    const textbox = document.createElement('div')
    textbox.dataset.testid = 'webdriver-role-textbox'
    textbox.setAttribute('role', 'group TEXTBOX')
    textbox.textContent = 'role-textbox-value'
    const title = document.createElement('input')
    title.dataset.testid = 'webdriver-task-title'
    title.placeholder = 'Task title'
    const password = document.createElement('input')
    password.dataset.testid = 'webdriver-password'
    password.type = 'password'
    password.placeholder = 'Staging password'
    password.value = 'top-secret-value'
    const email = document.createElement('input')
    email.dataset.testid = 'webdriver-email'
    email.type = 'email'
    email.placeholder = 'Staging email'
    const button = document.createElement('button')
    button.dataset.testid = 'webdriver-create'
    button.textContent = 'Create fixture'
    button.addEventListener('click', () => {
      const count = Number(region.dataset.clicks ?? '0') + 1
      region.dataset.clicks = String(count)
      marker.replaceChildren(
        document.createTextNode(`Created fixture ${count}`),
        sensitiveMarker,
        nestedControl
      )
    })
    region.append(marker, ordinary, editable, textbox, title, password, email, button)
    body.append(region)
  })

  async function request(payload: Record<string, unknown>): Promise<PreviewMessage> {
    await clearMessages(loaded.page)
    await postToPreview(loaded, payload)
    await playwrightExpect
      .poll(async () =>
        (await messages(loaded.page)).some(
          (message) =>
            message.type === 'automationResult' && message.requestId === payload.requestId
        )
      )
      .toBe(true)
    const result = (await messages(loaded.page)).find(
      (message) => message.type === 'automationResult' && message.requestId === payload.requestId
    )
    if (!result) throw new Error('Missing WebDriver automation result')
    expect(result.observedOrigin).toBe(loaded.previewOrigin)
    expect(result.observedSource).toBe(true)
    return result
  }

  expect(
    await request({
      type: 'automation',
      requestId: 'webdriver_set_title_0001',
      action: 'set',
      by: 'testId',
      locator: 'webdriver-task-title',
      value: 'OpenPencil staging task'
    })
  ).toMatchObject({ ok: true, status: 'set', text: null, error: null })
  await playwrightExpect(frame.getByTestId('webdriver-task-title')).toHaveValue(
    'OpenPencil staging task'
  )

  const clickRequest = {
    type: 'automation',
    requestId: 'webdriver_click_create_0001',
    action: 'click',
    by: 'buttonText',
    locator: 'Create fixture'
  }
  expect(await request(clickRequest)).toMatchObject({
    ok: true,
    status: 'clicked',
    text: null,
    error: null
  })
  await playwrightExpect(frame.getByTestId('webdriver-marker')).toContainText('Created fixture 1')
  expect(await request(clickRequest)).toMatchObject({
    ok: false,
    status: 'rejected',
    text: null,
    error: 'invalid-request'
  })
  await playwrightExpect(frame.getByTestId('webdriver-marker')).toContainText('Created fixture 1')

  expect(
    await request({
      type: 'automation',
      requestId: 'webdriver_wait_created_0001',
      action: 'wait',
      by: 'testId',
      locator: 'webdriver-marker',
      text: 'Created fixture 1',
      timeoutMs: 1_000
    })
  ).toMatchObject({ ok: true, status: 'matched', text: null, error: null })

  const snapshot = await request({
    type: 'automation',
    requestId: 'webdriver_read_marker_0001',
    action: 'read-safe-text',
    by: 'testId',
    locator: 'webdriver-marker'
  })
  expect(snapshot).toMatchObject({ ok: true, status: 'read', error: null })
  expect(snapshot.text).toContain('Created fixture 1')
  expect(snapshot.text).not.toContain('nested-sensitive-value')
  expect(snapshot.text).not.toContain('nested-control-value')
  expect(Object.keys(snapshot)).not.toContain('value')
  expect(Object.keys(snapshot)).not.toContain('headers')
  expect(Object.keys(snapshot)).not.toContain('body')

  expect(
    await request({
      type: 'automation',
      requestId: 'webdriver_forbid_body_wait_0001',
      action: 'wait',
      by: 'body',
      locator: '',
      text: 'top-secret-value',
      timeoutMs: 1_000
    })
  ).toMatchObject({
    ok: false,
    status: 'rejected',
    text: null,
    error: 'forbidden-target'
  })

  for (const target of [
    { requestId: 'webdriver_forbid_body_read_0001', by: 'body', locator: '' },
    {
      requestId: 'webdriver_forbid_contenteditable_0001',
      by: 'testId',
      locator: 'webdriver-contenteditable'
    },
    {
      requestId: 'webdriver_forbid_role_textbox_0001',
      by: 'testId',
      locator: 'webdriver-role-textbox'
    },
    {
      requestId: 'webdriver_forbid_native_control_0001',
      by: 'testId',
      locator: 'webdriver-create'
    },
    {
      requestId: 'webdriver_forbid_unmarked_node_0001',
      by: 'testId',
      locator: 'webdriver-unmarked-node'
    }
  ]) {
    expect(
      await request({
        type: 'automation',
        requestId: target.requestId,
        action: 'read-safe-text',
        by: target.by,
        locator: target.locator
      })
    ).toMatchObject({
      ok: false,
      status: 'rejected',
      text: null,
      error: 'forbidden-target'
    })
  }

  for (const target of [
    { requestId: 'webdriver_forbid_password_0001', locator: 'Staging password' },
    { requestId: 'webdriver_forbid_email_0001', locator: 'Staging email' }
  ]) {
    expect(
      await request({
        type: 'automation',
        requestId: target.requestId,
        action: 'set',
        by: 'placeholder',
        locator: target.locator,
        value: 'must-not-be-written'
      })
    ).toMatchObject({
      ok: false,
      status: 'rejected',
      text: null,
      error: 'forbidden-target'
    })
  }
  await playwrightExpect(frame.getByTestId('webdriver-password')).toHaveValue('top-secret-value')
  await playwrightExpect(frame.getByTestId('webdriver-email')).toHaveValue('')
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
        await exerciseInboundValidation(loaded)
        await exerciseSharedBridge(target, loaded)
        await exerciseWebDriverAutomation(loaded)
        if (target === 'react') {
          await exerciseMotionDebugValidation(loaded)
          await exerciseFrameContextOriginPolicy(loaded)
        }
        if (target === 'vue') {
          await clearMessages(page)
          await postToPreview(loaded, { type: 'motionDebug', enabled: true })
          await playwrightExpect
            .poll(async () =>
              (await messages(page)).some(
                (message) =>
                  message.type === 'motionDebug' &&
                  message.status === 'unavailable' &&
                  message.channel === loaded?.channel
              )
            )
            .toBe(true)
          await postToPreview(loaded, { type: 'motionDebug', enabled: false })
        }
      } finally {
        await page.close()
        await loaded?.server.close()
      }
    }, 30_000)
  })
})
