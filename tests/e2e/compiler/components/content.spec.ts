import { expect, test } from '@playwright/test'

import { withContent } from '#tests/helpers/compiler/modules/content/browser'
import {
  clipboardMode,
  clipboardSnapshot,
  finishContentClipboard,
  installContentClipboard
} from '#tests/helpers/compiler/modules/content/clipboard'
import {
  CONTENT_CODE,
  CONTENT_UNTRUSTED_MARKDOWN
} from '#tests/helpers/compiler/modules/content/samples'

test.use({ viewport: { width: 900, height: 900 } })

for (const target of ['react', 'vue'] as const) {
  test(`${target} Markdown renders CommonMark and optional GFM semantics with reactive source`, async ({
    page
  }) => {
    await withContent(page, target, async () => {
      const current = page.getByRole('region', { name: 'Current Markdown' })
      const other = page.getByRole('region', { name: 'Other Markdown' })
      await expect(current.getByRole('heading', { name: '内容说明', level: 1 })).toBeVisible()
      await expect(current.locator('strong')).toHaveText('重点')
      await expect(current.locator('em')).toHaveText('强调')
      await expect(current.locator('blockquote')).toHaveText('保留引用结构。')
      const steps = current.locator('[data-markdown-body] > ol')
      await expect(steps).toHaveAttribute('start', '3')
      await expect(steps.locator('li')).toHaveText(['第三步', '第四步'])
      await expect(current.locator('pre code')).toHaveText('const greeting = "你好，世界"\n')
      await expect(current.getByRole('table').getByRole('row')).toHaveCount(3)
      await expect(current.getByRole('columnheader')).toHaveText(['名称', '状态'])
      await expect(current.getByRole('cell')).toHaveText(['设计', '完成', '开发', '进行中'])
      await expect(current.locator('del')).toHaveText('旧内容')
      const tasks = current.getByRole('checkbox')
      await expect(tasks).toHaveCount(2)
      await expect(tasks.nth(0)).toBeChecked()
      await expect(tasks.nth(1)).not.toBeChecked()
      await expect(tasks.nth(0)).toBeDisabled()
      await expect(tasks.nth(1)).toBeDisabled()

      await page.getByRole('button', { name: 'Flavor', exact: true }).click()
      await expect(current.getByRole('table')).toHaveCount(0)
      await expect(current.getByRole('checkbox')).toHaveCount(0)
      await expect(current.locator('del')).toHaveCount(0)
      await expect(current).toContainText('~~旧内容~~')
      await expect(current.locator('strong')).toHaveText('重点')
      await expect(other.getByRole('table')).toHaveCount(1)

      await page
        .getByRole('textbox', { name: 'Markdown source', exact: true })
        .fill('# 更新后\n\n仅此组件发生变化。')
      await expect(current.getByRole('heading', { name: '更新后', level: 1 })).toBeVisible()
      await expect(current.getByRole('heading', { name: '内容说明' })).toHaveCount(0)
      await expect(current.locator('p')).toHaveText('仅此组件发生变化。')
      await expect(other.getByRole('heading', { name: '内容说明', level: 1 })).toBeVisible()
    })
  })

  test(`${target} Markdown drops active HTML and leaves links and images network inert until explicit navigation`, async ({
    page
  }) => {
    const requests: string[] = []
    page.on('request', (request) => {
      if (
        request.url().includes('content-probe.invalid') ||
        request.url().endsWith('/content-image-probe.png')
      )
        requests.push(request.url())
    })
    await page.route('https://content-probe.invalid/**', (route) => route.abort())
    await page.route('**/content-image-probe.png', (route) => route.abort())
    await withContent(page, target, async () => {
      const current = page.getByRole('region', { name: 'Current Markdown' })
      await page
        .getByRole('textbox', { name: 'Markdown source', exact: true })
        .fill(CONTENT_UNTRUSTED_MARKDOWN)
      await expect(current.getByRole('heading', { name: '安全内容' })).toBeVisible()
      await expect(current.getByRole('link')).toHaveCount(3)
      const publicLink = current.getByRole('link', { name: '公开文档', exact: true })
      await expect(publicLink).toHaveAttribute('href', 'https://example.com/docs')
      await expect(current.getByRole('link', { name: '站内页面', exact: true })).toHaveAttribute(
        'href',
        '/docs/start'
      )
      await expect(current.getByRole('link', { name: '章节', exact: true })).toHaveAttribute(
        'href',
        '#chapter'
      )
      await expect(publicLink).not.toHaveAttribute('target', '_blank')
      for (const label of [
        '脚本链接',
        '数据链接',
        '本机链接',
        'IP链接',
        '协议相对链接',
        '越级路径'
      ]) {
        await expect(current.getByRole('link', { name: label, exact: true })).toHaveCount(0)
        await expect(current).toContainText(label)
      }
      await page.getByRole('button', { name: 'Link target', exact: true }).click()
      await expect(publicLink).toHaveAttribute('target', '_blank')
      expect((await publicLink.getAttribute('rel'))?.split(/\s+/).sort()).toEqual([
        'nofollow',
        'noopener',
        'noreferrer'
      ])
      await expect(current.getByRole('img', { name: '外部图片', exact: true })).toHaveText(
        '[外部图片]'
      )
      await expect(current.getByRole('img', { name: '站内图片', exact: true })).toHaveText(
        '[站内图片]'
      )
      await expect(current.locator('img,iframe,script,[data-executable-probe]')).toHaveCount(0)
      await expect(current.locator('pre code')).toHaveText(
        '<b data-executable-probe>代码只是文本</b>\n'
      )
      await expect(page.locator('html')).not.toHaveAttribute('data-content-executed', 'yes')
      await page
        .getByRole('textbox', { name: 'Markdown source', exact: true })
        .fill('![](https://content-probe.invalid/fallback.png)')
      await expect(current.getByRole('img', { name: 'Markdown 图片', exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'Language', exact: true }).click()
      await expect(current.getByRole('img', { name: 'Markdown image', exact: true })).toBeVisible()
      await expect(current.getByRole('img', { name: 'Markdown 图片', exact: true })).toHaveCount(0)
      await expect(
        page
          .getByRole('region', { name: 'Other Markdown' })
          .getByRole('heading', { name: '内容说明', level: 1 })
      ).toBeVisible()
      expect(requests).toEqual([])
    })
  })

  test(`${target} Markdown footnotes navigate back within their own instance and retain accessible references`, async ({
    page
  }) => {
    await withContent(page, target, async () => {
      const identities = new Set<string>()
      for (const name of ['Current Markdown', 'Other Markdown']) {
        const instance = page.getByRole('region', { name, exact: true })
        const references = instance.locator('sup a')
        await expect(references).toHaveCount(2)
        for (const reference of await references.all()) {
          const referenceId = await reference.getAttribute('id')
          const href = await reference.getAttribute('href')
          const description = await reference.getAttribute('aria-describedby')
          if (!referenceId || !href?.startsWith('#') || !description)
            throw new Error('Missing footnote relationship')
          const targetId = href.slice(1)
          for (const id of [referenceId, targetId]) {
            expect(identities.has(id)).toBe(false)
            identities.add(id)
            expect(id).toMatch(/^[A-Za-z0-9_.:-]+$/)
            await expect(page.locator(`[id="${id}"]`)).toHaveCount(1)
            await expect(instance.locator(`[id="${id}"]`)).toHaveCount(1)
          }
          for (const id of description.split(/\s+/)) {
            await expect(page.locator(`[id="${id}"]`)).toHaveCount(1)
            await expect(instance.locator(`[id="${id}"]`)).toHaveCount(1)
          }
          await reference.click()
          await expect(page.locator(':target')).toHaveAttribute('id', targetId)
          const back = instance.locator(`[href="#${referenceId}"]`)
          await expect(back).toHaveCount(1)
          await expect(back).toHaveAttribute('aria-label', /\S/)
          await back.click()
          await expect(page.locator(':target')).toHaveAttribute('id', referenceId)
        }
      }
    })
  })

  test(`${target} CodeBlock keeps source lines and line numbers aligned while wrapping at narrow widths`, async ({
    page
  }, info) => {
    await withContent(page, target, async () => {
      const current = page.getByRole('region', { name: 'Current code', exact: true })
      const rows = current.locator('[data-code-row]')
      const texts = current.locator('[data-code-text]')
      await expect(rows).toHaveCount(CONTENT_CODE.split('\n').length)
      expect(await texts.allTextContents()).toEqual(CONTENT_CODE.split('\n'))
      await expect(current.locator('[data-code-number]')).toHaveText(['1', '2', '3', '4', '5'])
      const narrow = await rows.nth(1).boundingBox()
      if (!narrow) throw new Error('Missing wrapped code row')
      for (const row of await rows.all()) {
        const number = await row.locator('[data-code-number]').boundingBox()
        const text = await row.locator('[data-code-text]').boundingBox()
        if (!number || !text) throw new Error('Missing code row cells')
        expect(number.y).toBeCloseTo(text.y, 1)
        expect(number.height).toBeCloseTo(text.height, 1)
      }
      const next = await rows.nth(2).boundingBox()
      if (!next) throw new Error('Missing row after wrapped source')
      expect(next.y).toBeGreaterThanOrEqual(narrow.y + narrow.height - 0.5)
      await current.screenshot({ path: info.outputPath(`${target}-code-wrap.png`) })
      await page.getByRole('button', { name: 'Width', exact: true }).click()
      const wide = await rows.nth(1).boundingBox()
      if (!wide) throw new Error('Missing wide code row')
      expect(wide.height).toBeLessThan(narrow.height)
      expect(await texts.allTextContents()).toEqual(CONTENT_CODE.split('\n'))
      await page.getByRole('button', { name: 'Width', exact: true }).click()
      await page.getByRole('button', { name: 'Wrap', exact: true }).click()
      const scroller = current.locator('[data-code-scroll]')
      expect(await scroller.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(
        true
      )
      await page.getByRole('button', { name: 'Line numbers', exact: true }).click()
      await expect(current.locator('[data-code-number]')).toHaveCount(0)
      expect(await texts.allTextContents()).toEqual(CONTENT_CODE.split('\n'))
      const raw =
        '<img src="https://content-probe.invalid/code.png" onerror="alert(1)">\n<script>throw new Error("not executable")</script>'
      await page.getByRole('textbox', { name: 'Code source', exact: true }).fill(raw)
      await expect(texts).toHaveText(raw.split('\n'))
      expect(await texts.allTextContents()).toEqual(raw.split('\n'))
      await expect(current.locator('img,script')).toHaveCount(0)
    })
  })

  test(`${target} CodeBlock copy feedback is localized and invalidates old source and unmounted requests`, async ({
    page
  }) => {
    await installContentClipboard(page)
    await withContent(page, target, async () => {
      const current = page.getByRole('region', { name: 'Current code', exact: true })
      const other = page.getByRole('region', { name: 'Other code', exact: true })
      const status = current.locator('[data-code-status]')
      await current.getByRole('button', { name: '复制', exact: true }).click()
      await expect(status).toHaveText('已复制')
      expect((await clipboardSnapshot(page)).calls).toEqual([CONTENT_CODE])
      await expect(other.locator('[data-code-status]')).toBeEmpty()
      await page
        .getByRole('textbox', { name: 'Business input', exact: true })
        .fill('Equivalent config rerender')
      await expect(status).toHaveText('已复制')

      await clipboardMode(page, 'failure')
      await current.getByRole('button', { name: '复制', exact: true }).click()
      await expect(status).toHaveText('复制失败，请手动选择代码后复制。')
      await expect(current).not.toContainText('Private clipboard error detail')
      await page.getByRole('button', { name: 'Language', exact: true }).click()
      await expect(status).toBeEmpty()
      await current.getByRole('button', { name: 'Copy', exact: true }).click()
      await expect(status).toHaveText('Copy failed. Select the code and copy it manually.')

      await clipboardMode(page, 'pending')
      await current.getByRole('button', { name: 'Copy', exact: true }).click()
      await expect(status).toHaveText('Copying…')
      await expect(current.getByRole('button', { name: 'Copy', exact: true })).toBeDisabled()
      expect((await clipboardSnapshot(page)).pending).toBe(1)
      const replacement = '// New source\nconsole.log("新内容")'
      await page.getByRole('textbox', { name: 'Code source', exact: true }).fill(replacement)
      await expect(current.locator('[data-code-text]')).toHaveText(replacement.split('\n'))
      await expect(status).toBeEmpty()
      await finishContentClipboard(page)
      await expect(status).toBeEmpty()

      await current.getByRole('button', { name: 'Copy', exact: true }).click()
      await expect(status).toHaveText('Copying…')
      expect((await clipboardSnapshot(page)).calls.at(-1)).toBe(replacement)
      await page.getByRole('button', { name: 'Toggle code', exact: true }).click()
      await expect(current.locator('[data-openpencil-code-block]')).toHaveCount(0)
      await finishContentClipboard(page, false)
      await expect(other.locator('[data-code-status]')).toBeEmpty()
      await page.getByRole('button', { name: 'Toggle code', exact: true }).click()
      await expect(status).toBeEmpty()
      await expect(current.locator('[data-code-text]')).toHaveText(replacement.split('\n'))
    })
  })
}
