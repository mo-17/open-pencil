import { execFileSync } from 'node:child_process'

import { expect, test, type Page } from '@playwright/test'

import { withApplicationGuardsFiles } from '#tests/helpers/compiler/application-guards/browser'
import type { ApplicationGuardsFixtureOptions } from '#tests/helpers/compiler/application-guards/fixture'
import { parseCompilerBrowserOutput } from '#tests/helpers/compiler/output'

type NavigationOperation = 'push' | 'replace' | 'authored Back' | 'browser Back'

function output(target: 'react' | 'vue', options: ApplicationGuardsFixtureOptions = {}) {
  return parseCompilerBrowserOutput(
    execFileSync(
      'bun',
      [
        '-e',
        `import {compileApplicationGuardsFixture} from './tests/helpers/compiler/application-guards/fixture';const r=compileApplicationGuardsFixture(${JSON.stringify(target)},${JSON.stringify(options)});process.stdout.write(JSON.stringify({files:[...r.files],warnings:r.warnings}));`
      ],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
    )
  )
}

async function clickWithoutScrolling(page: Page, name: string) {
  await page
    .getByRole('button', { name, exact: true })
    .evaluate((button: HTMLButtonElement) => button.click())
}

function leaveDialog(page: Page) {
  return page.getByRole('dialog', { name: 'Leave this page?', exact: true })
}

async function attemptNavigation(page: Page, operation: NavigationOperation) {
  if (operation === 'browser Back') await page.evaluate(() => history.back())
  else {
    const button = {
      push: 'Push Home',
      replace: 'Replace with Home',
      'authored Back': 'Back to previous page'
    }[operation]
    await clickWithoutScrolling(page, button)
  }
}

async function startDraft(page: Page) {
  await expect(page.getByText('Home screen', { exact: true })).toBeVisible()
  await page.getByPlaceholder('Filter products').fill('keep this list filter')
  await page.evaluate(() => window.scrollTo(0, 350))
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(350)
  await clickWithoutScrolling(page, 'Open products')
  await expect(page).toHaveURL(/\/products\/42$/)
  await page.getByPlaceholder('Detail draft').fill('unsaved product 42')
  await page.evaluate(() => window.scrollTo(0, 450))
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(450)
}

async function assertDraftRetained(page: Page, href: string) {
  await expect(page).toHaveURL(href)
  await expect(page.getByPlaceholder('Detail draft')).toHaveValue('unsaved product 42')
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(450)
}

async function observeProductBody(page: Page) {
  return page.evaluateHandle(() => {
    let mounted = false
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.textContent?.includes('Products screen')) mounted = true
        }
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })
    return { mounted: () => mounted, disconnect: () => observer.disconnect() }
  })
}

async function requestGuardedRoute(page: Page, route: string) {
  await page.evaluate(async (destination) => {
    const guard = Reflect.get(window, '__opApplicationNavigationGuard')
    if (!guard || typeof guard !== 'object') throw new Error('Missing navigation guard runtime')
    const request = Reflect.get(guard, 'requestRoute')
    if (typeof request !== 'function') throw new Error('Missing guarded route request')
    await Reflect.apply(request, guard, [destination])
  }, route)
}

async function assertInitialEntryDenied(page: Page, url: string) {
  const initial = await page.context().newPage()
  const mounted: string[] = []
  const errors: string[] = []
  initial.on('console', (message) => {
    if (message.text() === 'guards-test:product-body-mounted') mounted.push(message.text())
  })
  initial.on('pageerror', (error) => errors.push(error.message))
  try {
    await initial.addInitScript(() => {
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (node.textContent?.includes('Products screen')) {
              console.debug('guards-test:product-body-mounted')
            }
          }
        }
      })
      observer.observe(document, { childList: true, subtree: true })
      addEventListener('pagehide', () => observer.disconnect(), { once: true })
    })
    await initial.goto(url, { waitUntil: 'networkidle' })
    await expect(initial).toHaveURL(/\/home$/)
    await expect(initial.getByText('Home screen', { exact: true })).toBeVisible()
    await expect(initial.getByPlaceholder('Detail draft')).toHaveCount(0)
    expect(mounted).toEqual([])
    expect(errors).toEqual([])
  } finally {
    await initial.close()
  }
}

