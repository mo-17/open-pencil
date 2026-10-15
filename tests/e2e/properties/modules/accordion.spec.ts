import type { Page } from '@playwright/test'

import { expect, test } from '#tests/e2e/fixtures'
import { CanvasHelper } from '#tests/helpers/canvas'

const PLUGIN_ID = 'open-pencil.accordion'

async function expectAccordionPaint(canvas: CanvasHelper, stage: 'inserted' | 'edited') {
  await canvas.page.waitForFunction(
    () => {
      if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

      const editor = window.openPencil.getStore()
      const renderers = editor.canvasRenderers.filter(
        (renderer) =>
          renderer.tracksSceneSettlement && renderer.pageId === editor.state.currentPageId
      )
      return (
        renderers.length > 0 &&
        renderers.every(
          (renderer) =>
            renderer.sceneBacking?.sceneVersion === editor.state.sceneVersion &&
            renderer.sceneBacking.fontGeneration === renderer.fontGeneration &&
            renderer.sceneBacking.positionPreviewVersion === editor.graph.positionPreviewVersion &&
            !renderer.sceneBackingBuild &&
            !renderer.sceneBackingNeedsCrispRender &&
            (!renderer.tiledSceneEnabled ||
              (renderer.tiledSceneCovered && !renderer.tiledScenePending))
        )
      )
    },
    undefined,
    { timeout: 15000 }
  )
  await expect
    .poll(
      async () => {
        const screenshot = await canvas.screenshotCanvas()
        return canvas.page.evaluate(async (bytes) => {
          const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)]))
          const surface = new OffscreenCanvas(bitmap.width, bitmap.height)
          const context = surface.getContext('2d')
          if (!context) throw new Error('Pixel reader unavailable')
          context.drawImage(bitmap, 0, 0)
          bitmap.close()
          const { data } = context.getImageData(0, 0, surface.width, surface.height)
          let pixels = 0
          for (let i = 0; i < data.length; i += 4) {
            if (data[i] === 17 && data[i + 1] === 24 && data[i + 2] === 39) pixels++
          }
          return pixels
        }, Array.from(screenshot))
      },
      {
        timeout: 15000,
        message: 'An inserted Accordion must paint its text, not only the selection outline'
      }
    )
    .toBeGreaterThan(150)
  await canvas.canvas.screenshot({
    path: test.info().outputPath(`${stage}-accordion-current-scene.png`)
  })
  await test.info().attach(`${stage}-accordion-current-scene-state`, {
    contentType: 'application/json',
    body: JSON.stringify(
      await canvas.page.evaluate(() => {
        if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

        const editor = window.openPencil.getStore()
        return {
          version: editor.state.sceneVersion,
          node: editor.graph.getNode([...editor.state.selectedIds][0]),
          renderers: editor.canvasRenderers.map((r) => ({
            sceneVersion: r.sceneBacking?.sceneVersion,
            fontGeneration: r.fontGeneration,
            backingFontGeneration: r.sceneBacking?.fontGeneration,
            tracksSceneSettlement: r.tracksSceneSettlement,
            tiled: r.tiledSceneEnabled,
            covered: r.tiledSceneCovered,
            pending: r.tiledScenePending,
            fontsLoaded: r.fontsLoaded,
            pendingFonts: [...r.pendingFontNodes.keys()]
          }))
        }
      }),
      null,
      2
    )
  })
}

async function insertAccordion(page: Page, renderer: 'retained' | 'tiled') {
  await page.goto(`/?test&renderer=${renderer}`)
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  await page.getByTestId('app-settings-trigger').click()
  await page.getByTestId('settings-section-plugins').click()
  await page.getByTestId('settings-plugins-view').getByText('Browse', { exact: true }).click()
  await page.getByTestId('plugin-discover-search').fill('Accordion')
  await page.getByTestId(`plugin-install-${PLUGIN_ID}`).click()
  await expect(page.getByTestId(`plugin-installed-${PLUGIN_ID}`)).toBeVisible()
  await page.getByTestId(`plugin-enabled-${PLUGIN_ID}`).click()
  await expect(page.getByTestId(`plugin-enabled-${PLUGIN_ID}`)).toBeChecked()
  await page.getByTestId('app-settings-done').click()
  await page.getByTestId('toolbar-plugin-modules').click()
  await page.getByTestId(`toolbar-plugin-module-${PLUGIN_ID}-accordion`).click()
  await expect(page.getByTestId('accordion-item-row')).toHaveCount(3)
  await expectAccordionPaint(canvas, 'inserted')
  return canvas
}

async function savedModule(page: Page) {
  return page.evaluate(async () => {
    const { readModuleInstance } = await import('/packages/scene-graph/src/module.ts')

    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

    const editor = window.openPencil.getStore()
    const node = editor.graph.getNode([...editor.state.selectedIds][0])
    const module = readModuleInstance(node?.interactiveProps?.module)
    if (!module) throw new Error('Selected accordion unavailable')
    return module
  })
}

test.use({ viewport: { width: 1600, height: 1100 } })

