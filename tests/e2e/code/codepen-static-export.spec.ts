import { expect, test } from '@playwright/test'

import type * as StaticButtonFixture from '#tests/helpers/code/static-button'

for (const imageScaleMode of ['FIT', 'FILL'] as const)
  for (const disabled of [false, true])
    test(`CodePen browser export keeps IMAGE ${imageScaleMode} button artwork and native disabled=${disabled}`, async ({
      page
    }) => {
      await page.goto('/?test&no-chrome&no-rulers')
      const output = await page.evaluate(
        async ({ disabled, imageScaleMode }) => {
          const moduleURL = new URL('/tests/helpers/code/static-button.ts', location.origin).href
          const { staticButtonExports } = (await import(
            /* @vite-ignore */ moduleURL
          )) as typeof StaticButtonFixture
          return staticButtonExports(disabled, imageScaleMode)
        },
        { disabled, imageScaleMode }
      )
      expect(output.compatible).toBe(true)
      expect(output.js).toBe('')
      await page.setContent(
        `<style>${output.css}</style><section aria-label="Native export">${output.nativeHTML}</section><section aria-label="Static export">${output.staticHTML}</section>`
      )
      const native = page.getByRole('region', { name: 'Native export' })
      const artwork = page.getByRole('region', { name: 'Static export' })
      const button = native.getByRole('button', { name: output.label, exact: true })
      await expect(button).toHaveAttribute('type', 'button')
      if (disabled) await expect(button).toBeDisabled()
      else {
        await expect(button).toBeEnabled()
        await button.click()
        await expect(button).toBeFocused()
      }
      const buttonBounds = await button.boundingBox()
      expect(buttonBounds?.width).toBe(140)
      expect(buttonBounds?.height).toBe(40)
      for (const region of [native, artwork]) {
        const image = region.locator('img')
        await expect(image).toHaveCount(1)
        await expect(image).toBeVisible()
        await expect(image).toHaveJSProperty('naturalWidth', 1)
        await expect(image).toHaveJSProperty('naturalHeight', 1)
        await expect(image).toHaveAttribute('aria-hidden', 'true')
        await expect(image).toHaveCSS('object-fit', imageScaleMode === 'FIT' ? 'contain' : 'cover')
        await expect(image).toHaveCSS('pointer-events', 'none')
        await expect(region.getByText(output.label, { exact: true })).toBeVisible()
      }
      const imageBounds = await artwork.locator('img').boundingBox()
      expect(imageBounds?.width).toBe(140)
      expect(imageBounds?.height).toBe(40)
      await expect(
        artwork.locator('button, form, input, script, [tabindex], [onclick]')
      ).toHaveCount(0)
      await test.info().attach('image-button-rendering', {
        body: await page.screenshot({ clip: { x: 0, y: 0, width: 320, height: 120 } }),
        contentType: 'image/png'
      })
    })

for (const disabled of [false, true])
  test(`CodePen browser export keeps button artwork passive and native disabled=${disabled}`, async ({
    page
  }) => {
    await page.goto('/?test&no-chrome&no-rulers')
    const output = await page.evaluate(async (disabled) => {
      const moduleURL = new URL('/tests/helpers/code/static-button.ts', location.origin).href
      const { staticButtonExports } = (await import(
        /* @vite-ignore */ moduleURL
      )) as typeof StaticButtonFixture
      return staticButtonExports(disabled)
    }, disabled)
    expect(output.js).toBe('')
    await page.setContent(
      `<style>${output.css}</style><section aria-label="Native export">${output.nativeHTML}</section><section aria-label="Static export">${output.staticHTML}</section>`
    )
    const native = page.getByRole('region', { name: 'Native export' }),
      artwork = page.getByRole('region', { name: 'Static export' }),
      button = native.getByRole('button', { name: output.label, exact: true }),
      label = artwork.getByText(output.label, { exact: true })
    await expect(button).toHaveAttribute('type', 'button')
    if (disabled) await expect(button).toBeDisabled()
    else {
      await expect(button).toBeEnabled()
      await button.click()
      await expect(button).toBeFocused()
    }
    await expect(artwork.getByRole('button')).toHaveCount(0)
    await expect(artwork.locator('button, form, input, script, [tabindex], [onclick]')).toHaveCount(
      0
    )
    await expect(label).toBeVisible()
    expect(await label.evaluate((element) => element.tagName)).toBe('DIV')
    expect(
      await label.evaluate((element) => (element instanceof HTMLElement ? element.tabIndex : null))
    ).toBe(-1)
    const bounds = await label.boundingBox()
    expect(bounds?.width).toBe(140)
    expect(bounds?.height).toBe(40)
  })
