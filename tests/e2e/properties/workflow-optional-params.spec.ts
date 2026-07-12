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
    store.graph.createNode('BUTTON', page.id, {
      name: 'Quick save',
      x: 120,
      y: 180,
      width: 140,
      height: 40,
      events: {
        onClick: [{ id: 'event-call-save-quick', kind: 'callWorkflow', workflowId: 'wf-save' }]
      }
    })
    store.select([])
    store.requestRender()
  })
}

async function setupWorkflowGraphEntrypointOnly() {
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

test('workflow graph details expand and issue jump focuses the source action row', async () => {
  await setupWorkflowGraphDiagnostics()
  await editor.canvas.waitForRender()

  const workflowsPanel = editor.page.getByTestId('lowcode-workflows-section')
  await workflowsPanel.scrollIntoViewIfNeeded()
  await expect(workflowsPanel).toBeVisible()
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-summary')).toContainText(
    '2 workflows, 3 actions, 2 calls, 2 entries'
  )
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-issue')).toContainText(
    'Save calls a missing workflow'
  )
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-entrypoint')).toContainText(
    'No event entry: Notify'
  )
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map')).toHaveCount(0)
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-node')).toHaveCount(0)

  await workflowsPanel.getByTestId('lowcode-workflow-graph-toggle').click()
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map')).toBeVisible()
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-summary')).toContainText(
    '2 nodes, 2 edges'
  )
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-issue-group')).toHaveCount(1)
  await expect(
    workflowsPanel.getByTestId('lowcode-workflow-graph-map-issue-summary')
  ).toContainText('1 issue total')
  await expect(
    workflowsPanel.getByTestId('lowcode-workflow-graph-map-issue-summary')
  ).toContainText('1 missing')
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-issue-clean')).toHaveCount(0)
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-issue-type')).toContainText(
    'Missing'
  )
  await expect(
    workflowsPanel.getByTestId('lowcode-workflow-graph-map-issue-message')
  ).toContainText('Save calls a missing workflow (wf-missing)')
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-issue-jump')).toHaveAttribute(
    'aria-label',
    'Jump to Save workflow action call-missing for issue'
  )
  await workflowsPanel.getByTestId('lowcode-workflow-graph-map-issue-jump').press('Enter')
  await expect
    .poll(() =>
      editor.page.evaluate(
        () => document.activeElement?.getAttribute('data-lowcode-action-path') ?? ''
      )
    )
    .toBe('[1]')
  await expect(
    workflowsPanel.getByTestId('lowcode-workflow-graph-map-node-group-title')
  ).toHaveText(['Issues', 'Called'])
  await expect(
    workflowsPanel.getByTestId('lowcode-workflow-graph-map-node-group-count')
  ).toHaveText(['1 workflow', '1 workflow'])
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-node')).toHaveCount(2)
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-node').first()).toContainText(
    'Save'
  )
  await expect(
    workflowsPanel.getByTestId('lowcode-workflow-graph-map-node-jump').first()
  ).toHaveAttribute('aria-label', 'Jump to Save workflow')
  await expect(
    workflowsPanel.getByTestId('lowcode-workflow-graph-map-node-stats').first()
  ).toContainText('2e / 0i / 2o / 2a')
  await workflowsPanel.getByTestId('lowcode-workflow-graph-map-node-jump').first().press('Enter')
  await expect
    .poll(() =>
      editor.page.evaluate(() => document.activeElement?.getAttribute('data-workflow-id') ?? '')
    )
    .toBe('wf-save')
  await expect(
    workflowsPanel.getByTestId('lowcode-workflow-graph-map-node-entrypoint')
  ).toContainText('Run save onClick')
  await expect(
    workflowsPanel.getByTestId('lowcode-workflow-graph-map-node-entrypoint-more')
  ).toContainText('+1 more')
  await expect(
    workflowsPanel.getByTestId('lowcode-workflow-graph-map-node-entrypoint-more')
  ).toHaveAttribute('aria-expanded', 'false')
  await expect(
    workflowsPanel.getByTestId('lowcode-workflow-graph-map-node-entrypoint-more')
  ).toHaveAttribute('aria-label', 'Show 1 more sources for Save')
  await expect(
    workflowsPanel.getByTestId('lowcode-workflow-graph-map-node-entrypoint-jump')
  ).toHaveAttribute('aria-label', 'Jump to Run save onClick source')
  await workflowsPanel.getByTestId('lowcode-workflow-graph-map-node-entrypoint-more').click()
  await expect(
    workflowsPanel.getByTestId('lowcode-workflow-graph-map-node-entrypoint-more')
  ).toContainText('Hide sources')
  await expect(
    workflowsPanel.getByTestId('lowcode-workflow-graph-map-node-entrypoint-more')
  ).toHaveAttribute('aria-expanded', 'true')
  await expect(
    workflowsPanel.getByTestId('lowcode-workflow-graph-map-node-entrypoint-more')
  ).toHaveAttribute('aria-label', 'Hide additional sources for Save')
  await expect(
    workflowsPanel.getByTestId('lowcode-workflow-graph-map-node-entrypoint-list')
  ).toHaveAttribute('aria-label', 'Additional sources for Save')
  await expect(
    workflowsPanel.getByTestId('lowcode-workflow-graph-map-node-entrypoint-extra')
  ).toContainText('Quick save onClick')
  await expect(
    workflowsPanel.getByTestId('lowcode-workflow-graph-map-node-entrypoint-extra-jump')
  ).toHaveAttribute('aria-label', 'Jump to Quick save onClick source')
  await workflowsPanel.getByTestId('lowcode-workflow-graph-map-node-entrypoint-extra-jump').focus()
  await editor.page.keyboard.press('Escape')
  await expect(
    workflowsPanel.getByTestId('lowcode-workflow-graph-map-node-entrypoint-more')
  ).toHaveAttribute('aria-expanded', 'false')
  await expect
    .poll(() =>
      editor.page.evaluate(() => document.activeElement?.getAttribute('data-test-id') ?? '')
    )
    .toBe('lowcode-workflow-graph-map-node-entrypoint-more')
  await expect(
    workflowsPanel.getByTestId('lowcode-workflow-graph-map-node-entrypoint-list')
  ).toHaveCount(0)
  await workflowsPanel.getByTestId('lowcode-workflow-graph-map-node-entrypoint-more').click()
  await workflowsPanel.getByTestId('lowcode-workflow-graph-map-node-entrypoint-extra-jump').click()
  await expect
    .poll(() =>
      editor.page.evaluate(() => {
        const store = window.openPencil?.getStore?.()
        if (!store) return ''
        const selected = [...store.state.selectedIds][0]
        return selected ? (store.graph.getNode(selected)?.name ?? '') : ''
      })
    )
    .toBe('Quick save')
  await expect
    .poll(() =>
      editor.page.evaluate(
        () => document.activeElement?.getAttribute('data-lowcode-action-path') ?? ''
      )
    )
    .toBe('onClick[0]')
  await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    store.select([])
    store.requestRender()
  })
  await editor.canvas.waitForRender()
  await expect(workflowsPanel).toBeVisible()
  await workflowsPanel.getByTestId('lowcode-workflow-graph-toggle').click()
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-node-issue')).toContainText(
    '1 issue'
  )
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-node-issue')).toHaveAttribute(
    'aria-label',
    'Save has 1 issue'
  )
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-node').nth(1)).toContainText(
    'Notify'
  )
  await expect(
    workflowsPanel.getByTestId('lowcode-workflow-graph-map-node-stats').nth(1)
  ).toContainText('0e / 1i / 0o / 1a')
  await expect(
    workflowsPanel.getByTestId('lowcode-workflow-graph-map-edge-group-title')
  ).toHaveText(['Calls', 'Missing'])
  await expect(
    workflowsPanel.getByTestId('lowcode-workflow-graph-map-edge-group-count')
  ).toHaveText(['1 edge', '1 edge'])
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-edge')).toHaveCount(2)
  await expect(
    workflowsPanel.getByTestId('lowcode-workflow-graph-map-edge').first()
  ).toHaveAttribute('aria-label', 'Save calls Notify from action call-notify')
  await expect(
    workflowsPanel.getByTestId('lowcode-workflow-graph-map-edge-from').first()
  ).toContainText('From Save')
  await expect(
    workflowsPanel.getByTestId('lowcode-workflow-graph-map-edge-to').first()
  ).toContainText('To Notify')
  await expect(
    workflowsPanel.getByTestId('lowcode-workflow-graph-map-edge-action').first()
  ).toContainText('Action call-notify')
  await expect(
    workflowsPanel.getByTestId('lowcode-workflow-graph-map-edge-action-kind').first()
  ).toContainText('callWorkflow')
  await expect(
    workflowsPanel.getByTestId('lowcode-workflow-graph-map-edge-branch').first()
  ).toHaveAttribute('aria-label', 'Root branch at [0]')
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-edge-jump')).toHaveAttribute(
    'aria-label',
    'Jump to Notify workflow from Save'
  )
  await expect(
    workflowsPanel.getByTestId('lowcode-workflow-graph-map-edge').nth(1)
  ).toHaveAttribute('aria-label', 'Save calls wf-missing from action call-missing')
  await expect(
    workflowsPanel.getByTestId('lowcode-workflow-graph-map-edge-to').nth(1)
  ).toContainText('To wf-missing missing')
  await expect(
    workflowsPanel.getByTestId('lowcode-workflow-graph-map-edge-action').nth(1)
  ).toHaveAttribute('aria-label', 'Jump to Save workflow action call-missing at [1]')
  await workflowsPanel.getByTestId('lowcode-workflow-graph-map-filter-issues').click()
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-summary')).toContainText(
    '1 node, 1 edge'
  )
  await expect(
    workflowsPanel.getByTestId('lowcode-workflow-graph-map-issue-summary')
  ).toContainText('1 issue in issue filter')
  await expect(
    workflowsPanel.getByTestId('lowcode-workflow-graph-map-issue-summary')
  ).toContainText('1 missing')
  await expect(
    workflowsPanel.getByTestId('lowcode-workflow-graph-map-node-group-title')
  ).toHaveText(['Issues'])
  await expect(
    workflowsPanel.getByTestId('lowcode-workflow-graph-map-node-group-count')
  ).toHaveText(['1 workflow'])
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-node')).toHaveCount(1)
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-node')).toContainText('Save')
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-node-issue')).toContainText(
    '1 issue'
  )
  await expect(
    workflowsPanel.getByTestId('lowcode-workflow-graph-map-edge-group-title')
  ).toHaveText(['Missing'])
  await expect(
    workflowsPanel.getByTestId('lowcode-workflow-graph-map-edge-group-count')
  ).toHaveText(['1 edge'])
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-edge')).toHaveCount(1)
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-edge')).toHaveAttribute(
    'aria-label',
    'Save calls wf-missing from action call-missing'
  )
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-edge-from')).toContainText(
    'From Save'
  )
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-edge-to')).toContainText(
    'To wf-missing missing'
  )
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-edge-action')).toContainText(
    'Action call-missing'
  )
  await expect(
    workflowsPanel.getByTestId('lowcode-workflow-graph-map-edge-missing')
  ).toHaveAttribute('aria-label', 'Missing workflow wf-missing called from Save')
  await expect(
    workflowsPanel.getByTestId('lowcode-workflow-graph-map-edge-source-jump')
  ).toHaveAttribute('aria-label', 'Jump to Save workflow to fix missing wf-missing')
  await workflowsPanel.getByTestId('lowcode-workflow-graph-map-edge-source-jump').press('Enter')
  await expect
    .poll(() =>
      editor.page.evaluate(() => document.activeElement?.getAttribute('data-workflow-id') ?? '')
    )
    .toBe('wf-save')
  await workflowsPanel.getByTestId('lowcode-workflow-graph-map-filter-entries').click()
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-summary')).toContainText(
    '1 node, 2 edges'
  )
  await expect(
    workflowsPanel.getByTestId('lowcode-workflow-graph-map-issue-summary')
  ).toContainText('1 issue touching entry workflows')
  await expect(
    workflowsPanel.getByTestId('lowcode-workflow-graph-map-issue-summary')
  ).toContainText('1 missing')
  await expect(
    workflowsPanel.getByTestId('lowcode-workflow-graph-map-node-group-title')
  ).toHaveText(['Entries'])
  await expect(
    workflowsPanel.getByTestId('lowcode-workflow-graph-map-node-group-count')
  ).toHaveText(['1 workflow'])
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-node')).toHaveCount(1)
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-node')).toContainText('Save')
  await expect(
    workflowsPanel.getByTestId('lowcode-workflow-graph-map-edge-group-title')
  ).toHaveText(['Calls', 'Missing'])
  await expect(
    workflowsPanel.getByTestId('lowcode-workflow-graph-map-edge-group-count')
  ).toHaveText(['1 edge', '1 edge'])
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-edge')).toHaveCount(2)
  await workflowsPanel.getByTestId('lowcode-workflow-graph-map-node-entrypoint-jump').click()
  await expect
    .poll(() =>
      editor.page.evaluate(() => {
        const store = window.openPencil?.getStore?.()
        if (!store) return ''
        const selected = [...store.state.selectedIds][0]
        return selected ? (store.graph.getNode(selected)?.name ?? '') : ''
      })
    )
    .toBe('Run save')
  await expect
    .poll(() =>
      editor.page.evaluate(
        () => document.activeElement?.getAttribute('data-lowcode-action-path') ?? ''
      )
    )
    .toBe('onClick[0]')
  await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    store.select([])
    store.requestRender()
  })
  await editor.canvas.waitForRender()
  await expect(workflowsPanel).toBeVisible()
  await workflowsPanel.getByTestId('lowcode-workflow-graph-toggle').click()
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-node')).toHaveCount(2)
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-node').first()).toContainText(
    'Save: 2 entries / 0 in / 2 out / 2 actions'
  )
  await expect(
    workflowsPanel.getByTestId('lowcode-workflow-graph-entrypoint-source').first()
  ).toContainText('Run save onClick')
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-out-edge').first()).toContainText(
    'to Notify'
  )
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-out-edge').nth(1)).toContainText(
    'to wf-missing'
  )
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-in-edge')).toContainText(
    'from Save'
  )

  await workflowsPanel.getByTestId('lowcode-workflow-graph-map-edge-jump').press('Enter')
  await expect
    .poll(() =>
      editor.page.evaluate(() => document.activeElement?.getAttribute('data-workflow-id') ?? '')
    )
    .toBe('wf-notify')

  await workflowsPanel.getByTestId('lowcode-workflow-graph-jump').click()
  await expect
    .poll(() =>
      editor.page.evaluate(
        () => document.activeElement?.getAttribute('data-lowcode-action-path') ?? ''
      )
    )
    .toBe('[1]')
  await expect
    .poll(() =>
      editor.page.evaluate(
        () => document.activeElement?.getAttribute('data-lowcode-focus-highlighted') ?? ''
      )
    )
    .toBe('true')

  await workflowsPanel.getByTestId('lowcode-workflow-graph-toggle').click()
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-node')).toHaveCount(0)

  await workflowsPanel.getByTestId('lowcode-workflow-graph-toggle').click()
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-node')).toHaveCount(2)
  await workflowsPanel.getByTestId('lowcode-workflow-graph-entrypoint-source-jump').first().click()
  await expect
    .poll(() =>
      editor.page.evaluate(() => {
        const store = window.openPencil?.getStore?.()
        if (!store) return ''
        const selected = [...store.state.selectedIds][0]
        return selected ? (store.graph.getNode(selected)?.name ?? '') : ''
      })
    )
    .toBe('Run save')
  await expect(editor.page.getByTestId('lowcode-events-section')).toBeVisible()
  await expect(editor.page.getByTestId('lowcode-action-workflow')).toHaveValue('wf-save')
  await expect
    .poll(() =>
      editor.page.evaluate(
        () => document.activeElement?.getAttribute('data-lowcode-action-path') ?? ''
      )
    )
    .toBe('onClick[0]')
  await expect
    .poll(() =>
      editor.page.evaluate(
        () => document.activeElement?.getAttribute('data-lowcode-focus-highlighted') ?? ''
      )
    )
    .toBe('true')
  editor.canvas.assertNoErrors()
})

