import type { Page } from '@playwright/test'

import { expect, test } from '#tests/e2e/fixtures'
import { CanvasHelper } from '#tests/helpers/canvas'

async function setup(page: Page) {
  await page.goto('/?test')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  const ids = await page.evaluate(() => {
    const editor = window.openPencil.getStore()
    const graph = editor.graph
    graph.updateNode(editor.state.currentPageId, {
      state: [{ id: 'plan', name: 'plan', type: 'string', defaultValue: 'team' }]
    })
    const first = graph.createNode('SELECT', editor.state.currentPageId, {
      name: 'Plan select',
      width: 260,
      height: 44,
      interactiveProps: {
        options: [
          { label: 'Personal', value: 'personal' },
          { label: 'Team', value: 'team' }
        ],
        value: 'team'
      }
    })
    const second = graph.createNode('SELECT', editor.state.currentPageId, {
      name: 'Other select',
      y: 100,
      width: 260,
      height: 44,
      interactiveProps: { options: ['Other'], value: 'Other' }
    })
    editor.select([first.id])
    return { first: first.id, second: second.id }
  })
  const section = page.getByTestId('inspector-section-lowcode-control')
  await expect(section).toBeVisible()
  return { ...ids, section, canvas }
}

async function properties(page: Page, id: string) {
  return page.evaluate((id) => window.openPencil.getStore().graph.getNode(id)?.interactiveProps, id)
}

test('select option edits, ordering and defaults form undoable changes in the primary panel', async ({
  page
}) => {
  const { first, section, canvas } = await setup(page)
  await section.getByRole('textbox', { name: 'Submitted value 2', exact: true }).fill('company')
  await section.getByRole('textbox', { name: 'Submitted value 2', exact: true }).press('Enter')
  expect((await properties(page, first))?.value).toBe('company')
  await expect(section.getByRole('combobox', { name: 'Default selected', exact: true })).toHaveText(
    'Team (company)'
  )
  await page.evaluate(() => window.openPencil.getStore().undo.undo())
  await expect(
    section.getByRole('textbox', { name: 'Submitted value 2', exact: true })
  ).toHaveValue('team')
  await section.getByRole('button', { name: 'Move up 2', exact: true }).click()
  await expect(section.getByRole('textbox', { name: 'Display label 1', exact: true })).toHaveValue(
    'Team'
  )
  expect((await properties(page, first))?.value).toBe('team')
  await section.getByRole('button', { name: 'Remove option 1', exact: true }).click()
  expect((await properties(page, first))?.value).toBeUndefined()
  await section.getByRole('button', { name: 'Add option', exact: true }).click()
  await expect(section.locator('[data-property="lowcode-select-option"]')).toHaveCount(2)
  await page.getByTestId('design-panel-workspace-focused').click()
  await expect(section.getByRole('textbox', { name: 'Display label 1', exact: true })).toBeVisible()
  canvas.assertNoErrors()
})

test('clear, binding and dynamic-source feedback preserve options and business state', async ({
  page
}) => {
  const { first, section, canvas } = await setup(page)
  await section.getByRole('checkbox', { name: 'Allow clearing from the menu', exact: true }).click()
  expect(await properties(page, first)).toMatchObject({
    allowClear: true,
    placeholder: 'Select an option'
  })
  await section.getByTestId('lowcode-value-binding-select').selectOption('state:plan')
  await expect(
    section.getByRole('combobox', { name: 'Default selected', exact: true })
  ).toBeDisabled()
  await expect(section).toContainText('bound value takes priority')
  await page.evaluate((id) => {
    const editor = window.openPencil.getStore()
    const node = editor.graph.getNode(id)
    if (!node) throw new Error('Missing select')
    editor.updateNode(id, {
      interactiveProps: {
        ...node.interactiveProps,
        optionsSource: {
          kind: 'stateRef',
          stateId: 'options',
          itemName: 'item',
          valueExpr: 'item.value',
          labelExpr: 'item.label'
        }
      }
    })
  }, first)
  await expect(section).toContainText('Dynamic data supplies these options')
  await expect(section.locator('[data-property="lowcode-select-option"]')).toHaveCount(0)
  expect((await properties(page, first))?.options).toHaveLength(2)
  expect(
    await page.evaluate(
      () =>
        window.openPencil.getStore().graph.getNode(window.openPencil.getStore().state.currentPageId)
          ?.state?.[0].defaultValue
    )
  ).toBe('team')
  canvas.assertNoErrors()
})

