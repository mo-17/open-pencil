import { expect, test, useEditorSetupWithClear } from '#tests/e2e/fixtures'

const editor = useEditorSetupWithClear()

function validationPanel() {
  return editor.page.getByTestId('lowcode-validation')
}

function selectedLowcodeProps() {
  return editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const id = [...store.state.selectedIds][0]
    if (!id) return null
    const node = store.graph.getNode(id)
    if (!node) return null
    return {
      bindings: node.bindings,
      interactiveProps: node.interactiveProps
    }
  })
}

async function selectInputWithValueBinding() {
  await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    store.graph.updateNode(store.graph.rootId, {
      lowcodeDocumentState: [{ id: 'doc-email', name: 'email', type: 'string', defaultValue: '' }]
    })
    const id = store.createShape('INPUT', 120, 120, 220, 36)
    store.graph.updateNode(id, {
      bindings: { value: { kind: 'docState', docStateName: 'email' } }
    })
    store.select([id])
    store.state.sceneVersion++
  })
  await editor.canvas.waitForRender()
}

async function selectForm() {
  await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const id = store.createShape('FORM', 120, 120, 320, 200)
    store.select([id])
    store.state.sceneVersion++
  })
  await editor.canvas.waitForRender()
}

async function selectValidatedInputWithoutBinding() {
  await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const id = store.createShape('INPUT', 120, 120, 220, 36)
    store.graph.updateNode(id, {
      name: 'WarningEmailInput',
      interactiveProps: {
        placeholder: 'Email',
        value: '',
        validation: { required: true }
      }
    })
    store.select([id])
    store.state.sceneVersion++
  })
  await editor.canvas.waitForRender()
}

async function selectInputWithoutBinding() {
  await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const id = store.createShape('INPUT', 120, 120, 220, 36)
    store.graph.updateNode(id, { name: 'FreshEmailInput' })
    store.select([id])
    store.state.sceneVersion++
  })
  await editor.canvas.waitForRender()
}

async function selectInputWithInvalidBinding() {
  await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const id = store.createShape('INPUT', 120, 120, 220, 36)
    store.graph.updateNode(id, {
      name: 'BrokenEmailInput',
      bindings: { value: { kind: 'ref', stateId: 'missing-state' } },
      interactiveProps: { value: '', validation: { required: true } }
    })
    store.select([id])
    store.state.sceneVersion++
  })
  await editor.canvas.waitForRender()
}

async function selectDynamicCheckbox() {
  await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const page = store.graph.getNode(store.state.currentPageId)
    if (!page) throw new Error('Current page not found')
    store.graph.updateNode(page.id, {
      state: [
        { id: 'enabled', name: 'enabled', type: 'boolean', defaultValue: false },
        { id: 'tags', name: 'tags', type: 'array', defaultValue: [] }
      ]
    })
    const id = store.createShape('CHECKBOX', 120, 120, 220, 36)
    store.graph.updateNode(id, {
      name: 'TagsCheckbox',
      interactiveProps: {
        optionsSource: { kind: 'ref', stateId: 'available-tags' },
        validation: { required: true }
      }
    })
    store.select([id])
    store.state.sceneVersion++
  })
  await editor.canvas.waitForRender()
}

async function selectValidatedInputInsideComponentMaster() {
  await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const page = store.graph.getNode(store.state.currentPageId)
    if (!page) throw new Error('Current page not found')
    store.graph.updateNode(page.id, {
      state: [{ id: 'page-email', name: 'pageEmail', type: 'string', defaultValue: '' }]
    })
    store.graph.updateNode(store.graph.rootId, {
      lowcodeDocumentState: [
        { id: 'document-email', name: 'documentEmail', type: 'string', defaultValue: '' }
      ]
    })
    const master = store.graph.createNode('COMPONENT', page.id, {
      name: 'EmailFieldMaster',
      x: 120,
      y: 120,
      width: 240,
      height: 80
    })
    const input = store.graph.createNode('INPUT', master.id, {
      name: 'EmailInput',
      width: 220,
      height: 36,
      interactiveProps: {
        placeholder: 'Email',
        value: '',
        validation: { required: true }
      }
    })
    store.select([input.id])
    store.state.sceneVersion++
  })
  await editor.canvas.waitForRender()
}

