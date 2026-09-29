import { readFileSync, writeFileSync } from 'node:fs'

import { expect, test } from '#tests/e2e/fixtures'
import { openComponentGallery } from '#tests/helpers/compiler/components/templates/editor'

test.use({ viewport: { width: 1440, height: 1000 } })

for (const renderer of ['retained', 'tiled'] as const) {
  test(`${renderer}: opening a FIG shows editable modal inputs before any mutation`, async ({
    page
  }, info) => {
    test.setTimeout(90_000)
    const { canvas, path, bytes: original } = await openComponentGallery(page, info, renderer)
    const ids = await page.evaluate(async () => {
      const editor = window.openPencil.getStore()
      const root = editor.graph
        .getChildren(editor.state.currentPageId)
        .find((node) => node.name === '可编辑弹窗表单')
      const modal =
        root &&
        editor.graph
          .getChildren(root.id)
          .find((node) => node.interactiveProps?.module?.pluginId === 'open-pencil.modal')
      const body = modal && editor.graph.getChildren(modal.id).find((node) => node.type === 'FORM')
      if (!root || !modal || !body) throw new Error('Modal form fixture unavailable')
      await editor.loadFontsForNodes([root.id])
      editor.select([modal.id])
      editor.zoomToBounds(root.x, root.y, root.x + root.width, root.y + root.height)
      return {
        modal: modal.id,
        body: body.id,
        triggerWidth: modal.width,
        triggerHeight: modal.height
      }
    })
    await page.getByTestId('modal-edit-content').click()
    await expect(page.getByTestId('content-edit-banner')).toBeVisible()
    await page.evaluate(async () => {
      // Content editing paints a live scene; ordinary tiled-page coverage is not used.
      await new Promise<void>((done) => {
        requestAnimationFrame(() => requestAnimationFrame(() => done()))
      })
    })
    const controls = await page.evaluate(({ body }) => {
      const editor = window.openPencil.getStore()
      const nodes = [...editor.graph.getAllNodes()].filter((node) => {
        if (node.type !== 'INPUT' && node.type !== 'BUTTON') return false
        let ancestor = node.parentId ? editor.graph.getNode(node.parentId) : undefined
        while (ancestor) {
          if (ancestor.id === body) return true
          ancestor = ancestor.parentId ? editor.graph.getNode(ancestor.parentId) : undefined
        }
        return false
      })
      return nodes.map((node) => {
        const position = editor.graph.getAbsolutePosition(node.id)
        return {
          id: node.id,
          type: node.type,
          width: node.width,
          height: node.height,
          parentWidth: node.parentId ? editor.graph.getNode(node.parentId)?.width : undefined,
          x: (position.x + 12) * editor.state.zoom + editor.state.panX,
          y: (position.y + node.height / 2) * editor.state.zoom + editor.state.panY
        }
      })
    }, ids)
    const screenshot = await canvas.canvas.screenshot({
      path: info.outputPath('modal-content-canvas.png')
    })
    await page.screenshot({ path: info.outputPath('modal-content-editor.png') })
    writeFileSync(info.outputPath('controls.json'), JSON.stringify(controls, null, 2))
    expect(controls.map((control) => control.type)).toEqual(['INPUT', 'INPUT', 'BUTTON'])
    for (const control of controls) {
      expect(control.width).toBeGreaterThan(200)
      expect(control.height).toBeGreaterThanOrEqual(40)
      expect(control.parentWidth).toBeGreaterThanOrEqual(control.width)
    }
    const colors = await page.evaluate(
      async ({ bytes, controls }) => {
        const area = document.querySelector('[data-test-id="canvas-area"]')?.getBoundingClientRect()
        if (!area) throw new Error('Canvas area unavailable')
        const image = await createImageBitmap(
          new Blob([new Uint8Array(bytes)], { type: 'image/png' })
        )
        const sample = document.createElement('canvas')
        sample.width = image.width
        sample.height = image.height
        const context = sample.getContext('2d')
        if (!context) throw new Error('Pixel reader unavailable')
        context.drawImage(image, 0, 0)
        image.close()
        return controls.map((control) =>
          Array.from(
            context.getImageData(
              Math.floor((control.x * sample.width) / area.width),
              Math.floor((control.y * sample.height) / area.height),
              1,
              1
            ).data
          )
        )
      },
      { bytes: Array.from(screenshot), controls }
    )
    expect(colors[0].slice(0, 3)).toEqual([255, 255, 255])
    expect(colors[1].slice(0, 3)).toEqual([255, 255, 255])
    expect(colors[2][2]).toBeGreaterThan(150)
    expect(colors[2][0]).toBeLessThan(80)
    await page.getByTestId('modal-finish-content').click()
    expect(
      await page.evaluate(({ modal }) => {
        const node = window.openPencil.getStore().graph.getNode(modal)
        return [node?.width, node?.height]
      }, ids)
    ).toEqual([ids.triggerWidth, ids.triggerHeight])
    expect(readFileSync(path)).toEqual(original)
    canvas.assertNoErrors()
  })
}