test('search and virtual scrolling are independent opt-ins with undo and FIG persistence', async ({
  page
}) => {
  test.setTimeout(90000)
  const { first, second, section, canvas } = await setup(page)
  const search = section.getByRole('checkbox', { name: 'Search when expanded', exact: true })
  const virtual = section.getByRole('checkbox', { name: 'Virtual scrolling', exact: true })
  await expect(search).not.toBeChecked()
  await expect(virtual).not.toBeChecked()
  await expect(section).toContainText(
    'Search filters display labels without changing submitted values.'
  )
  await expect(section).toContainText(
    'For large lists. Render only the visible options while scrolling.'
  )
  const original = await properties(page, first)
  await search.click()
  expect(await properties(page, first)).toEqual({ ...original, showSearch: true })
  await virtual.click()
  expect(await properties(page, first)).toEqual({ ...original, showSearch: true, virtual: true })
  await page.evaluate(() => window.openPencil.getStore().undo.undo())
  await expect(search).toBeChecked()
  await expect(virtual).not.toBeChecked()
  expect(await properties(page, first)).toEqual({ ...original, showSearch: true })
  await page.evaluate(() => window.openPencil.getStore().undo.redo())
  await expect(virtual).toBeChecked()

  await page.evaluate((id) => window.openPencil.getStore().select([id]), second)
  await expect(search).not.toBeChecked()
  await expect(virtual).not.toBeChecked()
  expect(await properties(page, second)).toEqual({ options: ['Other'], value: 'Other' })
  await page.evaluate((id) => window.openPencil.getStore().select([id]), first)
  await expect(search).toBeChecked()
  await expect(virtual).toBeChecked()

  const restored = await page.evaluate(async () => {
    const editor = window.openPencil.getStore()
    const saved = await editor.buildFigFileSnapshot()
    await editor.openFigFile(new File([new Uint8Array(saved.data)], 'select-modes.fig'))
    const nodes = editor.graph.getChildren(editor.state.currentPageId)
    const node = nodes.find((candidate) => candidate.name === 'Plan select')
    const unchanged = nodes.find((candidate) => candidate.name === 'Other select')
    if (!node || !unchanged) throw new Error('Select nodes missing after FIG roundtrip')
    editor.select([node.id])
    return {
      id: node.id,
      type: node.type,
      properties: node.interactiveProps,
      unchanged: unchanged.interactiveProps
    }
  })
  expect(restored.type).toBe('SELECT')
  expect(restored.properties).toEqual({ ...original, showSearch: true, virtual: true })
  expect(restored.unchanged).toEqual({ options: ['Other'], value: 'Other' })
  await expect(search).toBeChecked()
  await expect(virtual).toBeChecked()
  await search.click()
  expect(await properties(page, restored.id)).toEqual({ ...original, virtual: true })
  await virtual.click()
  expect(await properties(page, restored.id)).toEqual(original)
  canvas.assertNoErrors()
})

test('duplicate values are explained and stale input cannot write to a newly selected node', async ({
  page
}) => {
  const { first, second, section, canvas } = await setup(page)
  const value = section.getByRole('textbox', { name: 'Submitted value 2', exact: true })
  await value.fill('personal')
  await value.press('Enter')
  await expect(section.getByRole('alert')).toContainText('values must be unique')
  await page.evaluate(() => window.openPencil.getStore().undo.undo())
  const input = section.getByRole('textbox', { name: 'Display label 1', exact: true })
  await input.fill('Old draft')
  await input.evaluate((element, id) => {
    window.openPencil.getStore().select([id])
    element.dispatchEvent(new Event('change', { bubbles: true }))
  }, second)
  await expect(input).toHaveValue('Other')
  expect((await properties(page, first))?.options).toEqual([
    { label: 'Personal', value: 'personal' },
    { label: 'Team', value: 'team' }
  ])
  expect((await properties(page, second))?.options).toEqual(['Other'])
  canvas.assertNoErrors()
})