for (const target of ['react', 'vue'] as const) {
  for (const operation of ['push', 'replace', 'authored Back', 'browser Back'] as const) {
    test(`${target} cancels and then accepts ${operation} without losing the current draft`, async ({
      page
    }, info) => {
      const result = output(target)
      expect(result.warnings).toEqual([])
      await withApplicationGuardsFiles(page, target, new Map(result.files), async () => {
        await startDraft(page)
        const href = page.url()
        const length = await page.evaluate(() => history.length)
        await attemptNavigation(page, operation)
        const dialog = leaveDialog(page)
        await expect(dialog).toBeVisible()
        await expect(
          dialog.getByText('Leave without saving this draft?', { exact: true })
        ).toBeVisible()
        expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(
          true
        )
        await page.screenshot({ path: info.outputPath(`${target}-${operation}-pending.png`) })
        await dialog.getByRole('button', { name: 'Stay', exact: true }).click()
        await expect(dialog).not.toBeVisible()
        await assertDraftRetained(page, href)
        expect(await page.evaluate(() => history.length)).toBe(length)
        await attemptNavigation(page, operation)
        await expect(dialog).toBeVisible()
        await dialog.getByRole('button', { name: 'Leave page', exact: true }).click()
        await expect(page).toHaveURL(/\/home$/)
        await expect(page.getByPlaceholder('Filter products')).toHaveValue('keep this list filter')
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(350)
        expect(await page.evaluate(() => history.length)).toBe(
          length + (operation === 'push' ? 1 : 0)
        )
        await clickWithoutScrolling(page, 'Open products')
        await expect(page.getByPlaceholder('Detail draft')).toHaveValue('')
        await clickWithoutScrolling(page, 'Back to previous page')
        await expect(page).toHaveURL(/\/home$/)
        await expect(dialog).not.toBeVisible()
      })
    })
  }

  test(`${target} confirms same-page path parameters and query changes before reset`, async ({
    page
  }) => {
    const result = output(target)
    expect(result.warnings).toEqual([])
    await withApplicationGuardsFiles(page, target, new Map(result.files), async () => {
      await startDraft(page)
      const href = page.url()
      const dialog = leaveDialog(page)
      await clickWithoutScrolling(page, 'Open next product')
      await expect(dialog).toBeVisible()
      await dialog.getByRole('button', { name: 'Stay', exact: true }).click()
      await assertDraftRetained(page, href)
      await clickWithoutScrolling(page, 'Open next product')
      await dialog.getByRole('button', { name: 'Leave page', exact: true }).click()
      await expect(page).toHaveURL(/\/products\/43$/)
      await expect(page.getByPlaceholder('Detail draft')).toHaveValue('')
      await page.getByPlaceholder('Detail draft').fill('unsaved product 43')
      await clickWithoutScrolling(page, 'Open detail query')
      await expect(dialog).toBeVisible()
      await dialog.getByRole('button', { name: 'Stay', exact: true }).click()
      await expect(page).toHaveURL(/\/products\/43$/)
      await expect(page.getByPlaceholder('Detail draft')).toHaveValue('unsaved product 43')
      await clickWithoutScrolling(page, 'Open detail query')
      await dialog.getByRole('button', { name: 'Leave page', exact: true }).click()
      await expect(page).toHaveURL(/\/products\/43\?mode=edit$/)
      await expect(page.getByPlaceholder('Detail draft')).toHaveValue('')
    })
  })

  test(`${target} denies first-entry, parameter and query access before mounting the page`, async ({
    page
  }, info) => {
    const result = output(target, { hasAccess: false })
    expect(result.warnings).toEqual([])
    await withApplicationGuardsFiles(page, target, new Map(result.files), async () => {
      await expect(page.getByText('Home screen', { exact: true })).toBeVisible()
      const probe = await observeProductBody(page)
      try {
        await requestGuardedRoute(page, '/products/42')
        await expect(page).toHaveURL(/\/home$/)
        await expect(page.getByPlaceholder('Detail draft')).toHaveCount(0)
        await clickWithoutScrolling(page, 'Grant product access')
        for (const route of ['/products/blocked', '/products/42?mode=blocked']) {
          await requestGuardedRoute(page, route)
          await expect(page).toHaveURL(/\/home$/)
          await expect(page.getByPlaceholder('Detail draft')).toHaveCount(0)
        }
        expect(await probe.evaluate((value) => value.mounted())).toBe(false)
      } finally {
        await probe.evaluate((value) => value.disconnect())
        await probe.dispose()
      }
      await assertInitialEntryDenied(page, new URL('/products/42', page.url()).href)
      await page.screenshot({ path: info.outputPath(`${target}-denied-entry.png`) })
    })
  })

  test(`${target} retires an open confirmation when access changes and rejects its late choice`, async ({
    page
  }, info) => {
    const result = output(target)
    expect(result.warnings).toEqual([])
    await withApplicationGuardsFiles(page, target, new Map(result.files), async () => {
      await startDraft(page)
      await clickWithoutScrolling(page, 'Push Home')
      const dialog = leaveDialog(page)
      await expect(dialog).toBeVisible()
      const staleLeave = await dialog
        .getByRole('button', { name: 'Leave page', exact: true })
        .evaluateHandle((button) => button)
      try {
        await clickWithoutScrolling(page, 'Revoke product access')
        await expect(page).toHaveURL(/\/home$/)
        await expect(dialog).not.toBeVisible()
        await clickWithoutScrolling(page, 'Grant product access')
        await clickWithoutScrolling(page, 'Open products')
        await expect(page).toHaveURL(/\/products\/42$/)
        await expect(page.getByPlaceholder('Detail draft')).toHaveValue('')
        await staleLeave.evaluate((button) => {
          if (button instanceof HTMLButtonElement) button.click()
        })
        await page.evaluate(
          () =>
            new Promise<void>((resolve) => {
              requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
            })
        )
        await expect(page).toHaveURL(/\/products\/42$/)
        await expect(dialog).not.toBeVisible()
        await page.screenshot({ path: info.outputPath(`${target}-retired-confirmation.png`) })
      } finally {
        await staleLeave.dispose()
      }
    })
  })
}
