import { expect, test } from '#tests/e2e/fixtures'
import { EffectPickDriver } from '#tests/helpers/effect-pick'

test.use({ viewport: { width: 1440, height: 1000 } })

for (const renderer of ['retained', 'tiled'] as const) {
  test(`${renderer}: EffectPick static previews show authored text and colors without adding nodes`, async ({
    page
  }, info) => {
    test.setTimeout(90_000)
    const driver = new EffectPickDriver(page)
    const ids = await driver.openCanvasFixture(renderer)
    const initial = await driver.canvasImage(ids.root)
    expect(initial.after).toEqual(initial.before)
    expect(initial.before).toHaveLength(6)
    expect(initial.before.every((node) => node.childIds.length === 0)).toBe(true)
    expect(Buffer.from(initial.image)).toMatchSnapshot('effect-pick-static.png', {
      maxDiffPixels: 0,
      threshold: 0.2
    })
    await driver.canvas.canvas.screenshot({
      path: info.outputPath(`${renderer}-effect-pick-live.png`)
    })
    await expect(driver.canvas.canvas).toHaveScreenshot(`${renderer}-effect-pick-live.png`)
    await driver.updateCanvasFixture(ids)
    const updated = await driver.canvasImage(ids.root)
    expect(updated.after).toEqual(updated.before)
    expect(updated.image).not.toEqual(initial.image)
    expect(Buffer.from(updated.image)).toMatchSnapshot('effect-pick-updated.png', {
      maxDiffPixels: 0,
      threshold: 0.2
    })
    await driver.canvas.canvas.screenshot({
      path: info.outputPath(`${renderer}-effect-pick-live-updated.png`)
    })
    await expect(driver.canvas.canvas).toHaveScreenshot(`${renderer}-effect-pick-live-updated.png`)
    driver.canvas.assertNoErrors()
  })
}
