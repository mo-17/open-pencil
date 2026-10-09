import { readFile } from 'node:fs/promises'

import { expect, test } from '@playwright/test'

import { EffectPickDriver } from '#tests/helpers/effect-pick'

test('inserts curated effects, edits exact text, plays isolated clicks and preserves config through undo/copy/save/reopen', async ({
  page
}, testInfo) => {
  test.setTimeout(90_000)
  const driver = new EffectPickDriver(page)
  await driver.open()
  const assets = await driver.assets()
  await expect(assets.locator('[data-effect-id]')).toHaveCount(32)
  await driver.insert('diagonal-fill')
  await expect
    .poll(() => driver.playgroundLayout())
    .toMatchObject({
      width: 320,
      height: 120,
      text: '开始创作',
      lineCount: 1,
      horizontalOverflow: false,
      bounded: true
    })
  expect(await driver.selectedConfig()).toMatchObject({
    artifactDigest: '6dfdbdf04cf2c573aa6e392875709c7e86609334efa324b34463215b974f0913'
  })
  await driver.resizeSelected(224, 101)
  await expect
    .poll(() => driver.playgroundLayout())
    .toMatchObject({
      width: 224,
      height: 101,
      text: '开始创作',
      lineCount: 1,
      horizontalOverflow: false,
      bounded: true
    })
  await expect(driver.frame().getByRole('button', { name: '开始创作', exact: true })).toBeVisible()
  const defaultScreenshot = testInfo.outputPath('effectpick-editor-default.png')
  await driver.playground().screenshot({ path: defaultScreenshot })
  await testInfo.attach('effectpick-editor-default', {
    path: defaultScreenshot,
    contentType: 'image/png'
  })
  await page.screenshot({ path: testInfo.outputPath('effectpick-editor-224x101.png') })
  await driver
    .playground()
    .screenshot({ path: testInfo.outputPath('effectpick-playground-224x101.png') })
  const panel = page.getByTestId('module-props-panel')
  const text = panel.getByRole('textbox', { name: 'Effect text' })
  const authoredText = '__EP_INSTANCE__ __EP_CHARACTERS__ <>& " 汉字'
  await text.fill(authoredText)
  await text.blur()
  await expect
    .poll(() => driver.selectedConfig())
    .toMatchObject({ effectId: 'diagonal-fill', text: authoredText })
  await expect(
    driver.frame().getByRole('button', { name: authoredText, exact: true })
  ).toBeVisible()
  const layout = await driver
    .frame()
    .getByRole('button', { name: authoredText, exact: true })
    .evaluate((button) => {
      const bounds = button.getBoundingClientRect()
      const range = document.createRange()
      range.selectNodeContents(button)
      return {
        buttonInsideViewport:
          bounds.left >= 0 &&
          bounds.right <= window.innerWidth &&
          bounds.top >= 0 &&
          bounds.bottom <= window.innerHeight,
        textInsideButton: [...range.getClientRects()].every(
          (rect) =>
            rect.left >= bounds.left &&
            rect.right <= bounds.right &&
            rect.top >= bounds.top &&
            rect.bottom <= bounds.bottom
        )
      }
    })
  expect(layout).toEqual({ buttonInsideViewport: true, textInsideButton: true })
  await driver.frame().getByRole('button', { name: authoredText, exact: true }).click()
  await expect(driver.playground().getByRole('status')).toHaveText(
    'Button clicks in this playground: 1.'
  )
  await expect(driver.playground()).toContainText('UNLICENSED')
  await expect(panel.getByRole('textbox', { name: 'Secondary color' })).toHaveCount(0)
  const authored = await driver.selectedConfig()
  await driver.focusCanvasToolbar()
  await driver.canvas.undo()
  await expect.poll(() => driver.selectedConfig()).not.toMatchObject({ text: authoredText })
  await driver.canvas.redo()
  await expect.poll(() => driver.selectedConfig()).toEqual(authored)
  await driver.canvas.duplicate()
  await expect.poll(() => driver.effectCount()).toBe(2)
  await expect.poll(() => driver.selectedConfig()).toEqual(authored)
  await driver.canvas.undo()
  await expect.poll(() => driver.effectCount()).toBe(1)
  await driver.focusCanvasToolbar()
  page.once('dialog', async (dialog) => {
    expect(dialog.type()).toBe('prompt')
    await dialog.accept('effectpick.fig')
  })
  const downloadEvent = page.waitForEvent('download')
  await page.keyboard.press('Meta+s')
  const download = await downloadEvent
  const path = testInfo.outputPath('effectpick.fig')
  await download.saveAs(path)
  expect(await download.failure()).toBeNull()
  await driver.reopen([...(await readFile(path))])
  await expect.poll(() => driver.selectedConfig()).toEqual(authored)
  expect(await driver.selectedSize()).toEqual({ width: 224, height: 101, childCount: 0 })
  await expect(
    driver.frame().getByRole('button', { name: authoredText, exact: true })
  ).toBeVisible()
  const screenshot = testInfo.outputPath('effectpick-editor-preview.png')
  await driver.playground().screenshot({ path: screenshot })
  await testInfo.attach('effectpick-editor-preview', { path: screenshot, contentType: 'image/png' })
  driver.canvas.assertNoErrors()
})

