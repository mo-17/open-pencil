import { readFile } from 'node:fs/promises'

import type { Page } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'
import { expect, test } from '#tests/helpers/chat/fixture'

async function seedBriefPage(page: Page) {
  return page.evaluate(() => {
    const editor = window.openPencil?.getStore?.()
    if (!editor) throw new Error('OpenPencil is not initialized')
    const included = editor.graph.createNode('FRAME', editor.state.currentPageId, {
      name: 'Customer overview',
      width: 320,
      height: 180
    })
    editor.graph.createNode('TEXT', included.id, {
      name: 'Customer heading',
      text: 'Customer profile',
      width: 200,
      height: 30
    })
    editor.graph.createNode('FRAME', editor.state.currentPageId, {
      name: 'Private sibling section',
      width: 100,
      height: 80
    })
    editor.clearSelection()
    editor.requestRender()
    return included.id
  })
}

async function startBriefPage(page: Page) {
  await page.goto('/?test')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  const frameId = await seedBriefPage(page)
  return { canvas, frameId }
}

async function openWorkbenchBrief(page: Page) {
  await page.getByTestId('left-panel-assets-tab').click()
  const launcher = page.getByTestId('assets-panel').getByTestId('design-brief-open')
  await expect(launcher).toHaveAccessibleName('Design handoff')
  await launcher.click()
  const dialog = page.getByTestId('design-brief-dialog')
  await expect(dialog).toBeVisible()
  return dialog
}

test('current-page brief retains author notes across close, canvas changes and regeneration', async ({
  page
}, testInfo) => {
  const { canvas, frameId } = await startBriefPage(page)
  let dialog = await openWorkbenchBrief(page)
  const output = dialog.getByTestId('design-brief-preview')
  await expect(output).toHaveValue(/Customer overview/)
  await expect(output).toHaveValue(/Private sibling section/)
  await dialog.getByTestId('design-brief-notes').fill('Add a contact form after export.')
  await expect(output).toHaveValue(/> Add a contact form after export\./)
  const initialOutput = await output.inputValue()
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  dialog = await openWorkbenchBrief(page)
  await expect(dialog.getByTestId('design-brief-notes')).toHaveValue(
    'Add a contact form after export.'
  )
  await expect(dialog.getByTestId('design-brief-preview')).toHaveValue(initialOutput)
  await page.evaluate((id) => {
    const editor = window.openPencil.getStore()
    editor.graph.updateNode(id, { name: 'Updated customer overview' })
    editor.requestRender()
  }, frameId)
  await expect(dialog.getByTestId('design-brief-stale')).toBeVisible()
  await expect(dialog.getByTestId('design-brief-copy')).toBeDisabled()
  await expect(dialog.getByTestId('design-brief-save')).toBeDisabled()
  await expect(dialog.getByTestId('design-brief-chat')).toBeDisabled()
  await dialog.getByTestId('design-brief-refresh').click()
  await expect(dialog.getByTestId('design-brief-stale')).toBeHidden()
  await expect(dialog.getByTestId('design-brief-preview')).toHaveValue(/Updated customer overview/)
  await expect(dialog.getByTestId('design-brief-preview')).toHaveValue(
    /> Add a contact form after export\./
  )
  await expect(dialog.getByTestId('design-brief-copy')).toBeEnabled()
  await page.screenshot({ path: testInfo.outputPath('design-handoff.png') })
  canvas.assertNoErrors()
})

test('empty selection blocks transfer, then selected scope and language produce the actual Markdown download', async ({
  page
}) => {
  // Exercise the supported download path without opening an OS file picker.
  await page.addInitScript(() => {
    window.showSaveFilePicker = undefined
  })
  const { canvas, frameId } = await startBriefPage(page)
  const dialog = await openWorkbenchBrief(page)
  await dialog.getByTestId('design-brief-scope').click()
  await page.getByRole('option', { name: 'Selected content', exact: true }).click()
  await dialog.getByTestId('design-brief-refresh').click()
  await expect(dialog.getByRole('alert')).toBeVisible()
  await expect(dialog.getByTestId('design-brief-preview')).toHaveValue('')
  await expect(dialog.getByTestId('design-brief-save')).toBeDisabled()
  await page.evaluate((id) => window.openPencil.getStore().select([id]), frameId)
  await dialog.getByTestId('design-brief-language').click()
  await page.getByRole('option', { name: 'Chinese', exact: true }).click()
  await dialog.getByTestId('design-brief-notes').fill('导出后接入客户服务。')
  await dialog.getByTestId('design-brief-refresh').click()
  const output = dialog.getByTestId('design-brief-preview')
  await expect(output).toHaveValue(/^# 设计交接稿/)
  await expect(output).toHaveValue(/Customer overview/)
  await expect(output).not.toHaveValue(/Private sibling section/)
  await expect(output).toHaveValue(/> 导出后接入客户服务。/)
  const rendered = await output.inputValue()
  const downloadReady = page.waitForEvent('download')
  await dialog.getByTestId('design-brief-save').click()
  const download = await downloadReady
  expect(download.suggestedFilename()).toBe('openpencil-design-brief.md')
  const path = await download.path()
  if (!path) throw new Error('Markdown download is missing')
  expect(await readFile(path, 'utf8')).toBe(rendered)
  await expect(dialog.getByRole('status')).toBeVisible()
  canvas.assertNoErrors()
})

test('copy confirms the actual clipboard text after review', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const { canvas } = await startBriefPage(page)
  const dialog = await openWorkbenchBrief(page)
  await dialog.getByTestId('design-brief-notes').fill('Only send after review.')
  const rendered = await dialog.getByTestId('design-brief-preview').inputValue()
  await dialog.getByTestId('design-brief-copy').click()
  await expect(dialog.getByRole('status')).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(rendered)
  canvas.assertNoErrors()
})

