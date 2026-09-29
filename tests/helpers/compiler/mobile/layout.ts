import { expect, type Locator, type Page } from '@playwright/test'

export const mobileViewports = [
  { name: 'phone-375', width: 375, height: 812 },
  { name: 'phone-390', width: 390, height: 844 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'landscape-844', width: 844, height: 390 },
  { name: 'desktop-1440', width: 1440, height: 1000 }
] as const

export const mobileBrowserOptions = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
  actionTimeout: 10_000
} as const

export function mobileNavigation(page: Page) {
  return page.getByRole('combobox', { name: /^(页面导航|Page navigation)$/u })
}

export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <=
          innerWidth + 1
      )
    )
    .toBe(true)
  expect(await page.evaluate(() => innerWidth)).toBe(page.viewportSize()?.width)
}

export async function expectHorizontalBounds(page: Page, control: Locator): Promise<void> {
  await expect(control).toBeVisible()
  const bounds = await control.boundingBox()
  const viewport = page.viewportSize()
  if (!bounds || !viewport) throw new Error('The mobile control must have measurable bounds')
  expect(bounds.x).toBeGreaterThanOrEqual(-1)
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1)
}

export async function expectTouchTarget(page: Page, control: Locator): Promise<void> {
  await expectHorizontalBounds(page, control)
  const bounds = await control.boundingBox()
  if (!bounds) throw new Error('The touch target must have measurable bounds')
  expect(bounds.height).toBeGreaterThanOrEqual(44)
  expect(bounds.width).toBeGreaterThanOrEqual(44)
  if ((page.viewportSize()?.width ?? 0) < 1280)
    expect(
      await control.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))
    ).toBeGreaterThanOrEqual(16)
}

export async function expectNoOverlap(first: Locator, second: Locator): Promise<void> {
  const [a, b] = await Promise.all([first.boundingBox(), second.boundingBox()])
  if (!a || !b) throw new Error('Both content and action must remain measurable')
  const overlapWidth = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const overlapHeight = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  expect(overlapWidth <= 1 || overlapHeight <= 1).toBe(true)
}

/** A tap must not rely on Playwright scrolling content inside a non-scrollable clipped card. */
export async function expectActionNotClipped(control: Locator): Promise<void> {
  await expect(control).toBeVisible()
  const clipped = await control.evaluate((element) => {
    const ancestors: { tag: string; overflowY: string; height: number; content: number }[] = []
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const overflowY = getComputedStyle(parent).overflowY
      if (
        (overflowY === 'hidden' || overflowY === 'clip') &&
        parent.scrollHeight > parent.clientHeight + 1
      )
        ancestors.push({
          tag: parent.tagName,
          overflowY,
          height: parent.clientHeight,
          content: parent.scrollHeight
        })
    }
    return ancestors
  })
  expect(clipped, 'A visible action must not be hidden inside a clipped card').toEqual([])
}

export async function inspectActionLayout(control: Locator): Promise<unknown> {
  return control.evaluate((element) => {
    const describe = (node: Element) => {
      const style = getComputedStyle(node)
      return {
        tag: node.tagName,
        classes: node.className,
        rect: node.getBoundingClientRect().toJSON(),
        display: style.display,
        position: style.position,
        height: style.height,
        minHeight: style.minHeight,
        overflowY: style.overflowY,
        scrollHeight: node.scrollHeight,
        clientHeight: node.clientHeight,
        gridTemplateRows: style.gridTemplateRows,
        gridAutoRows: style.gridAutoRows,
        alignContent: style.alignContent,
        offsetParent:
          node instanceof HTMLElement && node.offsetParent
            ? {
                tag: node.offsetParent.tagName,
                classes: node.offsetParent.className,
                rect: node.offsetParent.getBoundingClientRect().toJSON()
              }
            : null
      }
    }
    const ancestors = []
    for (let parent = element.parentElement; parent; parent = parent.parentElement)
      ancestors.push({
        ...describe(parent),
        children: ['grid', 'flex'].includes(getComputedStyle(parent).display)
          ? [...parent.children].map((card) => ({
              ...describe(card),
              children: [...card.children].map((child) => ({
                ...describe(child),
                children: [...child.children].map(describe)
              }))
            }))
          : undefined
      })
    const bounds = element.getBoundingClientRect()
    const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
    return { action: describe(element), hitAtCenter: hit ? describe(hit) : null, ancestors }
  })
}

/** Reduced layout height is a keyboard boundary simulation, not an OS keyboard test. */
export async function exerciseReducedViewport(
  page: Page,
  field: Locator,
  draft: string,
  submit: Locator
): Promise<void> {
  await page.setViewportSize({ width: 390, height: 420 })
  await field.tap()
  await field.fill(draft)
  await expect(field).toBeFocused()
  expect(
    await field.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))
  ).toBeGreaterThanOrEqual(16)
  await expectHorizontalBounds(page, field)
  await submit.scrollIntoViewIfNeeded()
  await expect(submit).toBeInViewport()
  await expectTouchTarget(page, submit)
  await expectNoHorizontalOverflow(page)
  await page.setViewportSize({ width: 844, height: 390 })
  await expect(field).toHaveValue(draft)
  await expectHorizontalBounds(page, field)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(field).toHaveValue(draft)
}

export async function tapBusinessSubmit(page: Page, label: string): Promise<void> {
  await page.clock.fastForward(350)
  await page.getByRole('button', { name: label, exact: true }).last().tap()
  await expect(page.getByText('Submit this request? ' + label, { exact: true })).toBeVisible()
  await page.getByRole('button', { name: label, exact: true }).last().tap()
}

export async function tapBusinessReceipt(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Finish reviewed request', exact: true }).tap()
  await page.getByRole('button', { name: /^(OK|Confirm)$/u }).tap()
  await expect(
    page.getByRole('button', { name: 'Finish reviewed request', exact: true })
  ).toHaveCount(0)
}
