import { expect, test } from '#tests/e2e/fixtures'
import {
  expansionField,
  selectedModuleClip,
  waitForExpansionPaint
} from '#tests/helpers/plugins/component-expansion'
import {
  CONTENT_MODULES,
  contentSource,
  deferContentCommit,
  insertContentModule,
  prepareContentModule,
  savedContentSource,
  selectContentLayer,
  selectedContentNodeId,
  type ContentModule
} from '#tests/helpers/plugins/content-components'

const samples: Record<ContentModule, string> = {
  'code-block':
    '// 中文示例：配置与业务数据分开\nconst profile = { name: "设计师", role: "开发者" }\n\nfunction greet(name) {\n\treturn "你好，" + name + "！欢迎在画布上编辑可复制的代码示例。"\n}\nconsole.log(greet(profile.name))',
  markdown:
    '# 项目说明\n\n中文与 **English** 可以一起排版。\n\n## 本地工作流\n\n- 编辑内容并保存\n- 在 React / Vue 中预览\n\n> 修改样式不会执行文档中的代码。\n\n```js\nconst greeting = "你好，世界"\n```'
}
const inertMarkup =
  '<img data-content-probe-image src="data:image/png;base64,broken" onerror="document.documentElement.setAttribute(\'data-content-probe\',\'executed\')">'

test.use({ viewport: { width: 1600, height: 1100 } })

for (const renderer of ['retained', 'tiled'] as const) {
  for (const module of CONTENT_MODULES) {
    test(`${renderer}: ${module} multiline authoring paints Chinese content and never executes source`, async ({
      page
    }) => {
      test.setTimeout(120_000)
      const canvas = await prepareContentModule(page, renderer, module)
      const id = await selectedContentNodeId(page)
      const source = contentSource(page, module)
      const original = await source.inputValue()
      const sample = samples[module]
      await expect(source).toHaveAttribute('rows', module === 'code-block' ? '12' : '10')
      await source.fill(sample)
      await source.blur()
      await expect(source).toHaveValue(sample)
      expect(await savedContentSource(page, id, module)).toBe(sample)
      await page.getByTestId('toolbar').getByRole('button').first().focus()
      await canvas.undo()
      await expect(source).toHaveValue(original)
      expect(await savedContentSource(page, id, module)).toBe(original)
      await canvas.redo()
      await expect(source).toHaveValue(sample)

      if (module === 'code-block') {
        await expansionField(page, 'wrapLines').getByRole('checkbox').check()
        await expansionField(page, 'showLineNumbers').getByRole('checkbox').check()
      }
      await waitForExpansionPaint(canvas, module === 'code-block' ? [249, 250, 251] : [55, 65, 81])
      await expect(page).toHaveScreenshot(`${renderer}-${module}-chinese.png`, {
        clip: await selectedModuleClip(page),
        animations: 'disabled',
        maxDiffPixelRatio: 0
      })

      await source.fill(sample + '\n\n' + inertMarkup)
      await source.blur()
      await expect(source).toHaveValue(sample + '\n\n' + inertMarkup)
      expect(await savedContentSource(page, id, module)).toBe(sample + '\n\n' + inertMarkup)
      await waitForExpansionPaint(canvas, module === 'code-block' ? [249, 250, 251] : [55, 65, 81])
      await expect(page.locator('img[data-content-probe-image]')).toHaveCount(0)
      await expect(page.locator('html')).not.toHaveAttribute('data-content-probe', 'executed')
      canvas.assertNoErrors()
    })

    test(`${renderer}: ${module} delayed textarea commits cannot write another selected node`, async ({
      page
    }) => {
      const canvas = await prepareContentModule(page, renderer, module)
      const first = await selectedContentNodeId(page)
      const original = await contentSource(page, module).inputValue()
      await insertContentModule(page, module)
      const second = await selectedContentNodeId(page)
      const source = contentSource(page, module)
      await source.fill('Pending edit owned by the second node\n第二行')
      const pending = await deferContentCommit(source)
      try {
        await selectContentLayer(page, first)
        await expect(contentSource(page, module)).toHaveValue(original)
        await pending.deliver()
        await expect(contentSource(page, module)).toHaveValue(original)
        expect(await savedContentSource(page, first, module)).toBe(original)
        expect(await savedContentSource(page, second, module)).toBe(original)
        await selectContentLayer(page, second)
        await expect(contentSource(page, module)).toHaveValue(original)
        canvas.assertNoErrors()
      } finally {
        await pending.dispose()
      }
    })

    test(`${renderer}: ${module} retained deactivation discards pending source before late blur`, async ({
      page
    }) => {
      const canvas = await prepareContentModule(page, renderer, module)
      const id = await selectedContentNodeId(page)
      const source = contentSource(page, module)
      const original = await source.inputValue()
      await source.fill('Uncommitted retained draft\n尚未提交')
      const pending = await deferContentCommit(source)
      try {
        await canvas.click(12, 12)
        await expect(page.getByTestId('design-panel-empty')).toBeVisible()
        await expect(source).toHaveCount(0)
        await pending.deliver()
        expect(await savedContentSource(page, id, module)).toBe(original)
        await selectContentLayer(page, id)
        await expect(contentSource(page, module)).toHaveValue(original)
        await contentSource(page, module).fill('Fresh edit after reactivation\n恢复后编辑')
        await contentSource(page, module).blur()
        await expect(contentSource(page, module)).toHaveValue(
          'Fresh edit after reactivation\n恢复后编辑'
        )
        expect(await savedContentSource(page, id, module)).toBe(
          'Fresh edit after reactivation\n恢复后编辑'
        )
        canvas.assertNoErrors()
      } finally {
        await pending.dispose()
      }
    })
  }
}
