import { expect, test } from '#tests/e2e/fixtures'
import { closeBackendPreviewIfOpen, openBackendLibrary } from '#tests/helpers/backend-library'
import { CanvasHelper } from '#tests/helpers/canvas'
import { publishingCases } from '#tests/helpers/compiler/business/publishing/helpers'

for (const fixture of publishingCases) {
  test(`creates ${fixture.kind} pages with role review and atomic undo and redo`, async ({
    page
  }, info) => {
    test.setTimeout(90_000)
    await page.goto('/?test&navigation-benchmark')
    const canvas = new CanvasHelper(page)
    await canvas.waitForInit()
    const settle = () =>
      page.evaluate(async () => {
        const navigation = window.openPencil?.test?.navigation
        if (!navigation) throw new Error('Canvas settlement hook not initialized')
        await navigation.waitForSettlement()
      })
    const library = await openBackendLibrary(page)
    await library.getByRole('button', { name: fixture.title, exact: true }).click()
    const details = library.getByRole('region', { name: fixture.title, exact: true })
    for (const role of fixture.roles) await expect(details).toContainText(role)
    for (const title of fixture.pageTitles) await expect(details).toContainText(title)
    await expect(details).toContainText('Creation does not grant roles, start services')
    await page.screenshot({ path: info.outputPath('publishing-template-requirements.png') })
    await library.getByRole('button', { name: 'Use template', exact: true }).click()
    await expect(library).toBeHidden()
    await closeBackendPreviewIfOpen(page)
    const pages = page.getByTestId('pages-panel').getByTestId('pages-item')
    await expect(pages).toHaveCount(fixture.pageTitles.length + 1)
    for (const title of fixture.pageTitles)
      await expect(pages.getByText(title, { exact: true })).toBeVisible()
    await settle()
    await canvas.canvas.click({ position: { x: 10, y: 10 } })
    await canvas.undo()
    await expect(pages).toHaveCount(1)
    await canvas.redo()
    await expect(pages).toHaveCount(fixture.pageTitles.length + 1)
    for (const title of fixture.pageTitles)
      await expect(pages.getByText(title, { exact: true })).toBeVisible()
    await settle()
    await page.screenshot({ path: info.outputPath('publishing-template-restored.png') })
    canvas.assertNoErrors()
  })
}
