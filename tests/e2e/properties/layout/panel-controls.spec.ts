import { expect, test, type Page } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

test.describe.configure({ timeout: 30_000 })

test.beforeEach(async ({ page }) => {
  await page.goto('/?test')
  await new CanvasHelper(page).waitForInit()
})

const layoutSection = (page: Page) => page.getByRole('region', { name: /^(Auto layout|Layout)$/ })

async function selectedLayoutMode(page: Page) {
  return page.evaluate(() => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
    return window.openPencil?.getStore?.().selectedNode.value?.layoutMode
  })
}

async function snapshotNodes(page: Page, ids: string[]) {
  return page.evaluate((ids) => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

    const editor = window.openPencil?.getStore?.()
    if (!editor) throw new Error('Editor unavailable')
    return ids.map((id) => JSON.stringify(editor.graph.getNode(id)))
  }, ids)
}

async function createSiblingFrames(page: Page) {
  return page.evaluate(() => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

    const editor = window.openPencil?.getStore?.()
    if (!editor) throw new Error('Editor unavailable')
    const ids = [100, 300].map((x) => {
      const node = editor.graph.createNode('FRAME', editor.state.currentPageId, {
        x,
        width: 160,
        height: 120,
        layoutMode: 'VERTICAL'
      })
      editor.graph.createNode('RECTANGLE', node.id, { width: 80, height: 40 })
      return node.id
    })
    editor.select([ids[0]])
    return ids
  })
}

for (const type of ['FORM', 'LIST', 'FRAME'] as const) {
  test(`${type} exposes active auto layout controls with undoable direction and toggle`, async ({
    page
  }, testInfo) => {
    await page.evaluate((type) => {
      if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

      const editor = window.openPencil?.getStore?.()
      if (!editor) throw new Error('Editor unavailable')
      const node = editor.graph.createNode(type, editor.state.currentPageId, {
        name: `${type} layout`,
        x: 100,
        y: 100,
        width: 320,
        height: 200,
        layoutMode: 'VERTICAL'
      })
      editor.graph.createNode('RECTANGLE', node.id, { width: 80, height: 40 })
      editor.select([node.id])
    }, type)
    const layout = layoutSection(page)
    const toggle = layout.getByRole('switch', { name: 'Auto layout', exact: true })
    await expect(toggle).toBeChecked()
    const flow = layout.getByRole('group', { name: 'Flow', exact: true })
    await expect(flow).toBeVisible()
    for (const label of ['Freeform', 'Vertical layout', 'Horizontal layout', 'Grid layout']) {
      const button = flow.getByRole('button', { name: label, exact: true })
      await expect(button).toContainText(label)
      await expect
        .poll(() =>
          button.getByText(label, { exact: true }).evaluate((element) => {
            const text = element.getBoundingClientRect()
            const container = element.closest('button')?.getBoundingClientRect()
            return (
              container !== undefined &&
              element.scrollWidth <= element.clientWidth + 1 &&
              text.left >= container.left &&
              text.right <= container.right
            )
          })
        )
        .toBe(true)
    }
    if (type === 'FORM') await layout.screenshot({ path: testInfo.outputPath('form-en-dark.png') })

    await flow.getByRole('button', { name: 'Horizontal layout', exact: true }).click()
    await expect.poll(() => selectedLayoutMode(page)).toBe('HORIZONTAL')
    await toggle.click()
    await expect(toggle).not.toBeChecked()
    await expect.poll(() => selectedLayoutMode(page)).toBe('NONE')
    await page.evaluate(() => {
      if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
      return window.openPencil?.getStore?.().undoAction()
    })
    await expect(toggle).toBeChecked()
    await expect.poll(() => selectedLayoutMode(page)).toBe('HORIZONTAL')
    await page.evaluate(() => {
      if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
      return window.openPencil?.getStore?.().undoAction()
    })
    await expect.poll(() => selectedLayoutMode(page)).toBe('VERTICAL')

    await toggle.focus()
    await page.keyboard.press('Space')
    await expect.poll(() => selectedLayoutMode(page)).toBe('NONE')
    await page.keyboard.press('Space')
    await expect(toggle).toBeChecked()
    await expect.poll(() => selectedLayoutMode(page)).toBe('VERTICAL')
  })
}

