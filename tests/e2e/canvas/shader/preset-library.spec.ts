import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'
import { CanvasHelper } from '#tests/helpers/canvas'

const context = useEditorSetup('/?test')

test.beforeAll(async () => {
  const { page } = context
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'gpu', { configurable: true, value: undefined })
  )
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'gpu', { configurable: true, value: undefined })
  )
})

test.beforeEach(async () => {
  const probe = await context.page.evaluateHandle(
    async () => import('/tests/helpers/shaders/preset-library.ts')
  )
  try {
    await probe.evaluate((probe) => probe.clearShaderPresetSelection())
    // Remount the inspector for each case, so storage failure probes observe its initial read.
    await expect(context.page.locator('[data-property="shader-preset-library"]')).toHaveCount(0)
  } finally {
    await probe.dispose()
  }
})

test('saved-frame preset controls persist and reapply after a real reload', async () => {
  const { page } = context
  let probe = await page.evaluateHandle(
    async () => import('/tests/helpers/shaders/preset-library.ts')
  )
  try {
    await probe.evaluate((probe) => probe.createShaderPresetDocument())
    let library = page.locator('[data-property="shader-preset-library"]')
    const parameter = page.locator('[data-property="shader-content-parameter"] input')
    await page.locator('[data-property="shader-content-parameter"]').click()
    await parameter.fill('12')
    await parameter.press('Enter')
    await library.getByRole('textbox', { name: /^(Preset name|预设名称)$/ }).fill('My pixels')
    await library.getByRole('button', { name: /^(Save current filter|保存当前滤镜)$/ }).click()
    await expect(library.locator('[data-slot="alert"]')).toHaveAttribute('data-tone', 'info')
    await page.locator('[data-property="shader-content-parameter"]').click()
    await parameter.fill('8')
    await parameter.press('Enter')
    await library.getByRole('button', { name: /^(Apply to selection|应用到选择)$/ }).click()
    expect((await probe.evaluate((probe) => probe.shaderPresetObservation()))[0].preset).toEqual({
      components: [{ type: 'Pixelate', props: { scale: 12 } }]
    })

    await probe.evaluate((probe) => probe.markShaderPresetDocumentSaved())
    await probe.dispose()
    await page.reload()
    await new CanvasHelper(page).waitForInit()
    probe = await page.evaluateHandle(
      async () => import('/tests/helpers/shaders/preset-library.ts')
    )
    await probe.evaluate((probe) => probe.createShaderPresetDocument())
    library = page.locator('[data-property="shader-preset-library"]')
    await library.getByRole('combobox', { name: /^(Choose saved preset|选择已保存预设)$/ }).click()
    await page.getByRole('option', { name: 'My pixels', exact: true }).click()
    await expect(page.getByRole('listbox')).toBeHidden()
    await expect(
      library.getByRole('button', { name: /^(Apply to selection|应用到选择)$/ })
    ).toBeVisible()
    await library.getByRole('button', { name: /^(Apply to selection|应用到选择)$/ }).click()
    expect((await probe.evaluate((probe) => probe.shaderPresetObservation()))[0].preset).toEqual({
      components: [{ type: 'Pixelate', props: { scale: 12 } }]
    })
  } finally {
    await probe.dispose()
  }
})

test('one batch applies a saved preset without changing source content and undoes together', async () => {
  const { page } = context
  const probe = await page.evaluateHandle(
    async () => import('/tests/helpers/shaders/preset-library.ts')
  )
  try {
    await probe.evaluate((probe) => probe.createShaderPresetDocument())
    const library = page.locator('[data-property="shader-preset-library"]')
    const parameter = page.locator('[data-property="shader-content-parameter"] input')
    await page.locator('[data-property="shader-content-parameter"]').click()
    await parameter.fill('12')
    await parameter.press('Enter')
    await library.getByRole('textbox', { name: /^(Preset name|预设名称)$/ }).fill('Batch pixels')
    await library.getByRole('button', { name: /^(Save current filter|保存当前滤镜)$/ }).click()
    await expect(library.locator('[data-slot="alert"]')).toHaveAttribute('data-tone', 'info')
    await page.locator('[data-property="shader-content-parameter"]').click()
    await parameter.fill('8')
    await parameter.press('Enter')
    const before = await probe.evaluate((probe) => probe.shaderPresetObservation())
    await probe.evaluate((probe) => probe.selectShaderPresetLayers())
    await library.getByRole('combobox', { name: /^(Choose saved preset|选择已保存预设)$/ }).click()
    await page.getByRole('option', { name: 'Batch pixels', exact: true }).click()
    await expect(page.getByRole('listbox')).toBeHidden()
    await expect(
      library.getByRole('button', { name: /^(Apply to selection|应用到选择)$/ })
    ).toBeVisible()
    await library.getByRole('button', { name: /^(Apply to selection|应用到选择)$/ }).click()
    const changed = await probe.evaluate((probe) => probe.shaderPresetObservation())
    expect(changed).toHaveLength(2)
    for (const node of changed)
      expect(node.preset).toEqual({ components: [{ type: 'Pixelate', props: { scale: 12 } }] })
    expect(changed.map((node) => node.source)).toEqual(before.map((node) => node.source))
    await page.screenshot({ path: test.info().outputPath('shader-preset-batch.png') })
    await page.keyboard.press('Meta+z')
    await expect
      .poll(() => probe.evaluate((probe) => probe.shaderPresetObservation()))
      .toEqual(before)
  } finally {
    await probe.dispose()
  }
})

for (const mode of ['read', 'write'] as const)
  test(`preset ${mode} storage failure stays visible and never reports persistence success`, async () => {
    const { page } = context
    const probe = await page.evaluateHandle(
      async () => import('/tests/helpers/shaders/preset-library.ts')
    )
    const failure = await probe.evaluateHandle(
      (probe, mode) => probe.shaderPresetStorageFailure(mode),
      mode
    )
    try {
      const before = await failure.evaluate((failure) => failure.stored())
      await probe.evaluate((probe) => probe.createShaderPresetDocument())
      const library = page.locator('[data-property="shader-preset-library"]')
      await library
        .getByRole('textbox', { name: /^(Preset name|预设名称)$/ })
        .fill('Unavailable storage')
      await library.getByRole('button', { name: /^(Save current filter|保存当前滤镜)$/ }).click()
      await expect(library.locator('[data-slot="alert"]')).toHaveAttribute('data-tone', 'warning')
      await library.getByRole('button', { name: /^(Save current filter|保存当前滤镜)$/ }).click()
      await expect(library.locator('[data-slot="alert"]')).toHaveAttribute('data-tone', 'warning')
      expect(await failure.evaluate((failure) => failure.stored())).toBe(before)
    } finally {
      await failure.evaluate((failure) => failure.restore())
      await failure.dispose()
      await probe.dispose()
    }
  })
