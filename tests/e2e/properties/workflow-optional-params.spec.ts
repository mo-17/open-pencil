import { expect, test, useEditorSetupWithClear } from '#tests/e2e/fixtures'

const editor = useEditorSetupWithClear()

async function setupWorkflowWithCaller() {
  return editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const page = store.graph.getNode(store.state.currentPageId)
    if (!page) throw new Error('Current page not found')

    store.graph.updateNode(store.graph.rootId, {
      lowcodeWorkflows: [
        {
          id: 'wf-notify',
          name: 'Notify',
          params: ['msg', 'detail'],
          actions: [{ id: 'toast', kind: 'toast', messageExpr: 'msg', variant: 'info' }]
        }
      ]
    })

    const button = store.graph.createNode('BUTTON', page.id, {
      name: 'Submit',
      x: 120,
      y: 120,
      width: 140,
      height: 40,
      events: {
        onClick: [{ id: 'cw', kind: 'callWorkflow', workflowId: 'wf-notify' }]
      }
    })
    store.select([])
    store.requestRender()
    return { buttonId: button.id }
  })
}

async function workflowSnapshot() {
  return editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    return store.graph.getNode(store.graph.rootId)?.lowcodeWorkflows ?? []
  })
}

test('workflow panel authors optional callWorkflow params', async () => {
  const { buttonId } = await setupWorkflowWithCaller()
  await editor.canvas.waitForRender()

  const workflowsPanel = editor.page.getByTestId('lowcode-workflows-section')
  await workflowsPanel.scrollIntoViewIfNeeded()
  await expect(workflowsPanel).toBeVisible()

  const paramRows = workflowsPanel.getByTestId('lowcode-workflow-param-row')
  await expect(paramRows).toHaveCount(2)
  await paramRows.nth(1).getByTestId('lowcode-workflow-param-optional').check()
  await editor.canvas.waitForRender()

  expect(await workflowSnapshot()).toMatchObject([
    {
      id: 'wf-notify',
      params: ['msg', 'detail'],
      optionalParams: ['detail']
    }
  ])

  await editor.page.evaluate((id) => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    store.select([id])
    store.requestRender()
  }, buttonId)
  await editor.canvas.waitForRender()

  const args = editor.page.getByTestId('lowcode-action-workflow-arg')
  await expect(args).toHaveCount(2)
  await expect(args.nth(0)).toHaveAttribute('placeholder', 'expression')
  await expect(args.nth(1)).toHaveAttribute('placeholder', 'optional')
  await expect(editor.page.getByTestId('lowcode-action-workflow-arg-error')).toHaveCount(1)
  await expect(editor.page.getByTestId('lowcode-action-workflow-arg-error')).toContainText(
    'msg: argument required'
  )
  editor.canvas.assertNoErrors()
})