for (const type of ['INPUT', 'TEXTAREA'] as const) {
  test(`${type} explains inherited layout and selects its parent without exposing container controls`, async ({
    page
  }, testInfo) => {
    const { parentId, fieldId } = await page.evaluate((type) => {
      if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

      const editor = window.openPencil?.getStore?.()
      if (!editor) throw new Error('Editor unavailable')
      const parent = editor.graph.createNode('FRAME', editor.state.currentPageId, {
        name: 'Field group',
        width: 320,
        height: 240,
        layoutMode: 'VERTICAL',
        counterAxisAlign: 'STRETCH'
      })
      const field = editor.graph.createNode(type, parent.id, { width: 320, height: 44 })
      editor.select([field.id])
      return { parentId: parent.id, fieldId: field.id }
    }, type)
    const layout = layoutSection(page)
    const hint = layout.getByText(
      'The parent uses auto layout. Select it to edit flow and alignment.',
      { exact: true }
    )
    await expect(hint).toBeVisible()
    await expect(layout.getByRole('switch', { name: 'Auto layout', exact: true })).toHaveCount(0)
    await expect(layout.getByRole('group', { name: 'Flow', exact: true })).toHaveCount(0)
    for (const axis of ['Width', 'Height']) {
      await expect(layout.getByRole('combobox', { name: axis, exact: true })).toBeVisible()
    }
    if (type === 'INPUT')
      await layout.screenshot({ path: testInfo.outputPath('input-en-dark.png') })

    const before = await snapshotNodes(page, [parentId, fieldId])
    await layout.getByRole('button', { name: 'Select parent', exact: true }).click()
    await expect
      .poll(() =>
        page.evaluate(() => {
          if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
          return window.openPencil?.getStore?.().selectedNode.value?.id
        })
      )
      .toBe(parentId)
    await expect(layout.getByRole('switch', { name: 'Auto layout', exact: true })).toBeChecked()
    expect(await snapshotNodes(page, [parentId, fieldId])).toEqual(before)

    await page.evaluate(
      ({ parentId, fieldId }) => {
        if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

        const editor = window.openPencil?.getStore?.()
        if (!editor) throw new Error('Editor unavailable')
        editor.setLayoutMode(parentId, 'NONE')
        editor.select([fieldId])
      },
      { parentId, fieldId }
    )
    await expect(hint).toHaveCount(0)
    await expect(layout.getByRole('button', { name: 'Select parent', exact: true })).toHaveCount(0)
    await expect(layout.getByRole('switch', { name: 'Auto layout', exact: true })).toHaveCount(0)
  })
}

test('Fixed, Hug and Fill remain visible while opening either sizing menu does not edit nodes', async ({
  page
}) => {
  const ids = await page.evaluate(() => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

    const editor = window.openPencil?.getStore?.()
    if (!editor) throw new Error('Editor unavailable')
    const parent = editor.graph.createNode('FRAME', editor.state.currentPageId, {
      width: 320,
      height: 240,
      layoutMode: 'VERTICAL'
    })
    const child = editor.graph.createNode('FRAME', parent.id, {
      width: 100,
      height: 40,
      layoutMode: 'VERTICAL',
      primaryAxisSizing: 'HUG',
      counterAxisSizing: 'FILL'
    })
    editor.graph.createNode('RECTANGLE', child.id, { width: 80, height: 40 })
    editor.runLayoutForNode(parent.id)
    editor.select([parent.id])
    return { parent: parent.id, child: child.id }
  })
  const layout = layoutSection(page)
  const width = layout.getByRole('combobox', { name: 'Width', exact: true })
  const height = layout.getByRole('combobox', { name: 'Height', exact: true })
  await expect(width).toHaveText('Fixed')
  await expect(height).toHaveText('Fixed')
  await page.evaluate((id) => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
    return window.openPencil?.getStore?.().select([id])
  }, ids.child)
  await expect(width).toHaveText('Fill')
  await expect(height).toHaveText('Hug')
  const before = await snapshotNodes(page, [ids.parent, ids.child])
  for (const trigger of [width, height]) {
    await trigger.click()
    await expect(page.getByRole('option', { name: 'Fixed', exact: true })).toBeVisible()
    expect(await snapshotNodes(page, [ids.parent, ids.child])).toEqual(before)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('listbox')).toHaveCount(0)
  }
  expect(await snapshotNodes(page, [ids.parent, ids.child])).toEqual(before)
})

test('changing the selected node closes its sizing menu without applying a stale choice', async ({
  page
}) => {
  const ids = await createSiblingFrames(page)
  const before = await snapshotNodes(page, ids)
  const width = layoutSection(page).getByRole('combobox', { name: 'Width', exact: true })
  await width.click()
  await expect(page.getByRole('option', { name: 'Hug', exact: true })).toBeVisible()
  await page.evaluate((id) => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
    return window.openPencil?.getStore?.().select([id])
  }, ids[1])
  await expect(page.getByRole('listbox')).toHaveCount(0)
  await expect(width).toHaveAttribute('aria-expanded', 'false')
  expect(await snapshotNodes(page, ids)).toEqual(before)

  await width.click()
  await page.getByRole('option', { name: 'Hug', exact: true }).click()
  await expect(width).toHaveText('Hug')
  expect((await snapshotNodes(page, [ids[0]]))[0]).toBe(before[0])
  await page.evaluate(() => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
    return window.openPencil?.getStore?.().undoAction()
  })
  await expect(width).toHaveText('Fixed')
  expect((await snapshotNodes(page, [ids[0]]))[0]).toBe(before[0])
  expect(
    await page.evaluate((id) => {
      if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

      const node = window.openPencil?.getStore?.().graph.getNode(id)
      if (!node) throw new Error('Frame unavailable')
      return {
        width: node.width,
        height: node.height,
        layoutMode: node.layoutMode,
        primaryAxisSizing: node.primaryAxisSizing,
        counterAxisSizing: node.counterAxisSizing
      }
    }, ids[1])
  ).toEqual({
    width: 160,
    height: 120,
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'FIXED',
    counterAxisSizing: 'FIXED'
  })
})

