import { expect, test } from '@playwright/test'

import { withTimeline } from '#tests/helpers/compiler/modules/timeline/browser'

for (const target of ['react', 'vue'] as const) {
  test(`${target} Timeline displays ordered status events and wraps long content without overlap`, async ({
    page
  }, info) => {
    await withTimeline(page, target, async () => {
      const list = page.getByRole('list', { name: '项目时间线' })
      await expect(list.getByRole('listitem')).toHaveCount(4)
      for (const status of ['Completed', 'Current', 'Error', 'Pending'])
        await expect(list.getByRole('img', { name: status, exact: true })).toBeVisible()
      await expect(list.locator('[aria-current="true"]')).toHaveAttribute(
        'data-timeline-item',
        'review'
      )
      await expect(list.locator('b')).toHaveCount(0)
      await expect(list.locator('[data-timeline-item="next"] [data-timeline-title]')).toHaveText(
        '<b>下一项</b>'
      )
      await expect(
        list.locator('[data-timeline-item="next"] [data-timeline-description]')
      ).toHaveCount(0)
      const host = page.locator('[data-openpencil-timeline]')
      for (const width of [640, 320]) {
        await host.evaluate((element, width) => {
          element.style.width = `${width}px`
        }, width)
        const geometry = await list.locator('[data-timeline-item]').evaluateAll((items) =>
          items.map((item) => {
            const text = item.querySelector('[data-timeline-content]')?.getBoundingClientRect()
            const marker = item.querySelector('[data-timeline-marker]')?.getBoundingClientRect()
            if (!text || !marker) throw new Error('Missing event geometry')
            return {
              top: text.top,
              bottom: text.bottom,
              textX: text.x,
              markerX: marker.x,
              width: text.width,
              itemTop: item.getBoundingClientRect().top
            }
          })
        )
        for (let index = 1; index < geometry.length; index++)
          expect(geometry[index].itemTop).toBeGreaterThan(geometry[index - 1].bottom)
        expect(geometry[0].textX).toBeGreaterThan(geometry[0].markerX)
        if (width === 640) expect(geometry[1].textX).toBeLessThan(geometry[1].markerX)
        else expect(geometry[1].textX).toBeGreaterThan(geometry[1].markerX)
        expect(
          await host.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)
        ).toBe(true)
      }
      await page.screenshot({ path: info.outputPath(`${target}-timeline.png`), fullPage: true })
    })
  })
  test(`${target} Timeline preserves event identity through reordering and replaces local display without affecting other instances`, async ({
    page
  }) => {
    await withTimeline(
      page,
      target,
      async () => {
        const hosts = page.locator('[data-openpencil-timeline]'),
          first = hosts.first(),
          second = hosts.last()
        const event = await first.locator('[data-timeline-item="created"]').elementHandle()
        if (!event) throw new Error('Missing initial event')
        await page.getByRole('button', { name: 'Reverse events' }).click()
        await expect(first.locator('[data-timeline-item]').last()).toHaveAttribute(
          'data-timeline-item',
          'created'
        )
        expect(
          await first
            .locator('[data-timeline-item="created"]')
            .evaluate((element, before) => element === before, event)
        ).toBe(true)
        await expect(second.locator('[data-timeline-item]').first()).toHaveAttribute(
          'data-timeline-item',
          'created'
        )
        await page.setViewportSize({ width: 375, height: 800 })
        expect(
          await first.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)
        ).toBe(true)
        await page.getByRole('button', { name: 'Empty events' }).click()
        await expect(first.getByRole('listitem')).toHaveCount(0)
        await expect(first.locator('[data-timeline-empty]')).toHaveText('No events yet')
        const empty = await first.locator('[data-timeline-empty]').boundingBox(),
          frame = await first.boundingBox()
        if (!empty || !frame) throw new Error('Missing empty geometry')
        expect(empty.y - frame.y).toBe(0)
        await page.getByRole('button', { name: 'Replace config' }).click()
        await expect(first.locator('[data-timeline-item="created"]')).toHaveAttribute(
          'data-status',
          'error'
        )
        await expect(
          first.locator('[data-timeline-item="created"] [data-timeline-title]')
        ).toHaveText('Updated title')
        await expect(
          second.locator('[data-timeline-item="created"] [data-timeline-title]')
        ).toHaveText('Created')
        await expect(first.locator('button,input,select')).toHaveCount(0)
        await page.getByRole('button', { name: 'Chinese labels' }).click()
        await expect(first.getByRole('img', { name: '错误', exact: true })).toHaveCount(1)
        await expect(first.getByRole('img', { name: '当前', exact: true })).toHaveCount(1)
        await expect(second.getByRole('img', { name: 'Completed', exact: true })).toHaveCount(1)
      },
      true
    )
  })
}
