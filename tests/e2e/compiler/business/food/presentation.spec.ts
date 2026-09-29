import { expect, test } from '@playwright/test'

import { withBusinessBrowser } from '#tests/helpers/compiler/business/helpers'

const recordedAt = '2026-09-16T00:00:00.000Z'
const dishImageURL = 'https://restaurant.example.test/menu/mushroom-noodles.svg'
// The browser decodes a real image through the generated image_url binding.
// This local illustration keeps the presentation test independent of external hosts.
const dishImage = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
  <rect width="640" height="360" fill="#e9e0cf"/>
  <ellipse cx="330" cy="192" rx="205" ry="124" fill="#b9a888" opacity=".3"/>
  <ellipse cx="320" cy="174" rx="205" ry="124" fill="#f8f5ed"/>
  <ellipse cx="320" cy="174" rx="163" ry="91" fill="#a56736"/>
  <g fill="none" stroke="#eac17b" stroke-width="12" stroke-linecap="round">
    <path d="M192 151c48-42 85 58 136 18s77-18 123 7"/>
    <path d="M195 188c65-49 79 38 138 7s73-42 103 11"/>
    <path d="M220 221c36-42 56 17 94 6s56-29 86-9"/>
    <path d="M234 121c35 37 83-23 146 16"/>
  </g>
  <g fill="#4e6840"><ellipse cx="258" cy="133" rx="17" ry="8" transform="rotate(30 258 133)"/><ellipse cx="350" cy="224" rx="21" ry="9" transform="rotate(-25 350 224)"/><ellipse cx="409" cy="153" rx="21" ry="9" transform="rotate(35 409 153)"/></g>
  <g fill="#e4ceb0" stroke="#795437" stroke-width="5"><path d="M265 178q22-38 45 0z"/><path d="M341 151q23-39 46 0z"/></g>
