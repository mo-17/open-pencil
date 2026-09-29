import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { expect, test } from '@playwright/test'

import type { PreviewServer } from '@open-pencil/compiler/dev-server'

for (const scenario of ['react', 'react-shadcn', 'vue'] as const) {
  test(`${scenario} controls preserve names, disabled options and authored field actions`, async ({
    page
  }, info) => {
    test.setTimeout(90000)
    const target = scenario === 'vue' ? 'vue' : 'react'
    const kit = scenario === 'react-shadcn'
    const files: [string, string][] = JSON.parse(
      execFileSync(
        'bun',
        [
          '-e',
          `import {shadcnControlsFixture} from './tests/helpers/compiler/components/shadcn-controls'; process.stdout.write(JSON.stringify([...shadcnControlsFixture('${target}', ${kit}).files]))`
        ],
        { encoding: 'utf8', cwd: process.cwd() }
      )
    )
    const { createPreviewServer } = await import(
      pathToFileURL(join(process.cwd(), 'packages/compiler/dist/dev-server.mjs')).href
    )
    const server: PreviewServer = await createPreviewServer({
      target,
      initialFiles: new Map(files)
    })
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    try {
      await page.goto(server.url)
      const amount = page.getByRole('spinbutton', { name: 'Amount', exact: true })
      await expect(amount).toHaveAttribute('min', '0')
      await expect(amount).toHaveAttribute('max', '10')
      await expect(amount).toHaveAttribute('step', '0.5')
      await amount.fill('12')
      expect(
        await amount.evaluate((element) => (element as HTMLInputElement).validity.rangeOverflow)
      ).toBe(true)
      const delivery = page.getByRole('combobox', { name: 'Delivery', exact: true })
      if (kit) {
        const layout = await page.evaluate(() => {
          const measure = (element: Element) => {
            const rect = element.getBoundingClientRect()
            const style = getComputedStyle(element)
            return {
              tag: element.tagName,
              label: element.getAttribute('aria-label'),
              className: element.getAttribute('class'),
              rect: rect.toJSON(),
              style: Object.fromEntries(
                [
                  'display',
                  'position',
                  'height',
                  'minHeight',
                  'maxHeight',
                  'flexBasis',
                  'flexShrink',
                  'paddingTop',
                  'paddingBottom',
                  'overflow',
                  'transform'
                ].map((key) => [key, style[key as keyof CSSStyleDeclaration]])
              )
            }
          }
          return Array.from(document.querySelectorAll('[role="combobox"]')).map((element) => {
            const rect = element.getBoundingClientRect()
            const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
            return {
              control: measure(element),
              parent: element.parentElement && measure(element.parentElement),
              hit: hit && measure(hit),
              children: Array.from(element.children).map(measure)
            }
          })
        })
        writeFileSync(
          info.outputPath('shadcn-control-layout.json'),
          JSON.stringify(layout, null, 2)
        )
        await info.attach('shadcn-control-layout', {
          body: JSON.stringify(layout, null, 2),
          contentType: 'application/json'
        })
        await page.screenshot({ path: info.outputPath('shadcn-before-select.png'), fullPage: true })
        expect(
          await delivery.evaluate((element) => {
            const rect = element.getBoundingClientRect()
            return element.contains(
              document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
            )
          })
        ).toBe(true)
        await delivery.click()
        await expect(
          page.getByRole('option', { name: 'Unavailable delivery', exact: true })
        ).toBeDisabled()
        await page.getByRole('option', { name: 'Express delivery', exact: true }).click()
      } else {
        await expect(
          delivery.getByRole('option', { name: 'Unavailable delivery', exact: true })
        ).toBeDisabled()
        await delivery.selectOption('express')
      }
      await expect(page.getByText('Amount[12] Delivery[express]', { exact: true })).toBeVisible()
      await expect(page.getByRole('textbox', { name: 'Read only notes' })).toHaveAttribute(
        'readonly',
        ''
      )
      await expect(page.getByLabel('Read only date', { exact: true })).toHaveAttribute(
        'readonly',
        ''
      )
      await expect(
        page.getByRole('checkbox', { name: 'Disabled checkbox', exact: true })
      ).toBeDisabled()
      await expect(
        page.getByRole('switch', { name: 'Disabled switch', exact: true })
      ).toBeDisabled()
      await expect(
        page.getByRole('combobox', { name: 'Disabled select', exact: true })
      ).toBeDisabled()
      await expect(
        page
          .getByRole('radiogroup', { name: 'Disabled delivery group' })
          .getByRole('radio', { name: 'First' })
      ).toBeDisabled()
      await expect(
        page
          .getByRole('group', { name: 'Disabled choice group' })
          .getByRole('checkbox', { name: 'Accept' })
      ).toBeDisabled()
      const eventSelect = page.getByRole('combobox', { name: 'Event delivery', exact: true })
      await eventSelect.focus()
      await expect(page.getByText('Contact[] Event[select-focus]', { exact: true })).toBeVisible()
      await eventSelect.selectOption('standard')
      await expect(
        page.getByText('Contact[] Event[select-change:standard]', { exact: true })
      ).toBeVisible()
      await expect(page.getByText('Amount[12] Delivery[standard]', { exact: true })).toBeVisible()
      await eventSelect.press('Tab')
      await expect(page.getByText('Contact[] Event[select-blur]', { exact: true })).toBeVisible()
      const checkbox = page.getByRole('checkbox', { name: 'Event checkbox', exact: true })
      await checkbox.check()
      await expect(page.getByText('Contact[] Event[checked:on]', { exact: true })).toBeVisible()
      await checkbox.uncheck()
      await expect(page.getByText('Contact[] Event[unchecked:on]', { exact: true })).toBeVisible()
      await page
        .getByRole('radiogroup', { name: 'Event RADIO', exact: true })
        .getByRole('radio', { name: 'Beta' })
        .check()
      await expect(page.getByText('Contact[] Event[option:Beta]', { exact: true })).toBeVisible()
      await page
        .getByRole('group', { name: 'Event CHECKBOX', exact: true })
        .getByRole('checkbox', { name: 'Alpha' })
        .check()
      await expect(page.getByText('Contact[] Event[option:Alpha]', { exact: true })).toBeVisible()
      await page.getByRole('checkbox', { name: 'Click checkbox', exact: true }).click()
      await expect(page.getByText('Contact[] Event[clicked]', { exact: true })).toBeVisible()
      const empty = page.getByRole('combobox', { name: 'Empty choice', exact: true })
      await expect(empty).toHaveValue('')
      await empty.selectOption('standard')
      await empty.selectOption('')
      await expect(empty).toHaveValue('')
      const contact = page.getByRole('textbox', { name: 'Contact name', exact: true })
      await contact.focus()
      await expect(page.getByText('Contact[] Event[focus]', { exact: true })).toBeVisible()
      await amount.focus()
      await expect(page.getByText('Contact[] Event[blur]', { exact: true })).toBeVisible()
      await expect(contact).toHaveAttribute('aria-invalid', 'true')
      await expect(page.getByRole('alert')).toContainText('Enter a contact name')
      await contact.fill('Ada')
      await expect(page.getByText('Contact[Ada] Event[change]', { exact: true })).toBeVisible()
      await amount.focus()
      await expect(page.getByText('Contact[Ada] Event[blur]', { exact: true })).toBeVisible()
      await expect(contact).not.toHaveAttribute('aria-invalid', 'true')
      await page.screenshot({ path: info.outputPath(`${scenario}-controls.png`), fullPage: true })
      expect(errors).toEqual([])
    } finally {
      await page.close()
      await server.close()
    }
  })
}
