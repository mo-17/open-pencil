import { expect, test } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

test('built-in AI catalog creates functional notes in the live editor', async ({ page }, info) => {
  test.setTimeout(60_000)
  await page.route('http://127.0.0.1:7600/health', (route) =>
    route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
  )
  const canvas = new CanvasHelper(page)
  await page.goto('/')
  await canvas.waitForInit()
  const result = await page.evaluate(async () => {
    const editor = window.openPencil?.getStore?.()
    if (!editor) throw new Error('Editor unavailable')
    const toolsURL = new URL('/src/app/ai/tools/index.ts', window.location.origin).href
    const { createAITools } = await import(/* @vite-ignore */ toolsURL)
    const tools = createAITools(editor)
    const tool = tools.create_personal_notes_app
    if (!tool?.execute) throw new Error('Notes tool unavailable in built-in AI catalog')
    const created = await tool.execute({ authentication: 'local-keycloak' })
    if (created.status !== 'created') throw new Error('Notes creation failed')
    await editor.switchPage(created.notesPageId)
    editor.zoomToFit()
    const nodes = [...editor.graph.getAllNodes()]
    return {
      ...created,
      saveButtonId: nodes.find((node) => node.type === 'BUTTON' && node.name === 'Save note')?.id,
      actions: nodes.flatMap((node) => Object.values(node.events ?? {}).flat()),
      content: nodes.find((node) => node.type === 'TEXTAREA' && node.name === 'content'),
      buttons: nodes.filter((node) => node.type === 'BUTTON').map((node) => node.interactiveProps)
    }
  })
  expect(result.status).toBe('created')
  expect(result.authentication.issuer).toBe('http://127.0.0.1:18080/realms/openpencil')
  expect(result.exportPageIds).toHaveLength(2)
  expect(result.content?.height).toBeGreaterThan(100)
  expect(result.content?.bindings?.value?.kind).toBe('ref')
  expect(result.buttons).toContainEqual(expect.objectContaining({ text: 'Save note' }))
  expect(result.actions).toContainEqual(
    expect.objectContaining({ kind: 'backendAuth', operation: 'signIn' })
  )
  // Retained first paints can span many frames. Two requestAnimationFrames do not prove that
  // anything beyond the page-color placeholder has actually reached the scene surface.
  await page.waitForFunction(
    () => {
      const editor = window.openPencil?.getStore?.()
      if (!editor) return false
      return editor.canvasRenderers.some((renderer) => {
        const backing = renderer.sceneBacking
        return (
          backing !== null &&
          renderer.sceneBackingBuild === null &&
          !renderer.sceneBackingNeedsCrispRender &&
          backing.pageId === editor.state.currentPageId &&
          backing.sceneVersion === editor.state.sceneVersion &&
          backing.fontGeneration === renderer.fontGeneration &&
          Math.abs(backing.zoom - editor.state.zoom) < 0.0001
        )
      })
    },
    undefined,
    { timeout: 30_000 }
  )
  const buttonClip = await page.evaluate((buttonId) => {
    const editor = window.openPencil?.getStore?.()
    const surface = document.querySelector<HTMLCanvasElement>(
      '[data-test-id="scene-canvas-element"]'
    )
    const button = buttonId && editor?.graph.getNode(buttonId)
    if (!editor || !surface || !button) throw new Error('The visible Save note control is missing')
    const frame = editor.graph.getChildren(editor.state.currentPageId)[0]
    const { panX, panY, zoom } = editor.state
    if (
      !frame ||
      panX + frame.x * zoom < 0 ||
      panY + frame.y * zoom < 0 ||
      panX + (frame.x + frame.width) * zoom > surface.clientWidth ||
      panY + (frame.y + frame.height) * zoom > surface.clientHeight
    )
      throw new Error('Zoom to fit did not fit the notes frame inside the actual canvas')
    const position = editor.graph.getAbsolutePosition(button.id)
    const bounds = surface.getBoundingClientRect()
    return {
      x: bounds.x + panX + position.x * zoom + 2,
      y: bounds.y + panY + position.y * zoom + 2,
      width: button.width * zoom - 4,
      height: button.height * zoom - 4
    }
  }, result.saveButtonId)
  const buttonImage = await page.screenshot({ clip: buttonClip })
  const bluePixelRatio = await page.evaluate(async (encoded) => {
    const image = new Image()
    image.src = 'data:image/png;base64,' + encoded
    await image.decode()
    const sample = document.createElement('canvas')
    sample.width = image.width
    sample.height = image.height
    const context = sample.getContext('2d')
    if (!context) throw new Error('Screenshot pixel inspection is unavailable')
    context.drawImage(image, 0, 0)
    const pixels = context.getImageData(0, 0, image.width, image.height).data
    let blue = 0
    for (let index = 0; index < pixels.length; index += 4) {
      if (
        pixels[index + 2] > 150 &&
        pixels[index + 2] - pixels[index] > 70 &&
        pixels[index + 2] - pixels[index + 1] > 40
      )
        blue++
    }
    return blue / (image.width * image.height)
  }, buttonImage.toString('base64'))
  expect(bluePixelRatio).toBeGreaterThan(0.6)
  canvas.assertNoErrors()
  await page.screenshot({ path: info.outputPath('ai-notes-editor.png'), fullPage: true })
})