async function fillAndCommit(testId: string, value: string) {
  const input = editor.page.getByTestId(testId)
  await input.scrollIntoViewIfNeeded()
  await input.fill(value)
  await input.press('Tab')
  await editor.canvas.waitForRender()
}

test('validation panel writes field rules to a value-bound input', async () => {
  await selectInputWithValueBinding()

  await expect(validationPanel()).toBeVisible()
  await editor.page.getByTestId('lowcode-validation-required').check()
  await editor.canvas.waitForRender()
  await fillAndCommit('lowcode-validation-min-length', '3')
  await fillAndCommit('lowcode-validation-max-length', '64')
  await fillAndCommit('lowcode-validation-pattern', '^[^@]+@example\\.com$')
  await fillAndCommit('lowcode-validation-custom-expr', 'email.includes("@")')
  await fillAndCommit('lowcode-validation-message-required', 'Email is required')
  await fillAndCommit('lowcode-validation-message-pattern', 'Use an example.com email')
  await fillAndCommit('lowcode-validation-message-custom', 'Email must contain @')

  await editor.page.getByTestId('lowcode-validation-async-enabled').check()
  await editor.canvas.waitForRender()
  await fillAndCommit('lowcode-validation-async-url', '/api/check-email')
  await fillAndCommit('lowcode-validation-async-message', 'Email is already taken')
  await editor.page.getByTestId('lowcode-validation-async-method').selectOption('GET')
  await editor.canvas.waitForRender()

  expect(await selectedLowcodeProps()).toEqual({
    bindings: { value: { kind: 'docState', docStateName: 'email' } },
    interactiveProps: {
      placeholder: 'Enter text',
      value: '',
      validation: {
        required: true,
        minLength: 3,
        maxLength: 64,
        pattern: '^[^@]+@example\\.com$',
        customExpr: 'email.includes("@")',
        messages: {
          required: 'Email is required',
          pattern: 'Use an example.com email',
          custom: 'Email must contain @'
        },
        async: {
          method: 'GET',
          url: '/api/check-email',
          message: 'Email is already taken'
        }
      }
    }
  })
  editor.canvas.assertNoErrors()
})

test('validation panel clears field rules when controls are emptied', async () => {
  await selectInputWithValueBinding()

  await editor.page.getByTestId('lowcode-validation-required').check()
  await editor.canvas.waitForRender()
  await fillAndCommit('lowcode-validation-min-length', '2')
  await fillAndCommit('lowcode-validation-message-required', 'Required')
  await editor.page.getByTestId('lowcode-validation-async-enabled').check()
  await editor.canvas.waitForRender()

  await editor.page.getByTestId('lowcode-validation-required').uncheck()
  await editor.canvas.waitForRender()
  await fillAndCommit('lowcode-validation-min-length', '')
  await fillAndCommit('lowcode-validation-message-required', '')
  await editor.page.getByTestId('lowcode-validation-async-enabled').uncheck()
  await editor.canvas.waitForRender()

  expect(await selectedLowcodeProps()).toEqual({
    bindings: { value: { kind: 'docState', docStateName: 'email' } },
    interactiveProps: { placeholder: 'Enter text', value: '' }
  })
  editor.canvas.assertNoErrors()
})

test('validation panel writes form error summary settings', async () => {
  await selectForm()

  await expect(validationPanel()).toBeVisible()
  await editor.page.getByTestId('lowcode-validation-summary-enabled').check()
  await editor.canvas.waitForRender()
  await fillAndCommit('lowcode-validation-summary-title', 'Fix these fields')

  expect(await selectedLowcodeProps()).toEqual({
    bindings: undefined,
    interactiveProps: {
      validationSummary: { enabled: true, title: 'Fix these fields' }
    }
  })

  await editor.page.getByTestId('lowcode-validation-summary-enabled').uncheck()
  await editor.canvas.waitForRender()
  expect(await selectedLowcodeProps()).toEqual({
    bindings: undefined,
    interactiveProps: {}
  })
  editor.canvas.assertNoErrors()
})

