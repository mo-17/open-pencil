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

async function setupWorkflowGraphDiagnostics() {
  return editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const page = store.graph.getNode(store.state.currentPageId)
    if (!page) throw new Error('Current page not found')

    store.graph.updateNode(store.graph.rootId, {
      lowcodeWorkflows: [
        {
          id: 'wf-save',
          name: 'Save',
          actions: [
            { id: 'call-notify', kind: 'callWorkflow', workflowId: 'wf-notify' },
            { id: 'call-missing', kind: 'callWorkflow', workflowId: 'wf-missing' }
          ]
        },
        {
          id: 'wf-notify',
          name: 'Notify',
          actions: [{ id: 'toast', kind: 'toast', messageExpr: '"Saved"', variant: 'success' }]
        }
      ]
    })
    store.graph.createNode('BUTTON', page.id, {
      name: 'Run save',
      x: 120,
      y: 120,
      width: 140,
      height: 40,
      events: {
        onClick: [{ id: 'event-call-save', kind: 'callWorkflow', workflowId: 'wf-save' }]
      }
    })
    store.select([])
    store.requestRender()
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

test('workflow graph details expand and issue jump focuses the workflow row', async () => {
  await setupWorkflowGraphDiagnostics()
  await editor.canvas.waitForRender()

  const workflowsPanel = editor.page.getByTestId('lowcode-workflows-section')
  await workflowsPanel.scrollIntoViewIfNeeded()
  await expect(workflowsPanel).toBeVisible()
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-summary')).toContainText(
    '2 workflows, 3 actions, 2 calls, 1 entry'
  )
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-issue')).toContainText(
    'Save calls a missing workflow'
  )
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-entrypoint')).toContainText(
    'No event entry: Notify'
  )
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-node')).toHaveCount(0)

  await workflowsPanel.getByTestId('lowcode-workflow-graph-toggle').click()
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-node')).toHaveCount(2)
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-node').first()).toContainText(
    'Save: 1 entry / 0 in / 2 out / 2 actions'
  )
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-entrypoint-source')).toContainText(
    'Entry: Run save onClick'
  )

  await workflowsPanel.getByTestId('lowcode-workflow-graph-jump').click()
  await expect
    .poll(() =>
      editor.page.evaluate(() => document.activeElement?.getAttribute('data-workflow-id') ?? '')
    )
    .toBe('wf-save')

  await workflowsPanel.getByTestId('lowcode-workflow-graph-toggle').click()
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-node')).toHaveCount(0)

  await workflowsPanel.getByTestId('lowcode-workflow-graph-toggle').click()
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-node')).toHaveCount(2)
  await workflowsPanel.getByTestId('lowcode-workflow-graph-entrypoint-source-jump').click()
  await expect
    .poll(() =>
      editor.page.evaluate(() => {
        const store = window.openPencil?.getStore?.()
        if (!store) return ''
        const selected = [...store.state.selectedIds][0]
        return selected ? store.graph.getNode(selected)?.name ?? '' : ''
      })
    )
    .toBe('Run save')
  await expect(editor.page.getByTestId('lowcode-events-section')).toBeVisible()
  await expect(editor.page.getByTestId('lowcode-action-workflow')).toHaveValue('wf-save')
  await expect
    .poll(() =>
      editor.page.evaluate(() => document.activeElement?.getAttribute('data-lowcode-action-path') ?? '')
    )
    .toBe('onClick[0]')
  editor.canvas.assertNoErrors()
})