for (const renderer of ['retained', 'tiled'] as const) {
  test(`${renderer}: Accordion edits initial-open items, reorder, single mode and undo without JSON`, async ({
    page
  }, info) => {
    test.setTimeout(90_000)
    const canvas = await insertAccordion(page, renderer)
    const rows = page.getByTestId('accordion-item-row')
    await expect(page.locator('[data-module-path="initialOpenIds"]')).toHaveCount(0)
    await expect(rows.nth(0).getByTestId('accordion-initial-open')).toBeChecked()
    await rows.nth(0).getByTestId('accordion-item-id').fill('intro')
    await rows.nth(0).getByTestId('accordion-item-id').blur()
    expect((await savedModule(page)).config.initialOpenIds).toEqual(['intro'])
    await rows.nth(0).getByTestId('accordion-item-title').fill('Getting started')
    await rows.nth(0).getByTestId('accordion-item-title').blur()
    await rows.nth(0).getByTestId('accordion-move-down').click()
    await expect(rows.nth(1).getByTestId('accordion-item-title')).toHaveValue('Getting started')
    await expect(rows.nth(1).getByTestId('accordion-initial-open')).toBeChecked()
    await page.getByTestId('accordion-allow-multiple').check()
    await rows.nth(2).getByTestId('accordion-initial-open').check()
    expect((await savedModule(page)).config.initialOpenIds).toEqual(['intro', 'third'])
    await page.getByTestId('accordion-allow-multiple').uncheck()
    await expect(page.getByTestId('accordion-allow-multiple')).not.toBeChecked()
    expect((await savedModule(page)).config.initialOpenIds).toEqual(['intro'])
    await rows.nth(2).getByTestId('accordion-initial-open').check()
    await expect(rows.nth(1).getByTestId('accordion-initial-open')).not.toBeChecked()
    expect((await savedModule(page)).config.initialOpenIds).toEqual(['third'])
    await rows.nth(2).getByTestId('accordion-remove-item').click()
    await expect(rows).toHaveCount(2)
    expect((await savedModule(page)).config.initialOpenIds).toEqual([])
    await page.getByTestId('toolbar').getByRole('button').first().focus()
    await canvas.undo()
    await expect(rows).toHaveCount(3)
    await expect(rows.nth(2).getByTestId('accordion-initial-open')).toBeChecked()
    await page.getByTestId('accordion-add-item').click()
    await expect(rows).toHaveCount(4)
    await expect(rows.nth(3).getByTestId('accordion-initial-open')).not.toBeChecked()
    await rows
      .nth(3)
      .getByTestId('accordion-item-content')
      .fill('Plain text, including <b>tags</b>.')
    await rows.nth(3).getByTestId('accordion-item-content').blur()
    expect((await savedModule(page)).configVersion).toBe(1)
    await expectAccordionPaint(canvas, 'edited')
    await page.screenshot({ path: info.outputPath(`${renderer}-accordion-editor.png`) })
    canvas.assertNoErrors()
  })

  test(`${renderer}: invalid Accordion drafts are recoverable and late events cannot modify another node`, async ({
    page
  }, info) => {
    test.setTimeout(90_000)
    const canvas = await insertAccordion(page, renderer)
    const rows = page.getByTestId('accordion-item-row')
    const original = await savedModule(page)
    await rows.nth(0).getByTestId('accordion-item-id').fill('second')
    await rows.nth(0).getByTestId('accordion-item-id').blur()
    await expect(page.getByTestId('accordion-draft-error')).toBeVisible()
    expect(await savedModule(page)).toEqual(original)
    await page.getByTestId('accordion-restore').click()
    await expect(rows.nth(0).getByTestId('accordion-item-id')).toHaveValue('first')
    await expect(page.getByTestId('accordion-draft-error')).toHaveCount(0)
    await page.getByTestId('toolbar').getByRole('button').first().focus()
    await canvas.duplicate()
    const title = rows.nth(0).getByTestId('accordion-item-title')
    const handle = await title.elementHandle()
    if (!handle) throw new Error('Accordion title unavailable')
    await title.fill('Uncommitted for previous node')
    const before = await page.evaluate(async () => {
      const { readModuleInstance } = await import('/packages/scene-graph/src/module.ts')

      if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

      const editor = window.openPencil.getStore()
      const current = [...editor.state.selectedIds][0]
      const other = editor.graph
        .getChildren(editor.state.currentPageId)
        .find(
          (node) =>
            node.id !== current &&
            readModuleInstance(node.interactiveProps?.module)?.pluginId === 'open-pencil.accordion'
        )
      if (!other) throw new Error('Second accordion unavailable')
      const saved = JSON.stringify(other.interactiveProps)
      editor.select([other.id])
      return saved
    })
    // Keep a handle to the detached input to reproduce a delayed native change/blur.
    await handle.evaluate((element) => {
      element.dispatchEvent(new Event('change', { bubbles: true }))
      element.dispatchEvent(new FocusEvent('blur', { bubbles: true }))
    })
    await expect(rows.nth(0).getByTestId('accordion-item-title')).toHaveValue('First section')
    const after = await page.evaluate(() => {
      if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

      const editor = window.openPencil.getStore()
      return JSON.stringify(
        editor.graph.getNode([...editor.state.selectedIds][0])?.interactiveProps
      )
    })
    expect(after).toBe(before)
    await page.screenshot({ path: info.outputPath(`${renderer}-accordion-late-event.png`) })
    canvas.assertNoErrors()
  })
}