test('playground preserves node dimensions and paused edits while a narrow panel scales its display', async ({
  page
}, info) => {
  test.setTimeout(60_000)
  const driver = new EffectPickDriver(page)
  await driver.open()
  await driver.insert('diagonal-fill')
  await driver.resizeSelected(224, 101)
  await driver.playground().getByRole('button', { name: 'Pause effect', exact: true }).click()
  const text = page.getByTestId('module-props-panel').getByRole('textbox', { name: 'Effect text' })
  await text.fill('继续创作 Continue')
  await text.blur()
  await expect
    .poll(() => driver.playgroundLayout())
    .toMatchObject({
      width: 224,
      height: 101,
      text: '继续创作 Continue',
      bounded: true,
      paused: true
    })
  await driver.resizeSelected(320, 120)
  for (const rootFontSize of [16, 20, 24]) {
    await page.locator('html').evaluate((root, fontSize) => {
      root.style.fontSize = `${fontSize}px`
    }, rootFontSize)
    await expect
      .poll(() => driver.playgroundLayout())
      .toMatchObject({
        width: 320,
        height: 120,
        text: '继续创作 Continue',
        bounded: true,
        paused: true
      })
    const frameBounds = await page.locator('iframe[aria-label="Effect playground"]').boundingBox()
    if (!frameBounds) throw new Error('EffectPick frame is not visible')
    expect(frameBounds.width).toBeLessThanOrEqual(320)
    expect(frameBounds.width / frameBounds.height).toBeCloseTo(320 / 120, 2)
  }
  await page.locator('html').evaluate((root) => {
    root.style.fontSize = ''
  })
  await driver.resizeSelected(160, 101)
  await text.fill('长文案'.repeat(40))
  await text.blur()
  await expect
    .poll(() => driver.playgroundLayout())
    .toMatchObject({
      width: 160,
      height: 101,
      text: '长文案'.repeat(40),
      horizontalOverflow: false,
      bounded: true,
      paused: true
    })
  await driver.playground().screenshot({ path: info.outputPath('effectpick-narrow-long-text.png') })
  driver.canvas.assertNoErrors()
})

test('pause then replay resumes the animation and reduced motion pauses it', async ({ page }) => {
  test.setTimeout(45_000)
  const driver = new EffectPickDriver(page)
  await driver.open()
  await driver.insert('animated-gradient')
  const effect = driver.frame().locator('[data-effect-pick-surface]')
  await expect(effect).toBeVisible()
  const animationState = () =>
    effect.evaluate((surface) =>
      surface.getAnimations({ subtree: true }).map((animation) => animation.playState)
    )
  await expect.poll(animationState).toContain('running')
  await driver.playground().getByRole('button', { name: 'Pause effect', exact: true }).click()
  await expect.poll(animationState).toContain('paused')
  await driver.playground().getByRole('button', { name: 'Replay effect', exact: true }).click()
  await expect.poll(animationState).toContain('running')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(effect).toHaveAttribute('data-effect-pick-paused', '')
  await expect.poll(animationState).not.toContain('running')
  await driver.playground().getByRole('button', { name: 'Play effect', exact: true }).click()
  await expect.poll(animationState).not.toContain('running')
  driver.canvas.assertNoErrors()
})

