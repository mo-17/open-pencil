import type { FontManager } from '@open-pencil/core/text'
import type { SceneNode } from '@open-pencil/scene-graph'

import { createAccordionModuleInstance } from '#core/plugins/accordion'
import { createDropdownMenuModuleInstance } from '#core/plugins/dropdown-menu'
import { createSlideMenuModuleInstance } from '#core/plugins/slide-menu'
import { createTableModuleInstance } from '#core/plugins/table'
import { createUploadButtonModuleInstance } from '#core/plugins/upload-button'

import { expect, test } from '#tests/e2e/fixtures'
import { CanvasHelper } from '#tests/helpers/canvas'
import { mockFontsource } from '#tests/helpers/fonts/fontsource'
import { trackFontModuleResources } from '#tests/helpers/fonts/runtime'

test.use({ viewport: { width: 1500, height: 1050 } })

for (const renderer of ['retained', 'tiled'] as const) {
  test(`${renderer}: controls and module labels paint Chinese initial and changed values`, async ({
    page
  }, info) => {
    test.setTimeout(90000)
    await trackFontModuleResources(page)
    await mockFontsource(page, [])
    await page.goto(`/?test&renderer=${renderer}&navigation-benchmark`)
    const canvas = new CanvasHelper(page)
    await canvas.waitForInit()
    const module = createAccordionModuleInstance({
      items: [
        {
          id: 'profile',
          title: '资料与说明 Profile',
          content:
            '第一行：编辑个人资料。\n第二行 Mixed text，较长内容按可用宽度换行。\n第三行：保留段落。'
        },
        { id: 'details', title: '其他设置', content: '第二节内容\n更改初始展开项后显示这里。' }
      ],
      initialOpenIds: ['profile']
    })
    const modules = {
      accordion: module,
      table: createTableModuleInstance({
        table: {
          columns: ['姓名 Name', '状态'],
          rows: [
            ['张三', '已启用'],
            ['李四', '处理中']
          ]
        }
      }),
      slideMenu: createSlideMenuModuleInstance({ triggerLabel: '打开导航 Menu' }),
      dropdown: createDropdownMenuModuleInstance({ triggerLabel: '更多操作 More' }),
      upload: createUploadButtonModuleInstance({ triggerLabel: '选择文件 File' })
    }
    const ids = await page.evaluate(async (modules) => {
      const editor = window.openPencil.getStore()
      const fontURL = performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((url) => url.includes('/packages/core/src/text/fonts.ts'))
      if (!fontURL) throw new Error('Font module unavailable')
      const { fontManager } = (await import(/* @vite-ignore */ fontURL)) as {
        fontManager: FontManager
      }
      const font = await fetch('/tests/fixtures/fonts/NotoSansSC-Regular.ttf')
      if (!font.ok) throw new Error('Local CJK fixture unavailable')
      fontManager.markLoaded('Noto Sans SC', 'Regular', await font.arrayBuffer())
      fontManager.setCJKFallbackFamily('Noto Sans SC')
      const graph = editor.graph
      graph.updateNode(editor.state.currentPageId, {
        state: [
          { id: 'name', name: 'name', type: 'string', defaultValue: '绑定姓名：张三' },
          { id: 'plans', name: 'plans', type: 'array', defaultValue: ['团队'] }
        ]
      })
      const root = graph.createNode('FRAME', editor.state.currentPageId, {
        name: 'Lowcode initial appearance',
        width: 640,
        height: 672,
        clipsContent: true,
        fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, visible: true }]
      })
      const control = (
        type: SceneNode['type'],
        y: number,
        props: SceneNode['interactiveProps'],
        extra: Partial<SceneNode> = {}
      ) =>
        graph.createNode(type, root.id, {
          x: 16,
          y,
          width: 256,
          height: 44,
          fontSize: 16,
          fontFamily: 'Inter',
          paddingLeft: 12,
          paddingRight: 12,
          paddingTop: 4,
          paddingBottom: 4,
          interactiveProps: props,
          ...extra
        })
      control(
        'INPUT',
        16,
        { value: 'Stale literal', placeholder: '请输入姓名' },
        { bindings: { value: { kind: 'ref', stateId: 'name' } } }
      )
      control('INPUT', 80, { value: 'Example-密码123', inputType: 'password' })
      control(
        'CHECKBOX',
        144,
        { options: ['个人 Personal', '团队'], textColor: '#111827' },
        { height: 92, bindings: { value: { kind: 'ref', stateId: 'plans' } } }
      )
      control(
        'TEXTAREA',
        252,
        { value: '第一行\n第二行 Mixed text\n第三行', readOnly: true },
        { height: 104, paddingTop: 10, paddingBottom: 10 }
      )
      control(
        'CHECKBOX',
        386,
        { checked: true },
        { width: 28, height: 28, paddingLeft: 4, paddingRight: 4, paddingTop: 4, paddingBottom: 4 }
      )
      control(
        'CHECKBOX',
        386,
        { checked: true, disabled: true },
        {
          x: 64,
          width: 28,
          height: 28,
          paddingLeft: 4,
          paddingRight: 4,
          paddingTop: 4,
          paddingBottom: 4
        }
      )
      control(
        'INPUT',
        386,
        { value: 'Long single-line value must not wrap' },
        { x: 112, width: 160, height: 28 }
      )
      const accordion = graph.createNode('FRAME', root.id, {
        x: 304,
        y: 16,
        width: 320,
        height: 414,
        cornerRadius: 8,
        interactiveProps: { module: modules.accordion }
      })
      graph.createNode('FRAME', root.id, {
        x: 16,
        y: 476,
        width: 300,
        height: 160,
        interactiveProps: { module: modules.table }
      })
      for (const [index, module] of [
        modules.slideMenu,
        modules.dropdown,
        modules.upload
      ].entries()) {
        graph.createNode('FRAME', root.id, {
          x: 340,
          y: 476 + index * 60,
          width: 284,
          height: 48,
          interactiveProps: { module }
        })
      }
      await editor.loadFontsForNodes([root.id])
      editor.zoomToBounds(-24, -24, 664, 696)
      editor.requestRender()
      return { root: root.id, accordion: accordion.id }
    }, modules)
    const capture = async (name: string) => {
      await page.evaluate(() => window.openPencil.test?.navigation?.waitForSettlement())
      const live = await canvas.screenshotCanvas()
      expect(live).toMatchSnapshot(`${renderer}-lowcode-${name}-live.png`, { threshold: 0.2 })
      await info.attach(`${renderer}-${name}-live`, {
        body: live,
        contentType: 'image/png'
      })
      const png = await page.evaluate(async (id) => {
        const image = await window.openPencil.getStore().renderExportImage([id], 1, 'PNG')
        if (!image) throw new Error('Lowcode canvas export failed')
        return Array.from(image)
      }, ids.root)
      expect(Buffer.from(png)).toMatchSnapshot(`lowcode-${name}.png`, {
        maxDiffPixels: 0,
        threshold: 0.2
      })
      return png
    }
    const initial = await capture('initial')
    await page.evaluate(
      async ({ ids, module }) => {
        const editor = window.openPencil.getStore()
        editor.graph.updateNode(editor.state.currentPageId, {
          state: [
            { id: 'name', name: 'name', type: 'string', defaultValue: '更新后的姓名：李四' },
            { id: 'plans', name: 'plans', type: 'array', defaultValue: ['个人 Personal'] }
          ]
        })
        editor.graph.updateNode(ids.accordion, {
          interactiveProps: {
            module: { ...module, config: { ...module.config, initialOpenIds: ['details'] } }
          }
        })
        await editor.loadFontsForNodes([ids.root])
        editor.requestRender()
      },
      { ids, module }
    )
    const updated = await capture('updated')
    expect(updated).not.toEqual(initial)
    canvas.assertNoErrors()
  })
}
