import { expect, test } from '#tests/e2e/fixtures'
import { CanvasHelper } from '#tests/helpers/canvas'
import { waitForExpansionPaint } from '#tests/helpers/plugins/component-expansion'

test.setTimeout(120_000)
test.use({ viewport: { width: 1600, height: 1100 } })

for (const renderer of ['retained', 'tiled'] as const)
  for (const module of ['chart', 'data-grid'] as const)
    test(`${renderer}: ${module} data inspector reads state, follows history and invalidates Canvas`, async ({
      page
    }, info) => {
      await page.goto(`/?test&no-rulers&renderer=${renderer}`)
      const canvas = new CanvasHelper(page)
      await canvas.waitForInit()
      await page.getByTestId('app-settings-trigger').click()
      await page.getByTestId('settings-section-plugins').click()
      await page.getByTestId('settings-plugins-view').getByText('Browse', { exact: true }).click()
      await page
        .getByTestId('plugin-discover-search')
        .fill(module === 'chart' ? 'Chart' : 'Data Grid')
      await page.getByTestId(`plugin-install-open-pencil.${module}`).click()
      await expect(page.getByTestId(`plugin-installed-open-pencil.${module}`)).toBeVisible()
      await page.getByTestId(`plugin-enabled-open-pencil.${module}`).click()
      await page.getByTestId('app-settings-done').click()
      await page.evaluate((kind) => {
        const editor = window.openPencil.getStore()
        const type = kind === 'chart' ? 'object' : 'array'
        const value =
          kind === 'chart'
            ? { values: [7, 3], labels: ['Page A', 'Page B'] }
            : [{ id: 'bound', cells: ['Bound row', 'Active', 42] }]
        const docValue =
          kind === 'chart'
            ? { values: [2, 8], labels: ['文档甲', '文档乙'] }
            : [{ id: 'document', cells: ['文档行', 'Pending', 17] }]
        editor.updateNode(editor.state.currentPageId, {
          state: [
            { id: 'data', name: 'dataSource', type, defaultValue: value },
            {
              id: 'computed',
              name: 'computedSource',
              type,
              defaultValue: value,
              computedExpr: 'dataSource'
            }
          ]
        })
        editor.updateNode(editor.graph.rootId, {
          lowcodeDocumentState: [
            { id: 'doc', name: 'documentSource', type, defaultValue: docValue }
          ]
        })
      }, module)
      await page.getByTestId('toolbar-plugin-modules').click()
      await page.getByTestId(`toolbar-plugin-module-open-pencil.${module}-${module}`).click()
      const binding = page.locator('[data-property="module-data-bindings"]').getByRole('combobox')
      await expect(binding).toContainText('Configured data')
      await binding.click()
      await expect(
        page.getByRole('option', { name: 'Bind to: computedSource', exact: true })
      ).toBeVisible()
      await page.getByRole('option', { name: 'Bind to: dataSource', exact: true }).click()
      await expect(binding).toContainText('dataSource')
      await waitForExpansionPaint(canvas, module === 'chart' ? [51, 65, 85] : undefined)
      const boundImage = await canvas.canvas.screenshot({
        path: info.outputPath(`${renderer}-${module}-page.png`)
      })
      await page.getByTestId('toolbar').getByRole('button').first().focus()
      await canvas.undo()
      await expect(binding).toContainText('Configured data')
      await canvas.redo()
      await expect(binding).toContainText('dataSource')
      await binding.click()
      await page.getByRole('option', { name: /documentSource/ }).click()
      await expect(binding).toContainText('documentSource')
      await waitForExpansionPaint(canvas, module === 'chart' ? [51, 65, 85] : undefined)
      const docImage = await canvas.canvas.screenshot({
        path: info.outputPath(`${renderer}-${module}-document.png`)
      })
      expect(docImage.equals(boundImage)).toBe(false)
      await page.evaluate((kind) => {
        const editor = window.openPencil.getStore()
        editor.updateNode(editor.graph.rootId, {
          lowcodeDocumentState: [
            {
              id: 'doc',
              name: 'documentSource',
              type: kind === 'chart' ? 'object' : 'array',
              defaultValue:
                kind === 'chart'
                  ? { values: ['bad'], labels: ['bad'] }
                  : [{ id: 'broken', cells: [] }]
            }
          ]
        })
      }, module)
      await waitForExpansionPaint(canvas, module === 'chart' ? [51, 65, 85] : undefined)
      const invalidImage = await canvas.canvas.screenshot({
        path: info.outputPath(`${renderer}-${module}-invalid.png`)
      })
      expect(invalidImage.equals(docImage)).toBe(false)
      await page.evaluate(() => {
        const editor = window.openPencil.getStore()
        const node = editor.graph.getNode([...editor.state.selectedIds][0])
        if (!node) throw new Error('No selected module')
        const key = node.interactiveProps?.module?.moduleType === 'chart' ? 'data' : 'rows'
        const binding = node.bindings?.[key]
        if (binding?.kind !== 'docState') throw new Error('History lost document binding')
      })
      canvas.assertNoErrors()
    })