test('validated control can create matching page state and value binding in one action', async () => {
  await selectValidatedInputWithoutBinding()

  const create = editor.page.getByTestId('lowcode-value-binding-create')
  await expect(create).toHaveText('Create page state and bind')
  await create.click()
  await editor.canvas.waitForRender()

  const result = await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const id = [...store.state.selectedIds][0]
    const page = store.graph.getNode(store.state.currentPageId)
    return {
      binding: id ? store.graph.getNode(id)?.bindings?.value : undefined,
      state: page?.state
    }
  })
  expect(result).toEqual({
    binding: { kind: 'ref', stateId: expect.any(String) },
    state: [
      {
        id: expect.any(String),
        name: 'warningEmail',
        type: 'string',
        defaultValue: ''
      }
    ]
  })
  expect(result.binding?.stateId).toBe(result.state?.[0]?.id)
  await expect(create).toHaveCount(0)
  editor.canvas.assertNoErrors()
})

test('unbound control can configure validation before creating its state binding', async () => {
  await selectInputWithoutBinding()

  const required = editor.page.getByTestId('lowcode-validation-required')
  await expect(required).toBeVisible()
  await required.check()
  await editor.canvas.waitForRender()

  expect(await selectedLowcodeProps()).toMatchObject({
    bindings: undefined,
    interactiveProps: { validation: { required: true } }
  })
  const create = editor.page.getByTestId('lowcode-value-binding-create')
  await expect(create).toBeVisible()
  await create.click()
  await editor.canvas.waitForRender()
  expect(await selectedLowcodeProps()).toMatchObject({
    bindings: { value: { kind: 'ref', stateId: expect.any(String) } },
    interactiveProps: { validation: { required: true } }
  })
  editor.canvas.assertNoErrors()
})

test('invalid binding stays explicit and can be cleared when no candidates exist', async () => {
  await selectInputWithInvalidBinding()

  const source = editor.page.getByTestId('lowcode-value-binding-select')
  await expect(source).toBeEnabled()
  await expect(source.locator('option:checked')).toHaveText(
    'Invalid binding — choose Uncontrolled or another state'
  )
  await source.selectOption('')
  await editor.canvas.waitForRender()

  expect(await selectedLowcodeProps()).toMatchObject({ bindings: {} })
  await expect(editor.page.getByTestId('lowcode-value-binding-create')).toBeVisible()
  editor.canvas.assertNoErrors()
})

test('dynamic checkbox options expose array states instead of boolean states', async () => {
  await selectDynamicCheckbox()

  const source = editor.page.getByTestId('lowcode-value-binding-select')
  await expect(source.locator('option[value="state:tags"]')).toHaveCount(1)
  await expect(source.locator('option[value="state:enabled"]')).toHaveCount(0)
  editor.canvas.assertNoErrors()
})

test('component-master controls cannot create or select page-state bindings', async () => {
  await selectValidatedInputInsideComponentMaster()

  await expect(editor.page.getByTestId('lowcode-value-binding-create')).toHaveCount(0)
  await expect(editor.page.getByTestId('lowcode-value-binding-component-unsupported')).toBeVisible()
  const source = editor.page.getByTestId('lowcode-value-binding-select')
  await expect(source.locator('option[value="state:page-email"]')).toHaveCount(0)
  await expect(source.locator('option[value="doc:documentEmail"]')).toHaveCount(1)

  await source.selectOption('doc:documentEmail')
  await editor.canvas.waitForRender()
  expect(await selectedLowcodeProps()).toMatchObject({
    bindings: { value: { kind: 'docState', docStateName: 'documentEmail' } },
    interactiveProps: { validation: { required: true } }
  })
  editor.canvas.assertNoErrors()
})
