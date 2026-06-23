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