test.describe('Chinese design handoff', () => {
  test.use({ locale: 'zh-CN' })
  test('Chinese editor labels lead to a Chinese brief by default', async ({ page }, testInfo) => {
    const { canvas } = await startBriefPage(page)
    await page.getByTestId('left-panel-assets-tab').click()
    const launcher = page.getByTestId('assets-panel').getByTestId('design-brief-open')
    await expect(launcher).toHaveAccessibleName('设计交接稿')
    await page.screenshot({ path: testInfo.outputPath('workbench-zh.png') })
    await launcher.click()
    const dialog = page.getByRole('dialog', { name: '设计交接稿', exact: true })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByTestId('design-brief-preview')).toHaveValue(/^# 设计交接稿/)
    await expect(dialog.getByTestId('design-brief-language')).toContainText('中文')
    await expect(dialog.getByRole('button', { name: '放入对话输入框', exact: true })).toBeEnabled()
    await page.screenshot({ path: testInfo.outputPath('design-handoff-zh.png') })
    canvas.assertNoErrors()
  })
})

test('a selected file write failure stays visible and cancellation does not claim success', async ({
  page
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      value: async () => ({
        createWritable: async () => ({
          write: async () => {
            throw new Error('Disk full')
          },
          close: async () => undefined
        })
      })
    })
  })
  const { canvas } = await startBriefPage(page)
  const dialog = await openWorkbenchBrief(page)
  const rendered = await dialog.getByTestId('design-brief-preview').inputValue()
  let downloads = 0
  page.on('download', () => downloads++)
  await dialog.getByTestId('design-brief-save').click()
  await expect(dialog.getByRole('alert')).toContainText('Download failed')
  await expect(dialog.getByRole('status')).toHaveCount(0)
  await expect(dialog.getByTestId('design-brief-preview')).toHaveValue(rendered)
  expect(downloads).toBe(0)
  await page.evaluate(() => {
    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      value: async () => {
        throw new DOMException('Canceled', 'AbortError')
      }
    })
  })
  await dialog.getByTestId('design-brief-save').click()
  await expect(dialog.getByTestId('design-brief-save')).toBeEnabled()
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  await expect(dialog.getByRole('status')).toHaveCount(0)
  expect(downloads).toBe(0)
  canvas.assertNoErrors()
})

test('staging a brief preserves existing AI input and never submits it', async ({
  configuredChat: chat
}) => {
  const page = chat.page
  await seedBriefPage(page)
  await chat.input.fill('Keep my existing instructions.')
  const dialog = await openWorkbenchBrief(page)
  await dialog.getByTestId('design-brief-notes').fill('Discuss options before editing.')
  const rendered = await dialog.getByTestId('design-brief-preview').inputValue()
  await dialog.getByTestId('design-brief-chat').click()
  await expect(dialog).toBeHidden()
  await expect(chat.input).toHaveValue(`Keep my existing instructions.\n\n${rendered}`)
  await expect(chat.sendButton).toBeEnabled()
  await expect(page.getByTestId('chat-message-user')).toHaveCount(0)
  await expect(page.getByTestId('chat-message-assistant')).toHaveCount(0)
  await expect(page.locator('html')).not.toHaveAttribute('data-last-chat-request', /.+/)
})

test('an unconfigured AI provider leads through Settings back to the staged brief', async ({
  chat
}) => {
  const page = chat.page
  await seedBriefPage(page)
  const dialog = await openWorkbenchBrief(page)
  const rendered = await dialog.getByTestId('design-brief-preview').inputValue()
  await dialog.getByTestId('design-brief-chat').click()
  await expect(page.getByTestId('provider-setup-open-settings')).toBeVisible()
  await expect(page.getByTestId('chat-message-user')).toHaveCount(0)
  await chat.configureOpenRouter('sk-or-design-brief-test-only')
  await expect(chat.input).toHaveValue(rendered)
  await expect(chat.sendButton).toBeEnabled()
  await expect(page.getByTestId('chat-message-user')).toHaveCount(0)
  await expect(page.locator('html')).not.toHaveAttribute('data-last-chat-request', /.+/)
})

test('a rejected clipboard write leaves the complete output available and reports the failure', async ({
  page
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async () => {
          throw new DOMException('Clipboard denied', 'NotAllowedError')
        }
      }
    })
  })
  const { canvas } = await startBriefPage(page)
  const dialog = await openWorkbenchBrief(page)
  await dialog.getByTestId('design-brief-notes').fill('Keep this note when copy fails.')
  const rendered = await dialog.getByTestId('design-brief-preview').inputValue()
  await dialog.getByTestId('design-brief-copy').click()
  await expect(dialog.getByRole('alert')).toBeVisible()
  await expect(dialog.getByTestId('design-brief-preview')).toHaveValue(rendered)
  await expect(dialog.getByTestId('design-brief-copy')).toBeEnabled()
  await expect(dialog.getByTestId('design-brief-save')).toBeEnabled()
  await expect(dialog.getByRole('status')).toHaveCount(0)
  canvas.assertNoErrors()
})
