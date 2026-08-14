import type { Page } from '@playwright/test'

import { expect, test } from '#tests/e2e/fixtures'

const AI_POPOUT_PLUGIN_ID = 'open-pencil.ai-popout'

type AIWindowCommand = 'open_ai_window' | 'close_ai_window'

interface AIWindowInvocation {
  command: AIWindowCommand
  request?: {
    envelope: string
    controls: {
      toolbar: boolean
      focusEditor: boolean
      alwaysOnTop: boolean
      clearChat: boolean
      settings: boolean
    }
  }
  action?: 'created' | 'focused'
}

interface AIPopoutTestState {
  invocations: AIWindowInvocation[]
  createdWindows: number
  windowOpen: boolean
}

interface TauriInternals {
  metadata: {
    currentWindow: { label: string }
    currentWebview: { windowLabel: string; label: string }
  }
  callbacks: Map<number, (value: unknown) => void>
  invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>
  runCallback: (id: number, value: unknown) => void
  transformCallback: (callback: (value: unknown) => void) => number
  unregisterCallback: (id: number) => void
}

type AIPopoutTestWindow = Window & {
  __OP_AI_POPOUT_TEST__?: AIPopoutTestState
  __TAURI_INTERNALS__?: TauriInternals
  __TAURI_EVENT_PLUGIN_INTERNALS__?: {
    unregisterListener: (event: string, eventId: number) => void
  }
}

async function installAIPopoutTauriMock(page: Page): Promise<void> {
  // A long-lived local Vite server can retain an obsolete optimized-dependency
  // URL between worktree edits. Keep this Tauri-only boundary deterministic by
  // serving the tiny event API surface used by the popout session itself.
  await page.route(/\/node_modules\/\.vite\/deps\/@tauri-apps_api_event\.js(?:\?.*)?$/, (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `
export async function listen(event, handler) {
  const internals = window.__TAURI_INTERNALS__
  const callbackId = internals.transformCallback(handler)
  const eventId = await internals.invoke('plugin:event|listen', {
    event,
    target: { kind: 'Any' },
    handler: callbackId
  })
  return async () => {
    await internals.invoke('plugin:event|unlisten', { event, eventId })
    internals.unregisterCallback(callbackId)
  }
}
`
    })
  )
  await page.addInitScript(() => {
    const tauriWindow = window as AIPopoutTestWindow
    const state: AIPopoutTestState = {
      invocations: [],
      createdWindows: 0,
      windowOpen: false
    }
    tauriWindow.__OP_AI_POPOUT_TEST__ = state

    const callbacks = new Map<number, (value: unknown) => void>()
    const eventListeners = new Map<number, { event: string; callbackId: number }>()
    let nextCallbackId = 1
    let nextEventId = 1

    const runCallback = (id: number, value: unknown): void => {
      callbacks.get(id)?.(value)
    }
    const emitTauriEvent = (event: string, payload: unknown): void => {
      for (const [eventId, listener] of eventListeners) {
        if (listener.event !== event) continue
        runCallback(listener.callbackId, { event, id: eventId, payload })
      }
    }

    tauriWindow.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener(_event, eventId) {
        const listener = eventListeners.get(eventId)
        if (listener) callbacks.delete(listener.callbackId)
        eventListeners.delete(eventId)
      }
    }
    tauriWindow.__TAURI_INTERNALS__ = {
      metadata: {
        currentWindow: { label: 'main' },
        currentWebview: { windowLabel: 'main', label: 'main' }
      },
      callbacks,
      transformCallback(callback) {
        const id = nextCallbackId++
        callbacks.set(id, callback)
        return id
      },
      unregisterCallback(id) {
        callbacks.delete(id)
      },
      runCallback,
      async invoke(command, args) {
        if (command === 'open_ai_window') {
          const request = args?.request as AIWindowInvocation['request']
          if (!request) throw new Error('Missing AI window request')
          const action = state.windowOpen ? 'focused' : 'created'
          if (!state.windowOpen) state.createdWindows++
          state.windowOpen = true
          state.invocations.push({ command, request, action })
          return { label: 'ai-chat-popout', action }
        }
        if (command === 'close_ai_window') {
          const wasOpen = state.windowOpen
          state.windowOpen = false
          state.invocations.push({ command })
          if (wasOpen) {
            emitTauriEvent('ai-window-destroyed', { label: 'ai-chat-popout' })
          }
          return wasOpen
        }
        if (command === 'plugin:event|listen') {
          const event = args?.event
          const callbackId = args?.handler
          if (typeof event !== 'string' || typeof callbackId !== 'number') {
            throw new TypeError('Invalid Tauri event listener')
          }
          const eventId = nextEventId++
          eventListeners.set(eventId, { event, callbackId })
          return eventId
        }
        if (command === 'plugin:event|unlisten') {
          const eventId = args?.eventId
          if (typeof eventId === 'number') eventListeners.delete(eventId)
          return null
        }
        if (command === 'list_system_fonts' || command === 'take_pending_open') return []
        return null
      }
    }
  })
}

