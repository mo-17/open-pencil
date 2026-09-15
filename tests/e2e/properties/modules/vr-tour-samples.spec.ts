import { VR_TOUR_SAMPLE_ASSETS } from '@open-pencil/core/plugins'

import { expect, test } from '#tests/e2e/fixtures'
import { CanvasHelper } from '#tests/helpers/canvas'
import { observeVRTourSampleDownloads } from '#tests/helpers/plugins/vr-tour'

test.use({ locale: 'zh-CN' })

test('Chinese VR plugin installs its 8K pack and embeds reusable samples with atomic undo', async ({
  page
}, testInfo) => {
  test.setTimeout(120000)
  const requests = await observeVRTourSampleDownloads(
    page,
    process.env.OPENPENCIL_VR_SAMPLE_LIVE === '1'
  )
  await page.goto('/?test&navigation-benchmark')
  const canvas = new CanvasHelper(page)
  const settle = () =>
    page.evaluate(async () => {
      const navigation = window.openPencil?.test?.navigation
      if (!navigation) throw new Error('Canvas settlement hook not initialized')
      await navigation.waitForSettlement()
    })
  await canvas.waitForInit()
  expect(requests).toEqual([])
  await page.getByTestId('app-settings-trigger').click()
  await page.getByTestId('settings-section-plugins').click()
  const views = page.getByTestId('settings-plugins-view')
  await views.getByText('浏览', { exact: true }).click()
  await page.getByTestId('plugin-discover-search').fill('VR')
  const install = page.getByTestId('plugin-install-open-pencil.vr-tour')
  await expect(install).toContainText('8K')
  await install.click()
  await expect(page.getByTestId('plugin-installed-open-pencil.vr-tour')).toBeVisible({
    timeout: 90000
  })
  expect(requests).toHaveLength(2)
  await views.getByText('已安装', { exact: true }).click()
  await page.getByTestId('plugin-enabled-open-pencil.vr-tour').click()
  await page.getByTestId('app-settings-done').click()
  await page.getByTestId('toolbar-plugin-modules').click()
  await page.getByTestId('toolbar-plugin-module-open-pencil.vr-tour-vr-tour').click()
  await canvas.waitForRender()
  await expect(page.getByRole('group', { name: '房间与热点', exact: true })).toBeVisible()
  await expect(page.getByRole('combobox', { name: '界面语言', exact: true })).toHaveValue('zh-CN')
  await expect(page.getByRole('textbox', { name: '看房标题', exact: true })).toHaveValue(
    '房屋全景导览'
  )
  await settle()
  await page.screenshot({ path: testInfo.outputPath('vr-tour-before-samples.png') })
  const useSamples = page.getByRole('button', { name: '使用真实住宅示例', exact: true })
  await useSamples.click()
  await expect(
    page.getByRole('textbox', { name: '360° 全景图片', exact: true }).first()
  ).toHaveValue(VR_TOUR_SAMPLE_ASSETS[0].panoramaUrl)
  await expect(page.getByRole('textbox', { name: '房间名称', exact: true }).first()).toHaveValue(
    '住宅示例 A'
  )
  const imageHashes = () =>
    page.evaluate(() => [...(window.openPencil?.getStore?.().graph.images.keys() ?? [])])
  expect(await imageHashes()).toEqual(VR_TOUR_SAMPLE_ASSETS.map((asset) => asset.graphImageHash))
  expect(requests).toHaveLength(2)
  await settle()
  await page.screenshot({ path: testInfo.outputPath('vr-tour-after-samples.png') })
  await canvas.undo()
  expect(await imageHashes()).toEqual([])
  await expect(page.getByRole('textbox', { name: '房间名称', exact: true }).first()).toHaveValue(
    '客厅'
  )
  await canvas.redo()
  expect(await imageHashes()).toEqual(VR_TOUR_SAMPLE_ASSETS.map((asset) => asset.graphImageHash))
  await expect(page.getByRole('textbox', { name: '房间名称', exact: true }).first()).toHaveValue(
    '住宅示例 A'
  )
  await settle()
  await expect(
    page.getByText(/^错误: 浏览器预览不支持超出大小限制或格式无效的生成文件/)
  ).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('vr-tour-chinese-samples.png') })
  await page.reload()
  await canvas.waitForInit()
  await page.getByTestId('toolbar-plugin-modules').click()
  await page.getByTestId('toolbar-plugin-module-open-pencil.vr-tour-vr-tour').click()
  await page.getByRole('button', { name: '使用真实住宅示例', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '房间名称', exact: true }).first()).toHaveValue(
    '住宅示例 A'
  )
  expect(requests).toHaveLength(2)
  canvas.assertNoErrors()
})