test('the editor playground denies network, storage and editor bridges and ignores forged window actions', async ({
  page
}) => {
  test.setTimeout(45_000)
  const driver = new EffectPickDriver(page)
  await driver.open()
  await driver.insert('diagonal-fill')
  const button = driver.frame().getByRole('button')
  await expect(button).toBeVisible()
  const requests: string[] = []
  await page.route('https://effectpick-isolation.invalid/**', async (route) => {
    requests.push(route.request().url())
    await route.fulfill({ status: 200, body: 'unexpected network' })
  })
  const before = await driver.selectedConfig()
  const boundary = await driver
    .frame()
    .locator('body')
    .evaluate(async () => {
      let editorReachable = false,
        storageReachable = false,
        networkReachable = false
      try {
        editorReachable = 'openPencil' in window.parent
      } catch {
        editorReachable = false
      }
      try {
        // oxlint-disable-next-line open-pencil/no-direct-storage-access -- Probe that the opaque playground denies browser storage.
        localStorage.setItem('effectpick-test', 'value')
        storageReachable = true
      } catch {
        storageReachable = false
      }
      try {
        await fetch('https://effectpick-isolation.invalid/probe')
        networkReachable = true
      } catch {
        networkReachable = false
      }
      window.parent.postMessage(
        {
          source: 'op-lowcode-preview',
          channel: 'forged',
          type: 'docState',
          name: 'secret',
          value: 'forged'
        },
        '*'
      )
      window.parent.postMessage(
        {
          protocol: 'open-pencil-effect-pick-preview-v1',
          instanceId: crypto.randomUUID(),
          type: 'click'
        },
        '*'
      )
      return {
        editorReachable,
        storageReachable,
        networkReachable,
        bridgeExposed: 'openPencil' in window || '__TAURI_INTERNALS__' in window
      }
    })
  expect(boundary).toEqual({
    editorReachable: false,
    storageReachable: false,
    networkReachable: false,
    bridgeExposed: false
  })
  expect(requests).toEqual([])
  await expect(driver.playground().getByRole('status')).toHaveCount(0)
  expect(await driver.selectedConfig()).toEqual(before)
  await button.click()
  await expect(driver.playground().getByRole('status')).toHaveText(
    'Button clicks in this playground: 1.'
  )
})

test('rapid artifact swaps before readiness and stale same-frame destruction preserve the latest preview', async ({
  page
}) => {
  test.setTimeout(45_000)
  const driver = new EffectPickDriver(page)
  await driver.open()
  const lifetime = await driver.rapidPreviewReplacement()
  try {
    const frame = page.frameLocator('iframe[title="Effect lifecycle fixture"]')
    await expect(frame.getByRole('button', { name: 'Latest selected effect' })).toBeVisible()
    expect(await lifetime.evaluate((value) => value.errors)).toEqual([])
  } finally {
    await lifetime.evaluate((value) => value.remove())
    await lifetime.dispose()
  }
  await expect(page.locator('iframe[title="Effect lifecycle fixture"]')).toHaveCount(0)
  driver.canvas.assertNoErrors()
})

test('the existing browser Worker and whole opaque webpage preview run declared EffectPick state actions', async ({
  page
}, info) => {
  test.setTimeout(90_000)
  const driver = new EffectPickDriver(page)
  await driver.open()
  await driver.insert('diagonal-fill')
  await driver.resizeSelected(224, 101)
  await driver.addBrowserStateAction('开始创作')
  await page.getByTestId('lowcode-preview-refresh-policy').selectOption('realtime')
  const pane = page.getByTestId('lowcode-preview-pane')
  await expect(pane).toHaveAttribute('data-preview-host', 'browser-worker')
  await expect(pane).toHaveAttribute('data-preview-status', 'ready', { timeout: 60_000 })
  const preview = page.frameLocator('iframe[aria-label="lowcode preview"]')
  await expect(preview.getByText('Browser effect clicks: 0', { exact: true })).toBeVisible({
    timeout: 60_000
  })
  await expect(page.locator('iframe[aria-label="lowcode preview"]')).toHaveAttribute(
    'sandbox',
    'allow-scripts'
  )
  await expect(preview.locator('iframe')).toHaveCount(0)
  const button = preview.getByRole('button', { name: '开始创作', exact: true })
  await expect(button).toBeVisible()
  const layout = await button.evaluate((button) => {
    const label = button.querySelector('.fx-label')
    if (!(label instanceof HTMLElement)) throw new Error('EffectPick label is missing')
    const range = document.createRange()
    range.selectNodeContents(label)
    return {
      lines: range.getClientRects().length,
      horizontalOverflow: label.scrollWidth > label.clientWidth + 1,
      verticalOverflow: label.scrollHeight > label.clientHeight + 1
    }
  })
  expect(layout).toEqual({ lines: 1, horizontalOverflow: false, verticalOverflow: false })
  await page.screenshot({ path: info.outputPath('effectpick-editor-react-ready-224x101.png') })
  await driver
    .playground()
    .screenshot({ path: info.outputPath('effectpick-playground-react-ready-224x101.png') })
  await button.click()
  await expect(preview.getByText('Browser effect clicks: 1', { exact: true })).toBeVisible()
  await page.getByTestId('lowcode-preview-target').selectOption('vue')
  await expect(pane).toHaveAttribute('data-preview-status', 'unsupported', { timeout: 60_000 })
  await expect(pane).toContainText('Vue browser preview is not available')
  driver.canvas.assertNoErrors()
})
