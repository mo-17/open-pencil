import { readFile } from 'node:fs/promises'

import { expect, test } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'
import {
  codePaintObservation,
  openCodePaintDocument,
  codeChildObservation,
  codeParentType,
  copyCodeSource
} from '#tests/helpers/code/paint-document'

test('Code width editing, undo/redo and a real saved document retain tokens and stroke paints', async ({
  page
}) => {
  // Exercise the app's download save path rather than a native file-picker dialog.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true })
  })
  await page.goto('/')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  await openCodePaintDocument(page)
  const before = await codePaintObservation(page)
  expect(before.pluginData).toContainEqual({
    pluginId: 'foreign-plugin',
    key: 'tokens',
    value: '{"keep":"me"}'
  })
  expect(before.strokes.map((stroke) => stroke.type)).toEqual(['GRADIENT_LINEAR', 'IMAGE', 'SOLID'])

  await page.getByTestId('properties-tab-code').click()
  const input = page.locator('[data-slot="code-editor"] .cm-content')
  await expect(input).toContainText('w={100}')
  const source = await input.innerText()
  await input.fill(source.replace('w={100}', 'w={120}'))
  await expect.poll(() => codePaintObservation(page)).toEqual({ ...before, width: 120 })

  await page.getByTestId('properties-tab-design').click()
  await page.keyboard.press('Meta+z')
  await expect.poll(() => codePaintObservation(page)).toEqual(before)
  await page.keyboard.press('Meta+Shift+z')
  await expect.poll(() => codePaintObservation(page)).toEqual({ ...before, width: 120 })
  const downloaded = page.waitForEvent('download')
  await page.keyboard.press('Meta+s')
  const download = await downloaded
  const path = await download.path()
  if (!path) throw new Error('Saved FIG download missing')
  await openCodePaintDocument(page, [...(await readFile(path))])
  const reopened = await codePaintObservation(page)
  expect(reopened).toMatchObject({
    width: 120,
    pluginData: before.pluginData,
    strokes: before.strokes
  })
  await canvas.waitForRender()
  await test.info().attach('saved-code-paints', {
    body: await canvas.canvas.screenshot(),
    contentType: 'image/png'
  })
})

test('Code parent type replacement retains child tokens through undo/redo and real save/reopen', async ({
  page
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true })
  })
  await page.goto('/')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  await openCodePaintDocument(page, undefined, true)
  const child = await codeChildObservation(page)
  expect(child.pluginData).toContainEqual({
    pluginId: 'foreign-plugin',
    key: 'tokens',
    value: 'child'
  })
  await page.getByTestId('properties-tab-code').click()
  const input = page.locator('[data-slot="code-editor"] .cm-content')
  await expect(input).toContainText('<Frame')
  const source = await copyCodeSource(page)
  await input.fill(source.replace('<Frame', '<Group').replace('</Frame>', '</Group>'))
  await expect.poll(() => codeParentType(page)).toBe('GROUP')
  expect(await codeChildObservation(page)).toEqual(child)
  await page.getByTestId('properties-tab-design').click()
  await page.keyboard.press('Meta+z')
  await expect.poll(() => codeParentType(page)).toBe('FRAME')
  expect(await codeChildObservation(page)).toEqual(child)
  await page.keyboard.press('Meta+Shift+z')
  await expect.poll(() => codeParentType(page)).toBe('GROUP')
  expect(await codeChildObservation(page)).toEqual(child)
  const downloaded = page.waitForEvent('download')
  await page.keyboard.press('Meta+s')
  const path = await (await downloaded).path()
  if (!path) throw new Error('Saved FIG download missing')
  await openCodePaintDocument(page, [...(await readFile(path))])
  expect(await codeParentType(page)).toBe('GROUP')
  expect((await codeChildObservation(page)).pluginData).toEqual(child.pluginData)
})
