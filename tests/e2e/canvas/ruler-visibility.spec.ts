import { expect, test } from '#tests/e2e/fixtures'
import { CanvasHelper } from '#tests/helpers/canvas'

for (const suppressed of [false, true]) {
  test(`ruler menu changes rendered visibility with no-rulers=${suppressed}`, async ({ page }) => {
    await page.goto(suppressed ? '/?test&no-rulers' : '/?test')
    const canvas = new CanvasHelper(page)
    await canvas.waitForInit()
    await page.mouse.move(0, 0)
    async function captureCanvasRegion() {
      const box = await canvas.canvas.boundingBox()
      if (!box) throw new Error('Canvas is not visible')
      return canvas.screenshotCanvasRegion(Math.min(900, box.width), Math.min(700, box.height))
    }
    const initial = await captureCanvasRegion()

    async function toggleRulers() {
      await page.getByRole('button', { name: '100%', exact: true }).click()
      await page.getByRole('menuitem', { name: /^Rulers\b/ }).click()
      await page.keyboard.press('Escape')
      await page.mouse.move(0, 0)
      await canvas.waitForRender()
    }

    await toggleRulers()
    const hidden = await captureCanvasRegion()
    expect(hidden.equals(initial)).toBe(suppressed)
    await toggleRulers()
    expect((await captureCanvasRegion()).equals(initial)).toBe(true)
    canvas.assertNoErrors()
  })
}