function readAIPopoutState(page: Page): Promise<AIPopoutTestState> {
  return page.evaluate(() => {
    const state = (window as AIPopoutTestWindow).__OP_AI_POPOUT_TEST__
    if (!state) throw new Error('AI popout Tauri mock was not installed')
    return state
  })
}

async function openInstalledPlugins(page: Page): Promise<void> {
  await page.getByTestId('app-settings-trigger').click()
  await page.getByTestId('settings-section-plugins').click()
  await expect(page.getByTestId('settings-plugins-panel')).toBeVisible()
  await page.getByTestId('settings-plugins-view').getByText('Installed', { exact: true }).click()
}

test('AI popout opens once, focuses on reuse, and closes behind its plugin gate', async ({
  page
}) => {
  await installAIPopoutTauriMock(page)
  await page.goto('/?test')
  await page
    .getByTestId('canvas-element')
    .and(page.locator('[data-ready="1"]'))
    .waitFor({ timeout: 30_000 })
  await page.getByTestId('canvas-loading').waitFor({ state: 'hidden', timeout: 30_000 })
  await page.locator('#loader').waitFor({ state: 'detached', timeout: 30_000 })

  await page.getByTestId('properties-tab-ai').click()
  const chatPanel = page.getByTestId('chat-panel')
  const popout = page.getByTestId('ai-popout-toggle')
  await expect(chatPanel).toBeVisible()
  await expect(popout).toBeVisible()

  await popout.click()
  await expect(popout).toHaveAttribute('aria-pressed', 'true')
  await expect
    .poll(() => readAIPopoutState(page))
    .toMatchObject({
      createdWindows: 1,
      windowOpen: true,
      invocations: [{ command: 'open_ai_window', action: 'created' }]
    })

  const first = await readAIPopoutState(page)
  const firstRequest = first.invocations[0]?.request
  expect(firstRequest?.controls).toEqual({
    toolbar: true,
    focusEditor: true,
    alwaysOnTop: false,
    clearChat: true,
    settings: true
  })
  expect(firstRequest?.envelope).toMatch(/^[A-Za-z0-9+/]+={0,2}$/)

  await popout.click()
  await expect
    .poll(() => readAIPopoutState(page))
    .toMatchObject({
      createdWindows: 1,
      windowOpen: true,
      invocations: [
        { command: 'open_ai_window', action: 'created' },
        { command: 'open_ai_window', action: 'focused' }
      ]
    })

  await openInstalledPlugins(page)
  const pluginSwitch = page.getByTestId(`plugin-enabled-${AI_POPOUT_PLUGIN_ID}`)
  await expect(pluginSwitch).toBeChecked()
  await pluginSwitch.click()
  await expect(pluginSwitch).not.toBeChecked()
  await expect(popout).toHaveCount(0)
  await expect
    .poll(() => readAIPopoutState(page))
    .toMatchObject({
      createdWindows: 1,
      windowOpen: false,
      invocations: [
        { command: 'open_ai_window', action: 'created' },
        { command: 'open_ai_window', action: 'focused' },
        { command: 'close_ai_window' }
      ]
    })

  await page.getByTestId('app-settings-done').click()
  await expect(chatPanel).toBeVisible()
})