test('workflow graph map separates node and edge empty states', async () => {
  await setupWorkflowGraphEntrypointOnly()
  await editor.canvas.waitForRender()

  const workflowsPanel = editor.page.getByTestId('lowcode-workflows-section')
  await workflowsPanel.scrollIntoViewIfNeeded()
  await expect(workflowsPanel).toBeVisible()
  await workflowsPanel.getByTestId('lowcode-workflow-graph-toggle').click()

  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-summary')).toContainText(
    '1 node, 0 edges'
  )
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-issue-group')).toHaveCount(0)
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-issue-clean')).toContainText(
    'No graph issues in this map.'
  )
  await expect(
    workflowsPanel.getByTestId('lowcode-workflow-graph-map-node-group-title')
  ).toHaveText(['Entries'])
  await expect(
    workflowsPanel.getByTestId('lowcode-workflow-graph-map-node-group-count')
  ).toHaveText(['1 workflow'])
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-node')).toHaveCount(1)
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-node-empty')).toHaveCount(0)
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-edge-empty')).toContainText(
    'No workflow calls.'
  )

  await workflowsPanel.getByTestId('lowcode-workflow-graph-map-filter-entries').click()
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-summary')).toContainText(
    '1 node, 0 edges'
  )
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-issue-clean')).toContainText(
    'No entry workflow issues in this map.'
  )
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-edge-empty')).toContainText(
    'No entry edges.'
  )

  await workflowsPanel.getByTestId('lowcode-workflow-graph-map-filter-issues').click()
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-summary')).toContainText(
    '0 nodes, 0 edges'
  )
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-node')).toHaveCount(0)
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-node-empty')).toContainText(
    'No workflows with issues.'
  )
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-issue-clean')).toContainText(
    'No workflows with issues in this map.'
  )
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-edge-empty')).toHaveCount(0)
  editor.canvas.assertNoErrors()
})