test.describe('Chinese select settings', () => {
  test.use({
    storageState: {
      cookies: [],
      origins: [
        {
          origin: `http://localhost:${process.env.OPENPENCIL_TEST_PORT ?? '1420'}`,
          localStorage: [{ name: 'open-pencil-locale', value: 'zh-CN' }]
        }
      ]
    }
  })
  test('Chinese select settings keep empty values distinct and show localized clear instructions', async ({
    page
  }) => {
    await page.setViewportSize({ width: 1440, height: 1100 })
    const { first, section, canvas } = await setup(page)
    await page.evaluate((id) => {
      const editor = window.openPencil.getStore()
      editor.updateNode(id, {
        interactiveProps: {
          options: [
            { label: '全部', value: '' },
            { label: '团队', value: 'team' }
          ],
          value: ''
        }
      })
    }, first)
    await expect(section.getByRole('combobox', { name: '默认选中', exact: true })).toHaveText(
      '全部 (空值)'
    )
    await section.getByRole('checkbox', { name: '允许从菜单清空', exact: true }).click()
    expect((await properties(page, first))?.placeholder).toBe('请选择')
    await expect(section).toContainText('选择占位项即可清空值')
    await section.screenshot({ path: test.info().outputPath('select-panel-zh.png') })
    canvas.assertNoErrors()
  })

  test('Chinese search and virtualization labels explain filtering without changing selected values', async ({
    page
  }) => {
    const { first, section, canvas } = await setup(page)
    const original = await properties(page, first)
    const search = section.getByRole('checkbox', { name: '展开后搜索', exact: true })
    const virtual = section.getByRole('checkbox', { name: '虚拟滚动', exact: true })
    await expect(search).not.toBeChecked()
    await expect(virtual).not.toBeChecked()
    await expect(section).toContainText('按显示文字搜索和筛选，不改变提交值。')
    await expect(section).toContainText('适用于大列表，滚动时只渲染可见选项。')
    await virtual.click()
    expect(await properties(page, first)).toEqual({ ...original, virtual: true })
    await search.click()
    expect(await properties(page, first)).toEqual({ ...original, virtual: true, showSearch: true })
    await section.getByTestId('lowcode-value-binding-select').selectOption('state:plan')
    await expect(section.getByRole('combobox', { name: '默认选中', exact: true })).toBeDisabled()
    await search.click()
    expect(await properties(page, first)).toEqual({ ...original, virtual: true })
    expect(
      await page.evaluate((id) => {
        const editor = window.openPencil.getStore()
        return {
          binding: editor.graph.getNode(id)?.bindings?.value,
          value: editor.graph.getNode(editor.state.currentPageId)?.state?.[0].defaultValue
        }
      }, first)
    ).toEqual({ binding: { kind: 'ref', stateId: 'plan' }, value: 'team' })
    canvas.assertNoErrors()
  })
})

test('form overview reveals the select binding in its new primary section', async ({ page }) => {
  const { first, section, canvas } = await setup(page)
  const formId = await page.evaluate((id) => {
    const editor = window.openPencil.getStore()
    const form = editor.graph.createNode('FORM', editor.state.currentPageId, {
      width: 400,
      height: 200
    })
    editor.graph.reparentNode(id, form.id)
    return form.id
  }, first)
  await page.getByTestId('design-panel-workspace-studio').click()
  await page.getByTestId('inspector-section-hide-lowcode-control').click()
  await expect(section).not.toBeVisible()
  await page.evaluate((id) => window.openPencil.getStore().select([id]), formId)
  await page.getByTestId('form-overview-bindings').click()
  await expect(section).toBeVisible()
  await expect(section.getByTestId('lowcode-value-binding-select')).toBeFocused()
  canvas.assertNoErrors()
})

test('external reorder discards a draft even when option labels are identical', async ({
  page
}) => {
  const { first, section, canvas } = await setup(page)
  await page.evaluate(
    (id) =>
      window.openPencil.getStore().updateNode(id, {
        interactiveProps: {
          options: [
            { label: 'Same', value: 'first' },
            { label: 'Same', value: 'second' }
          ]
        }
      }),
    first
  )
  const label = section.getByRole('textbox', { name: 'Display label 1', exact: true })
  await label.fill('Old option draft')
  await label.evaluate((element, id) => {
    window.openPencil.getStore().updateNode(id, {
      interactiveProps: {
        options: [
          { label: 'Same', value: 'second' },
          { label: 'Same', value: 'first' }
        ]
      }
    })
    element.dispatchEvent(new Event('change', { bubbles: true }))
  }, first)
  await expect(label).toHaveValue('Same')
  await label.press('Enter')
  expect((await properties(page, first))?.options).toEqual([
    { label: 'Same', value: 'second' },
    { label: 'Same', value: 'first' }
  ])
  canvas.assertNoErrors()
})