</svg>`

test.use({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })

for (const target of ['react', 'vue'] as const) {
  test(`${target} presents a Chinese restaurant menu, cart and sign-in page`, async ({
    page
  }, info) => {
    test.setTimeout(90_000)
    await withBusinessBrowser(
      page,
      'food-ordering',
      target,
      async ({ api, open }) => {
        await page.route(dishImageURL, (route) =>
          route.fulfill({ contentType: 'image/svg+xml', body: dishImage })
        )
        const dishes = [
          {
            id: '00000000-0000-4000-8000-000000000040',
            title: '松露菌菇拌面',
            category: '主厨推荐',
            description: '鲜香菌菇与手作面条，拌入清爽松露酱汁。',
            image_url: dishImageURL,
            price: 3200,
            available: true,
            version: 0,
            created_at: recordedAt
          },
          {
            id: '00000000-0000-4000-8000-000000000041',
            title: '炭火照烧鸡腿饭',
            category: '人气主食',
            description: '现烤鸡腿搭配温热米饭，佐以时令蔬菜。',
            image_url: '',
            price: 3800,
            available: true,
            version: 0,
            created_at: recordedAt
          }
        ]
        api.resources['food-menu'] = dishes
        await open('food-menu')
        const firstDish = page.getByText(dishes[0].title, { exact: true })
        const secondDish = page.getByText(dishes[1].title, { exact: true })
        await expect(firstDish).toBeVisible()
        await expect(secondDish).toBeVisible()
        await expect(page.getByText('¥32.00', { exact: true })).toBeVisible()
        await expect(page.getByText('¥38.00', { exact: true })).toBeVisible()
        const photo = page.locator(`img[src="${dishImageURL}"]`)
        await expect(photo).toBeVisible()
        await expect
          .poll(() => photo.evaluate((element: HTMLImageElement) => element.naturalWidth))
          .toBe(640)
        const firstBounds = await firstDish.boundingBox()
        const secondBounds = await secondDish.boundingBox()
        if (!firstBounds || !secondBounds) throw new Error('The two menu cards must be visible')
        expect(secondBounds.x).toBeGreaterThan(firstBounds.x + firstBounds.width)
        expect(Math.abs(secondBounds.y - firstBounds.y)).toBeLessThan(2)
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
        ).toBe(true)
        await page.screenshot({ path: info.outputPath('restaurant-menu-zh.png') })
        await page.screenshot({
          path: info.outputPath('restaurant-menu-full-zh.png'),
          fullPage: true
        })

        await page.getByPlaceholder('搜索菜品', { exact: true }).fill('菌菇')
        await page.getByRole('button', { name: '更新列表', exact: true }).click()
        await expect(firstDish).toBeVisible()
        await expect(secondDish).toHaveCount(0)

        api.resources['food-carts'] = [
          {
            id: '00000000-0000-4000-8000-000000000050',
            subtotal: 7600,
            item_count: 1,
            version: 1,
            created_at: recordedAt
          }
        ]
        api.resources['food-cart-items'] = [
          {
            id: '00000000-0000-4000-8000-000000000051',
            cart_id: '00000000-0000-4000-8000-000000000050',
            menu_item_id: dishes[1].id,
            product_title: dishes[1].title,
            quantity: 2,
            unit_price: 3800,
            line_total: 7600,
            active: true,
            created_at: recordedAt
          }
        ]
        await page.getByRole('button', { name: '点餐购物车', exact: true }).click()
        await expect(page.getByText(dishes[1].title, { exact: true })).toBeVisible()
        await expect(page.getByText(/¥76\.00$/u)).toBeVisible()
        await expect(page.getByRole('button', { name: '确认下单', exact: true })).toBeVisible()
        await page.screenshot({ path: info.outputPath('restaurant-cart-zh.png'), fullPage: true })

        api.resources['food-cart-items'] = []
        await page.getByRole('button', { name: '刷新列表', exact: true }).click()
        await expect(page.getByRole('button', { name: '查看详情', exact: true })).toHaveCount(0)
        await page.screenshot({ path: info.outputPath('restaurant-cart-empty-zh.png') })
        await info.attach('empty-cart-copy', {
          body: await page.locator('body').innerText(),
          contentType: 'text/plain'
        })

        await open('login')
        await expect(page.getByRole('button', { name: '登录', exact: true }).first()).toBeVisible()
        await expect(page.getByRole('button', { name: '点餐菜单', exact: true })).toBeVisible()
        await page.screenshot({ path: info.outputPath('restaurant-login-zh.png'), fullPage: true })
        expect(api.calls).toHaveLength(0)
      },
      { locale: 'zh-cn' }
    )
  })

  test(`${target} keeps long dish names and categories clear of prices and selection`, async ({
    page
  }) => {
    test.setTimeout(90_000)
    await withBusinessBrowser(
      page,
      'food-ordering',
      target,
      async ({ api, open }) => {
        const title = '当季松露菌菇手作拌面搭配现烤鸡腿与时令蔬菜'.repeat(10).slice(0, 200)
        const category = '主厨推荐与当季限定'.repeat(12).slice(0, 100)
        api.resources['food-menu'] = [
          {
            id: '00000000-0000-4000-8000-000000000040',
            title,
            category,
            description: '完整菜品信息可在选择后查看。',
            image_url: '',
            price: 3255,
            available: true,
            version: 0,
            created_at: recordedAt
          }
        ]
        await open('food-menu')
        const dishName = page.getByText(title, { exact: true })
        const dishCategory = page.getByText(category, { exact: true })
        const price = page.getByText('¥32.55', { exact: true })
        const select = page.getByRole('button', { name: '查看详情', exact: true })
        await expect(dishName).toBeVisible()
        await expect(price).toBeVisible()
        const [nameBounds, categoryBounds, priceBounds, selectBounds] = await Promise.all([
          dishName.boundingBox(),
          dishCategory.boundingBox(),
          price.boundingBox(),
          select.boundingBox()
        ])
        if (!nameBounds || !categoryBounds || !priceBounds || !selectBounds)
          throw new Error('The complete dish card must remain visible')
        expect(categoryBounds.y + categoryBounds.height).toBeLessThanOrEqual(nameBounds.y)
        expect(nameBounds.y + nameBounds.height).toBeLessThanOrEqual(priceBounds.y)
        expect(nameBounds.y + nameBounds.height).toBeLessThanOrEqual(selectBounds.y)
        await expect(dishName).not.toHaveCSS('overflow-y', 'visible')
        await expect(dishCategory).not.toHaveCSS('overflow-x', 'visible')
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
        ).toBe(true)
        await select.click()
        await expect(page.getByText('菜品: ' + title, { exact: true })).toBeVisible()
        await expect(page.getByText('分类: ' + category, { exact: true })).toBeVisible()
      },
      { locale: 'zh-cn' }
    )
  })
}
