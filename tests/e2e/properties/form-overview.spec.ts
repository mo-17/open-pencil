import { expect, test, useEditorSetupWithClear } from '#tests/e2e/fixtures'

const editor = useEditorSetupWithClear('/?test')

async function createForm() {
  const ids = await editor.page.evaluate(() => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('Editor unavailable')
    store.graph.updateNode(store.graph.rootId, {
      lowcodeDocumentState: [{ id: 'profile', name: 'profile', type: 'object', defaultValue: {} }]
    })
    const form = store.graph.createNode('FORM', store.state.currentPageId, {
      name: 'Profile form',
      x: 140,
      y: 100,
      width: 320,
      height: 220,
      events: {
        onSubmit: [
          {
            id: 'condition',
            kind: 'condition',
            condExpr: '1 === 1',
            consequent: [
              {
                id: 'request',
                kind: 'apiCall',
                url: '/api/profile',
                method: 'POST',
                targetName: 'profile'
              }
            ]
          }
        ]
      }
    })
    const field = store.graph.createNode('INPUT', form.id, {
      name: 'Email',
      x: 16,
      y: 20,
      width: 280,
      height: 36,
      interactiveProps: { validation: { required: true, async: { url: '/api/check-email' } } }
    })
    const button = store.graph.createNode('BUTTON', form.id, {
      name: 'Save click action',
      x: 16,
      y: 80,
      width: 140,
      height: 36,
      events: { onClick: [{ id: 'click', kind: 'toast', messageExpr: '"Clicked"' }] }
    })
    store.select([form.id])
    return { form: form.id, field: field.id, button: button.id }
  })
  await editor.canvas.waitForRender()
  return ids
}

test('overview reveals existing controls and nested failure actions without modifying the graph', async () => {
  const ids = await createForm()
  const panel = editor.page.getByTestId('lowcode-form-overview')
  await expect(panel).toBeVisible()
  await expect(editor.page.getByTestId('form-overview-bindings')).toContainText('0/1')
  await expect(editor.page.getByTestId('form-overview-validation')).toContainText('1/1')
  await panel.locator('summary').click()
  await expect(editor.page.getByTestId('form-overview-async')).toContainText('Vue export blocks')
  await expect(editor.page.getByTestId('form-overview-retention')).toContainText(
    'depends on the authored actions'
  )
  await expect(editor.page.getByTestId('form-overview-click-warning')).toContainText(
    'actions are not protected'
  )
  await panel.locator('summary').click()
  await editor.page.screenshot({ path: test.info().outputPath('form-overview-en.png') })
  const before = await editor.page.evaluate(() => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

    const store = window.openPencil?.getStore?.()
    return JSON.stringify(store?.graph.getAllNodes())
  })

  await editor.page.locator('[data-slot="inspector-workspace"][data-workspace="focused"]').click()
  await editor.page.getByTestId('form-overview-bindings').click()
  await expect(editor.page.getByTestId('lowcode-value-binding-select')).toBeDisabled()
  await expect(editor.page.getByTestId('lowcode-value-binding-create')).toBeFocused()
  await expect(editor.page.getByTestId('lowcode-value-binding-create')).toBeVisible()
  await editor.page.getByTestId('form-overview-validation').click()
  await expect(editor.page.getByTestId('lowcode-validation-required')).toBeFocused()
  await editor.page.getByTestId('form-overview-submit').click()
  await expect(editor.page.getByTestId('lowcode-events-section')).toBeVisible()
  // The form is already selected here: navigation must also work without mounting EventsPanel.
  await editor.page.getByTestId('form-overview-failure').click()
  await expect(
    editor.page.locator('[data-lowcode-action-path="onSubmit[0]/consequent[0]"]')
  ).toBeFocused()
  await expect(
    editor.page.locator('[data-lowcode-action-path="onSubmit[0]/consequent[0]"]')
  ).toHaveAttribute('data-lowcode-focus-highlighted', 'true')
  await editor.page
    .getByTestId('form-overview-click-warning')
    .getByRole('button', { name: 'Save click action' })
    .click()
  await expect(editor.page.locator('[data-lowcode-action-path="onClick[0]"]')).toBeFocused()

  await editor.page.evaluate((formId) => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
    return window.openPencil?.getStore?.().select([formId])
  }, ids.form)
  await expect(editor.page.getByTestId('inspector-section-lowcode-events')).not.toBeVisible()
  const after = await editor.page.evaluate(() => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
    return JSON.stringify(window.openPencil?.getStore?.().graph.getAllNodes())
  })
  expect(after).toBe(before)
  editor.canvas.assertNoErrors()
})

test('document switching clears temporary reveals, and Chinese copy fits the inspector', async () => {
  await editor.page.evaluate(async () => {
    const cache = await import(new URL('/src/app/cache/index.ts', window.location.origin).href)
    cache.writeLocalStorageText('open-pencil-locale', 'zh-CN')
  })
  await editor.page.reload()
  await editor.canvas.waitForInit()
  await createForm()
  const panel = editor.page.getByTestId('lowcode-form-overview')
  await expect(panel).toContainText('表单配置')
  await expect(editor.page.getByTestId('form-overview-click-warning')).toContainText(
    '不受表单提交时校验保护'
  )
  await editor.page.screenshot({ path: test.info().outputPath('form-overview-zh.png') })
  await editor.page.locator('[data-slot="inspector-workspace"][data-workspace="focused"]').click()
  await editor.page.getByTestId('form-overview-submit').click()
  await expect(editor.page.getByTestId('lowcode-events-section')).toBeVisible()
  const previousId = await editor.page.evaluate(async () => {
    const tabs = await import('/src/app/tabs/index.ts')
    const previous = tabs.getActiveTabId()
    tabs.createTab()
    return previous
  })
  await expect(panel).toHaveCount(0)
  await createForm()
  await expect(editor.page.getByTestId('inspector-section-lowcode-events')).not.toBeVisible()
  await editor.page.evaluate(async (id) => {
    const tabs = await import('/src/app/tabs/index.ts')
    tabs.switchTab(id)
  }, previousId)
  await expect(panel).toBeVisible()
  await expect(editor.page.getByTestId('inspector-section-lowcode-events')).not.toBeVisible()
  editor.canvas.assertNoErrors()
})
