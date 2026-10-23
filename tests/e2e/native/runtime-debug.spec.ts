import { strict as assert } from 'node:assert'

import {
  createNativeRuntimeDebugDocument,
  nativeRuntimeDebugObservation,
  nativeRuntimeDebugPreviewState
} from '#tests/helpers/product-workflows/runtime-debug'
import { openNativeEditorDocument } from '#tests/helpers/tauri/editor-ready'

// The embedded driver's .click() delivers a DOM click in the real WKWebView.
// Trusted physical macOS mouse/keyboard input remains a separate acceptance check.

async function debugButton(english: string, chinese: string) {
  const panel = await $('[data-property="runtime-debug"]')
  if (english === 'Close') return panel.$('button[aria-label="Close"], button[aria-label="关闭"]')
  const englishButton = await panel.$(`button=${english}`)
  return (await englishButton.isExisting()) ? englishButton : panel.$(`button=${chinese}`)
}

async function openDebug() {
  const toggle = await $('button[aria-controls="lowcode-runtime-debug"]')
  if (await toggle.isExisting()) await toggle.click()
  else {
    await $('[data-test-id="lowcode-preview-more-toggle"]').click()
    const item = await $(
      '//*[@role="menuitem" and (contains(., "Runtime debug") or contains(., "运行调试"))]'
    )
    await item.click()
  }
  await $('[data-property="runtime-debug"]').waitForDisplayed()
}

describe('native compiler runtime debug', () => {
  before(async () => {
    await openNativeEditorDocument()
    await browser.execute(createNativeRuntimeDebugDocument)
    const previewOpen = await $('[data-test-id="lowcode-preview-open"]')
    if (await previewOpen.isExisting()) await previewOpen.click()
    await browser.waitUntil(
      async () => {
        const state = await browser.execute(nativeRuntimeDebugPreviewState)
        if (state.phase === 'error' || state.phase === 'unsupported')
          throw new Error(`Native compiler preview failed (${state.phase}): ${state.diagnostics}`)
        return state.phase === 'ready'
      },
      { timeoutMsg: 'Native compiler preview did not reach ready' }
    )
  })

  it('opens and pauses runtime recording through native WebView controls', async () => {
    await openDebug()
    await (await debugButton('Pause', '暂停记录')).click()
    assert.equal(await (await debugButton('Record', '开始记录')).isExisting(), true)
    await (await debugButton('Record', '开始记录')).click()
    assert.equal(await (await debugButton('Pause', '暂停记录')).isExisting(), true)
    await (await debugButton('Close', '关闭')).click()
    await $('[data-property="runtime-debug"]').waitForExist({ reverse: true })
  })

  it('correlates real iframe actions without collecting values and clears paused history when frame access is supported', async function () {
    const preview = await browser.execute(nativeRuntimeDebugPreviewState)
    if (!preview.driverCanAccessFrame && preview.crossOriginFrame) {
      // tauri-plugin-wdio-webdriver 1.3.0 evaluates through contentWindow.eval.
      // It cannot cross the tauri://localhost -> HTTP sidecar origin boundary.
      // Physical macOS/Safari iframe interaction remains a separate acceptance gate.
      return this.skip()
    }
    await openDebug()
    try {
      const frame = await $('iframe[aria-label="lowcode preview"]')
      await browser.switchToFrame(frame)
      try {
        await $('button=Run trace').click()
        await browser.waitUntil(
          async () =>
            (await $('input[placeholder="Debug value"]').getValue()) === 'private-debug-value'
        )
      } finally {
        await browser.switchToFrame(null)
      }
      await browser.waitUntil(async () => {
        const observation = await browser.execute(nativeRuntimeDebugObservation)
        return observation.entries.some(
          (entry) => entry.kind === 'request' && entry.status === 'error'
        )
      })
      const observation = await browser.execute(nativeRuntimeDebugObservation)
      const action = observation.entries.find(
        (entry) => entry.kind === 'action' && entry.label === 'setVariable'
      )
      const request = observation.entries.find(
        (entry) => entry.kind === 'request' && entry.status === 'error'
      )
      assert.ok(action)
      assert.ok(action.trace, 'A correlated action must have a non-empty trace')
      assert.equal(request?.trace, action.trace)
      assert.equal(request?.label, 'GET')
      assert.equal(
        observation.entries.some(
          (entry) => entry.kind === 'expression' && entry.status === 'success'
        ),
        true
      )
      assert.equal(
        observation.entries.some((entry) => entry.kind === 'state' && entry.label === 'debugValue'),
        true
      )
      assert.equal(observation.text.includes('private-debug-value'), false)
      assert.equal(observation.text.includes('private-url-value'), false)
      await (await debugButton('Pause', '暂停记录')).click()
      const retained = (await browser.execute(nativeRuntimeDebugObservation)).entries.length
      await browser.switchToFrame(frame)
      try {
        await $('button=Run trace').click()
      } finally {
        await browser.switchToFrame(null)
      }
      assert.equal((await browser.execute(nativeRuntimeDebugObservation)).entries.length, retained)
      await (await debugButton('Clear', '清空')).click()
      assert.equal((await browser.execute(nativeRuntimeDebugObservation)).entries.length, 0)
    } finally {
      await browser.switchToFrame(null)
      const panel = await $('[data-property="runtime-debug"]')
      if (await panel.isExisting()) await (await debugButton('Close', '关闭')).click()
    }
  })
})