test('a queued sizing option cannot write to a node selected during its pointer event', async ({
  page
}) => {
  const ids = await createSiblingFrames(page)
  const before = await snapshotNodes(page, ids)
  await layoutSection(page).getByRole('combobox', { name: 'Width', exact: true }).click()
  const option = page.getByRole('option', { name: 'Hug', exact: true })
  await expect(option).toBeVisible()
  await option.evaluate((element, nextId) => {
    // Reka selects on pointerup. Change the target before its queued handler runs.
    element.addEventListener(
      'pointerup',
      () => {
        if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
        return window.openPencil?.getStore?.().select([nextId])
      },
      {
        capture: true,
        once: true
      }
    )
  }, ids[1])
  await option.click()
  await expect
    .poll(() =>
      page.evaluate(() => {
        if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
        return window.openPencil?.getStore?.().selectedNode.value?.id
      })
    )
    .toBe(ids[1])
  await expect(page.getByRole('listbox')).toHaveCount(0)
  expect(await snapshotNodes(page, ids)).toEqual(before)
})

test('FREE keeps auto layout off and Freeform selected without rewriting the node', async ({
  page
}) => {
  const id = await page.evaluate(() => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

    const editor = window.openPencil?.getStore?.()
    if (!editor) throw new Error('Editor unavailable')
    const node = editor.graph.createNode('FRAME', editor.state.currentPageId, {
      width: 320,
      height: 200,
      layoutMode: 'FREE'
    })
    editor.select([node.id])
    return node.id
  })
  const before = await snapshotNodes(page, [id])
  const layout = layoutSection(page)
  await expect(layout.getByRole('switch', { name: 'Auto layout', exact: true })).not.toBeChecked()
  await expect(layout.getByRole('button', { name: 'Freeform', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await layout.getByRole('combobox', { name: 'Width', exact: true }).click()
  await expect(page.getByRole('option', { name: 'Fixed', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect.poll(() => selectedLayoutMode(page)).toBe('FREE')
  expect(await snapshotNodes(page, [id])).toEqual(before)
})

test.describe('Chinese labels in light theme', () => {
  test.use({
    colorScheme: 'light',
    storageState: async ({ baseURL }, use) => {
      if (!baseURL) throw new Error('Layout panel tests require a baseURL')
      await use({
        cookies: [],
        origins: [
          {
            origin: new URL(baseURL).origin,
            localStorage: [
              { name: 'open-pencil-locale', value: 'zh-CN' },
              { name: 'open-pencil:theme', value: 'light' }
            ]
          }
        ]
      })
    }
  })

  test('translated parent guidance leads to the translated layout controls', async ({
    page
  }, testInfo) => {
    await page.evaluate(() => {
      if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

      const editor = window.openPencil?.getStore?.()
      if (!editor) throw new Error('Editor unavailable')
      const parent = editor.graph.createNode('FORM', editor.state.currentPageId, {
        width: 320,
        height: 200,
        layoutMode: 'VERTICAL'
      })
      const child = editor.graph.createNode('INPUT', parent.id, { width: 240, height: 44 })
      editor.select([child.id])
    })
    const layout = page.getByRole('region', { name: '布局', exact: true })
    await expect(
      layout.getByText('父容器使用自动布局。选择父容器可修改流向和对齐设置。', { exact: true })
    ).toBeVisible()
    await expect(layout.getByRole('combobox', { name: '宽度', exact: true })).toHaveText('固定')
    await layout.screenshot({ path: testInfo.outputPath('input-zh-light.png') })
    await layout.getByRole('button', { name: '选择父容器', exact: true }).click()
    const formLayout = page.getByRole('region', { name: '自动布局', exact: true })
    await expect(formLayout.getByRole('switch', { name: '自动布局', exact: true })).toBeChecked()
    await expect(formLayout.getByRole('button', { name: '水平布局', exact: true })).toContainText(
      '水平布局'
    )
    await formLayout.screenshot({ path: testInfo.outputPath('form-zh-light.png') })
  })
})
