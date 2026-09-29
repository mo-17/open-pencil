import { expect, test } from '#tests/e2e/fixtures'
import {
  expansionField,
  insertExpansionModule,
  prepareExpansionModules,
  selectedExpansionConfig,
  setExpansionNumber,
  waitForExpansionPaint
} from '#tests/helpers/plugins/component-expansion'
import {
  captureTimelineStatusChoice,
  reorderSelectedTimelineItems
} from '#tests/helpers/plugins/timeline'

test.use({ viewport: { width: 1600, height: 1100 } })

for (const renderer of ['retained', 'tiled'] as const) {
  test(`${renderer}: avatar and badge inspector changes match painted canvas states`, async ({
    page
  }) => {
    test.setTimeout(120_000)
    const canvas = await prepareExpansionModules(page, renderer, ['avatar', 'badge'])
    await insertExpansionModule(page, 'avatar')
    const fallback = expansionField(page, 'fallbackText').getByRole('textbox')
    await fallback.fill('LM')
    await fallback.blur()
    await setExpansionNumber(page, 'fontSize', '24')
    expect(await selectedExpansionConfig(page)).toMatchObject({ fallbackText: 'LM', fontSize: 24 })
    await expect(expansionField(page, 'borderRadius')).toHaveCount(0)
    await waitForExpansionPaint(canvas, [29, 78, 216])
    await expect(canvas.canvas).toHaveScreenshot(`${renderer}-avatar-fallback.png`, {
      animations: 'disabled'
    })
    await page.getByTestId('toolbar').getByRole('button').first().focus()
    await canvas.deleteSelection()

    await insertExpansionModule(page, 'badge')
    await setExpansionNumber(page, 'count', '128')
    await expansionField(page, 'hostLabel').getByRole('textbox').fill('Inbox')
    await expansionField(page, 'hostLabel').getByRole('textbox').blur()
    await waitForExpansionPaint(canvas, [31, 41, 55])
    await expect(canvas.canvas).toHaveScreenshot(`${renderer}-badge-count.png`, {
      animations: 'disabled'
    })
    const mode = expansionField(page, 'mode').getByRole('combobox')
    await mode.focus()
    await mode.selectOption('dot')
    await expect(expansionField(page, 'count')).toHaveCount(0)
    const placement = expansionField(page, 'placement').getByRole('combobox')
    await placement.focus()
    await placement.selectOption('bottom-left')
    await waitForExpansionPaint(canvas, [31, 41, 55])
    await expect(canvas.canvas).toHaveScreenshot(`${renderer}-badge-dot.png`, {
      animations: 'disabled'
    })
    await mode.focus()
    await mode.selectOption('count')
    expect(await selectedExpansionConfig(page)).toMatchObject({
      count: 128,
      placement: 'bottom-left',
      mode: 'count'
    })
    canvas.assertNoErrors()
  })

  test(`${renderer}: timeline edits, ordering and empty-state undo remain visible`, async ({
    page
  }) => {
    test.setTimeout(120_000)
    const canvas = await prepareExpansionModules(page, renderer, ['timeline'])
    await insertExpansionModule(page, 'timeline')
    const rows = page.getByTestId('timeline-item-row')
    await expect(rows).toHaveCount(3)
    const title = rows.first().getByRole('textbox', { name: 'Title', exact: true })
    await title.fill('Design review')
    await title.blur()
    const time = rows.first().getByRole('textbox', { name: 'Time text', exact: true })
    await time.fill('10:00')
    await time.blur()
    await rows.first().getByRole('button', { name: 'Move down', exact: true }).click()
    await expect(rows.nth(1).getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(
      'Design review'
    )
    await waitForExpansionPaint(canvas)
    await expect(canvas.canvas).toHaveScreenshot(`${renderer}-timeline-authored.png`, {
      animations: 'disabled'
    })
    for (let i = 0; i < 3; i++)
      await rows.first().getByRole('button', { name: 'Remove', exact: true }).click()
    await expect(rows).toHaveCount(0)
    expect(await selectedExpansionConfig(page)).toMatchObject({ items: [] })
    await page.getByTestId('toolbar').getByRole('button').first().focus()
    await canvas.undo()
    await expect(rows).toHaveCount(1)
    await page.getByRole('button', { name: 'Add event', exact: true }).click()
    await expect(rows).toHaveCount(2)
    await expect(rows.last().getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(
      'New event'
    )
    canvas.assertNoErrors()
  })
}

for (const renderer of ['retained', 'tiled'] as const) {
  test(`${renderer}: a collaborating timeline reorder closes old status choices without editing another event`, async ({
    page
  }) => {
    test.setTimeout(120_000)
    const canvas = await prepareExpansionModules(page, renderer, ['timeline'])
    await insertExpansionModule(page, 'timeline')
    const rows = page.getByTestId('timeline-item-row')
    await expect(
      rows.first().getByRole('textbox', { name: 'Identifier', exact: true })
    ).toHaveValue('created')
    await rows.first().getByRole('combobox', { name: 'Status', exact: true }).click()
    await expect(page.getByRole('listbox')).toBeVisible()
    const pending = await captureTimelineStatusChoice(page, 'Error')
    try {
      await reorderSelectedTimelineItems(page)
      await expect(page.getByRole('listbox')).toHaveCount(0)
      await expect.poll(pending.connected).toBe(false)
      await expect(
        rows.first().getByRole('textbox', { name: 'Identifier', exact: true })
      ).toHaveValue('review')
      await pending.deliver()
      expect(await selectedExpansionConfig(page)).toMatchObject({
        items: [
          { id: 'review', status: 'current' },
          { id: 'created', status: 'completed' },
          { id: 'next', status: 'pending' }
        ]
      })
      await expect(rows.first().getByRole('combobox', { name: 'Status', exact: true })).toHaveText(
        'Current'
      )
      await rows.first().getByRole('combobox', { name: 'Status', exact: true }).click()
      await page.getByRole('option', { name: 'Error', exact: true }).click()
      expect(await selectedExpansionConfig(page)).toMatchObject({
        items: [
          { id: 'review', status: 'error' },
          { id: 'created', status: 'completed' },
          { id: 'next', status: 'pending' }
        ]
      })
      canvas.assertNoErrors()
    } finally {
      await pending.dispose()
    }
  })
}
