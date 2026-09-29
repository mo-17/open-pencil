import { expect, test } from '@playwright/test'

import { answerList, customerRow, withCustomerList } from '#tests/helpers/compiler/components/list'

for (const target of ['react', 'vue'] as const) {
  test(`${target} generated auto-height list keeps loading, empty and retry inside its container`, async ({
    page
  }, info) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 390, height: 844 })
    await withCustomerList(page, target, info, async (list) => {
      await list.open()
      const initial = await list.reads.next('')
      // Exercise generated state markup inside an authored auto-height/HUG-style container.
      await list.useAutoHeight()
      await expect(list.state).toHaveAttribute('data-list-state', 'loading')
      await expect(list.state).toBeVisible()
      await expect.poll(async () => (await list.statusGeometry()).contained).toBe(true)
      await answerList(initial, [])
      await expect(list.state).toHaveAttribute('data-list-state', 'empty')
      await expect(list.state).toBeVisible()
      await expect.poll(async () => (await list.statusGeometry()).contained).toBe(true)

      await list.refresh()
      const failing = await list.reads.next('')
      await failing.fulfill({ status: 503, json: { message: 'Auto-height test failure' } })
      await expect(list.state).toHaveAttribute('data-list-state', 'error')
      await expect(list.retry).toBeVisible()
      await expect.poll(async () => (await list.statusGeometry()).contained).toBe(true)
      const geometry = await list.statusGeometry()
      console.debug('Auto-height list error geometry', JSON.stringify({ target, geometry }))
      expect(geometry.height).toBeGreaterThan(44)
      await page.screenshot({ path: info.outputPath('list-auto-height-retry.png') })
      await list.retry.click()
      await answerList(await list.reads.next(''), [customerRow('Auto-height retry recovered')])
      await expect(
        page.getByText('Customer: Auto-height retry recovered', { exact: true })
      ).toBeVisible()
    })
  })

  test(`${target} generated list distinguishes loading, retained refresh, empty and retryable failure`, async ({
    page
  }, info) => {
    test.setTimeout(120_000)
    await withCustomerList(page, target, info, async (list) => {
      await list.open()
      const initial = await list.reads.next('')
      await expect(list.state).toHaveAttribute('data-list-state', 'loading')
      await expect(list.state).toBeVisible()
      await expect(list.retry).toHaveCount(0)
      await initial.fulfill({ status: 503, json: { message: 'Temporary first-load failure' } })
      await expect(list.state).toHaveAttribute('data-list-state', 'error')
      await expect(list.retry).toBeVisible()
      await list.retry.click()
      const firstRetry = await list.reads.next('')
      await expect(list.state).toHaveAttribute('data-list-state', 'loading')
      await answerList(firstRetry, [customerRow('Loaded customer')])
      await expect(page.getByText('Customer: Loaded customer', { exact: true })).toBeVisible()
      await expect(list.state).toHaveAttribute('data-list-state', 'ready')
      const readyPosition = await page
        .getByText('Customer: Loaded customer', { exact: true })
        .boundingBox()
      if (!readyPosition) throw new Error('Missing visible loaded customer position')

      await list.refresh()
      const refreshing = await list.reads.next('')
      await expect(list.state).toHaveAttribute('data-list-state', 'refreshing')
      await expect(page.getByText('Customer: Loaded customer', { exact: true })).toBeVisible()
      await page.screenshot({ path: info.outputPath('list-retained-refresh.png') })
      const refreshingPosition = await page
        .getByText('Customer: Loaded customer', { exact: true })
        .boundingBox()
      if (!refreshingPosition) throw new Error('Missing retained customer position')
      const layout = await list.state.evaluate((element) => {
        const parent = element.parentElement
        const style = parent ? getComputedStyle(parent) : undefined
        return {
          statusHeight: element.getBoundingClientRect().height,
          display: style?.display,
          flexDirection: style?.flexDirection,
          justifyContent: style?.justifyContent,
          gridTemplateRows: style?.gridTemplateRows,
          gridAutoRows: style?.gridAutoRows,
          alignContent: style?.alignContent
        }
      })
      console.debug(
        'Retained list geometry',
        JSON.stringify({ target, readyPosition, refreshingPosition, layout })
      )
      expect(layout.statusHeight).toBeLessThan(80)
      expect(Math.abs(refreshingPosition.y - readyPosition.y)).toBeLessThan(1)
      await refreshing.fulfill({ status: 503, json: { message: 'Temporary refresh failure' } })
      await expect(list.state).toHaveAttribute('data-list-state', 'error')
      await expect(page.getByText('Customer: Loaded customer', { exact: true })).toBeVisible()
      await expect(list.state).toContainText('previously loaded data')
      await page.screenshot({ path: info.outputPath('list-failed-retry.png') })
      await list.retry.click()
      const emptyRetry = await list.reads.next('')
      await expect(list.state).toHaveAttribute('data-list-state', 'refreshing')
      await answerList(emptyRetry, [])
      await expect(list.state).toHaveAttribute('data-list-state', 'empty')
      await expect(list.state).toBeVisible()
      await expect(page.getByText('Customer: Loaded customer', { exact: true })).toHaveCount(0)

      await list.refresh()
      const failing = await list.reads.next('')
      await failing.fulfill({ status: 503, json: { message: 'Temporary test failure' } })
      await expect(list.state).toHaveAttribute('data-list-state', 'error')
      await expect(list.retry).toBeVisible()
      const beforeRetry = list.reads.requests.length
      await list.retry.click()
      const retrying = await list.reads.next('')
      expect(list.reads.requests).toHaveLength(beforeRetry + 1)
      // The earlier empty response is still a successful snapshot; this retries its refresh.
      await expect(list.state).toHaveAttribute('data-list-state', 'refreshing')
      await answerList(retrying, [customerRow('Retry recovered customer', '2')])
      await expect(
        page.getByText('Customer: Retry recovered customer', { exact: true })
      ).toBeVisible()
      await expect(list.state).toHaveAttribute('data-list-state', 'ready')
      await expect(list.retry).toHaveCount(0)
    })
  })

  test(`${target} generated list clears changed queries and ignores results from abandoned pages`, async ({
    page
  }, info) => {
    test.setTimeout(120_000)
    await withCustomerList(page, target, info, async (list) => {
      await list.open()
      await answerList(await list.reads.next(''), [customerRow('Initial customer')])
      await expect(page.getByText('Customer: Initial customer', { exact: true })).toBeVisible()

      await list.search('alpha')
      const alpha = await list.reads.next('alpha')
      await expect(list.state).toHaveAttribute('data-list-state', 'loading')
      await expect(page.getByText('Customer: Initial customer', { exact: true })).toHaveCount(0)
      await list.search('beta')
      const beta = await list.reads.next('beta')
      await answerList(beta, [customerRow('Beta current customer', '2')])
      await expect(page.getByText('Customer: Beta current customer', { exact: true })).toBeVisible()
      await answerList(alpha, [customerRow('Alpha obsolete customer', '3')])
      await expect(
        page.getByText('Customer: Alpha obsolete customer', { exact: true })
      ).toHaveCount(0)
      await expect(page.getByText('Customer: Beta current customer', { exact: true })).toBeVisible()

      await list.refresh()
      const abandoned = await list.reads.next('beta')
      await expect(list.state).toHaveAttribute('data-list-state', 'refreshing')
      await list.navigate('Account setup')
      await expect(list.state).toHaveCount(0)
      await answerList(abandoned, [customerRow('Abandoned page customer', '4')])
      await list.navigate('Customers')
      const reopened = await list.reads.next('')
      await expect(list.state).toHaveAttribute('data-list-state', 'loading')
      await expect(page.getByText('Customer: Beta current customer', { exact: true })).toHaveCount(
        0
      )
      await expect(
        page.getByText('Customer: Abandoned page customer', { exact: true })
      ).toHaveCount(0)
      await answerList(reopened, [customerRow('Reopened current customer', '5')])
      await expect(
        page.getByText('Customer: Reopened current customer', { exact: true })
      ).toBeVisible()
    })
  })

  test(`${target} generated list clears retained rows across scripted account changes and denied reads`, async ({
    page
  }, info) => {
    test.setTimeout(120_000)
    await withCustomerList(page, target, info, async (list) => {
      await list.open()
      await answerList(await list.reads.next(''), [customerRow('First account private row')])
      await expect(
        page.getByText('Customer: First account private row', { exact: true })
      ).toBeVisible()
      await list.refresh()
      const oldAccount = await list.reads.next('')
      await expect(list.state).toHaveAttribute('data-list-state', 'refreshing')
      await list.switchAccount('00000000-0000-4000-8000-000000000002')
      const newAccount = await list.reads.next('')
      await expect(list.state).toHaveAttribute('data-list-state', 'loading')
      await expect(
        page.getByText('Customer: First account private row', { exact: true })
      ).toHaveCount(0)
      await answerList(newAccount, [customerRow('Second account private row', '2')])
      await answerList(oldAccount, [customerRow('Late first account row', '3')])
      await expect(
        page.getByText('Customer: Second account private row', { exact: true })
      ).toBeVisible()
      await expect(page.getByText('Customer: Late first account row', { exact: true })).toHaveCount(
        0
      )

      await list.refresh()
      const denied = await list.reads.next('')
      await denied.fulfill({ status: 403, json: { message: 'Denied test read' } })
      await expect(list.state).toHaveAttribute('data-list-state', 'error')
      await expect(
        page.getByText('Customer: Second account private row', { exact: true })
      ).toHaveCount(0)
      await expect(list.retry).toBeVisible()
    })
  })
}
