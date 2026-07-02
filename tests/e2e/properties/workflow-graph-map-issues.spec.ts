import { expect, test, useEditorSetupWithClear } from '#tests/e2e/fixtures'

const editor = useEditorSetupWithClear()

async function setupWorkflowGraphMixedIssueTypes() {
  return editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const page = store.graph.getNode(store.state.currentPageId)
    if (!page) throw new Error('Current page not found')

    store.graph.updateNode(store.graph.rootId, {
      lowcodeWorkflows: [
        {
          id: 'wf-a',
          name: 'Alpha',
          actions: [
            {
              id: 'gate-beta',
              kind: 'condition',
              condExpr: 'true',
              consequent: [{ id: 'call-beta', kind: 'callWorkflow', workflowId: 'wf-b' }]
            },
            { id: 'call-missing', kind: 'callWorkflow', workflowId: 'wf-missing' }
          ]
        },
        {
          id: 'wf-b',
          name: 'Beta',
          actions: [{ id: 'call-alpha', kind: 'callWorkflow', workflowId: 'wf-a' }]
        }
      ]
    })
    store.graph.createNode('BUTTON', page.id, {
      name: 'Run alpha',
      x: 120,
      y: 120,
      width: 140,
      height: 40,
      events: {
        onClick: [{ id: 'event-call-alpha', kind: 'callWorkflow', workflowId: 'wf-a' }]
      }
    })
    store.select([])
    store.requestRender()
  })
}

async function setupWorkflowGraphEntrypointWithIsolatedIssue() {
  return editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const page = store.graph.getNode(store.state.currentPageId)
    if (!page) throw new Error('Current page not found')

    store.graph.updateNode(store.graph.rootId, {
      lowcodeWorkflows: [
        {
          id: 'wf-entry',
          name: 'Entry',
          actions: [{ id: 'toast', kind: 'toast', messageExpr: '"Ready"', variant: 'success' }]
        },
        {
          id: 'wf-orphan',
          name: 'Orphan',
          actions: [{ id: 'call-missing', kind: 'callWorkflow', workflowId: 'wf-missing' }]
        }
      ]
    })
    store.graph.createNode('BUTTON', page.id, {
      name: 'Run entry',
      x: 120,
      y: 120,
      width: 140,
      height: 40,
      events: {
        onClick: [{ id: 'event-call-entry', kind: 'callWorkflow', workflowId: 'wf-entry' }]
      }
    })
    store.select([])
    store.requestRender()
  })
}

test('workflow graph map issue summary separates missing and cycle counts', async () => {
  await setupWorkflowGraphMixedIssueTypes()
  await editor.canvas.waitForRender()

  const workflowsPanel = editor.page.getByTestId('lowcode-workflows-section')
  await workflowsPanel.scrollIntoViewIfNeeded()
  await expect(workflowsPanel).toBeVisible()
  await workflowsPanel.getByTestId('lowcode-workflow-graph-toggle').click()

  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-summary')).toContainText(
    '2 nodes, 3 edges'
  )
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-issue-summary')).toContainText(
    '2 issues total'
  )
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-issue-summary')).toContainText(
    '1 missing, 1 cycle'
  )
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-issue-type')).toHaveText([
    'Missing',
    'Cycle'
  ])
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-node-group-title')).toHaveText(
    ['Issues']
  )
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-node-group-count')).toHaveText(
    ['2 workflows']
  )
  await expect(
    workflowsPanel.getByTestId('lowcode-workflow-graph-map-node-group-toggle')
  ).toHaveAttribute('aria-label', 'Hide Issues workflow group')
  await expect(
    workflowsPanel.getByTestId('lowcode-workflow-graph-map-node-group-toggle')
  ).toHaveAttribute('aria-expanded', 'true')
  await workflowsPanel.getByTestId('lowcode-workflow-graph-map-node-group-toggle').click()
  await expect(
    workflowsPanel.getByTestId('lowcode-workflow-graph-map-node-group-toggle')
  ).toHaveAttribute('aria-label', 'Show Issues workflow group')
  await expect(
    workflowsPanel.getByTestId('lowcode-workflow-graph-map-node-group-toggle')
  ).toHaveAttribute('aria-expanded', 'false')
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-node')).toHaveCount(0)
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-node-group-count')).toHaveText(
    ['2 workflows']
  )
  await workflowsPanel.getByTestId('lowcode-workflow-graph-map-node-group-toggle').click()
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-node')).toHaveCount(2)
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-edge-group-title')).toHaveText(
    ['Calls', 'Missing']
  )
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-edge-group-count')).toHaveText(
    ['2 edges', '1 edge']
  )
  await expect(
    workflowsPanel.getByTestId('lowcode-workflow-graph-map-edge-group-toggle').first()
  ).toHaveAttribute('aria-label', 'Hide Calls edge group')
  await expect(
    workflowsPanel.getByTestId('lowcode-workflow-graph-map-edge-group-toggle').first()
  ).toHaveAttribute('aria-expanded', 'true')
  await workflowsPanel.getByTestId('lowcode-workflow-graph-map-edge-group-toggle').first().click()
  await expect(
    workflowsPanel.getByTestId('lowcode-workflow-graph-map-edge-group-toggle').first()
  ).toHaveAttribute('aria-label', 'Show Calls edge group')
  await expect(
    workflowsPanel.getByTestId('lowcode-workflow-graph-map-edge-group-toggle').first()
  ).toHaveAttribute('aria-expanded', 'false')
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-edge')).toHaveCount(1)
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-edge-group-count')).toHaveText(
    ['2 edges', '1 edge']
  )
  await workflowsPanel.getByTestId('lowcode-workflow-graph-map-edge-group-toggle').first().click()
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-edge')).toHaveCount(3)
  await workflowsPanel.getByTestId('lowcode-workflow-graph-map-search').fill('wf-missing')
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-search-summary')).toContainText(
    '1 node, 1 edge matching "wf-missing"'
  )
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-summary')).toContainText(
    '1 node, 1 edge'
  )
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-node')).toHaveCount(1)
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-node')).toContainText('Alpha')
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-edge-group-title')).toHaveText(
    ['Missing']
  )
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-edge')).toHaveCount(1)
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-issue-summary')).toContainText(
    '1 issue total'
  )
  await workflowsPanel.getByTestId('lowcode-workflow-graph-map-search-clear').click()
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-search-summary')).toHaveCount(0)
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-summary')).toContainText(
    '2 nodes, 3 edges'
  )
  await workflowsPanel.getByTestId('lowcode-workflow-graph-map-filter-all').focus()
  await editor.page.keyboard.press('/')
  await expect
    .poll(() =>
      editor.page.evaluate(() => document.activeElement?.getAttribute('data-test-id') ?? '')
    )
    .toBe('lowcode-workflow-graph-map-search')
  await workflowsPanel.getByTestId('lowcode-workflow-graph-map-search').fill('call-beta')
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-search-summary')).toContainText(
    '2 nodes, 1 edge matching "call-beta"'
  )
  await editor.page.keyboard.press('Enter')
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-node').nth(0)).toHaveAttribute(
    'data-graph-map-active-match',
    'true'
  )
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-node').nth(0)).toContainText(
    'Alpha'
  )
  await editor.page.keyboard.press('Enter')
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-node').nth(1)).toHaveAttribute(
    'data-graph-map-active-match',
    'true'
  )
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-node').nth(1)).toContainText(
    'Beta'
  )
  await editor.page.keyboard.press('Enter')
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-edge').nth(0)).toHaveAttribute(
    'data-graph-map-active-match',
    'true'
  )
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-edge').nth(0)).toContainText(
    'Action call-beta'
  )
  await editor.page.keyboard.press('Shift+Enter')
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-node').nth(1)).toHaveAttribute(
    'data-graph-map-active-match',
    'true'
  )
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-node').nth(1)).toContainText(
    'Beta'
  )
  await editor.page.keyboard.press('ControlOrMeta+Enter')
  await expect
    .poll(() =>
      editor.page.evaluate(() => document.activeElement?.getAttribute('data-test-id') ?? '')
    )
    .toBe('lowcode-workflow-row')
  await expect
    .poll(() => editor.page.evaluate(() => document.activeElement?.textContent ?? ''))
    .toContain('Beta')
  await workflowsPanel.getByTestId('lowcode-workflow-graph-map-search').focus()
  await editor.page.keyboard.press('Escape')
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-search')).toHaveValue('')
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-search-summary')).toHaveCount(0)
  await expect(
    workflowsPanel.getByTestId('lowcode-workflow-graph-map-node').nth(0)
  ).not.toHaveAttribute('data-graph-map-active-match', 'true')
  await expect(
    workflowsPanel.getByTestId('lowcode-workflow-graph-map-node').nth(1)
  ).not.toHaveAttribute('data-graph-map-active-match', 'true')
  await expect(
    workflowsPanel.getByTestId('lowcode-workflow-graph-map-edge').nth(0)
  ).not.toHaveAttribute('data-graph-map-active-match', 'true')
  await editor.page.keyboard.press('Escape')
  await expect
    .poll(() =>
      editor.page.evaluate(() => document.activeElement?.getAttribute('data-test-id') ?? '')
    )
    .not.toBe('lowcode-workflow-graph-map-search')
  await expect(
    workflowsPanel.getByTestId('lowcode-workflow-graph-map-edge-action').first()
  ).toHaveAttribute(
    'aria-label',
    'Jump to Alpha workflow action call-beta at [0]/consequent[0]'
  )
  await expect(
    workflowsPanel.getByTestId('lowcode-workflow-graph-map-edge-action-kind').first()
  ).toHaveAttribute('title', 'Kind callWorkflow')
  await expect(
    workflowsPanel.getByTestId('lowcode-workflow-graph-map-edge-branch').first()
  ).toHaveAttribute('title', 'Then branch at [0]/consequent[0]')
  await workflowsPanel.getByTestId('lowcode-workflow-graph-map-search').fill('call-beta')
  await editor.page.keyboard.press('Enter')
  await editor.page.keyboard.press('Enter')
  await editor.page.keyboard.press('Enter')
  await editor.page.keyboard.press('ControlOrMeta+Enter')
  await expect
    .poll(() =>
      editor.page.evaluate(
        () => document.activeElement?.getAttribute('data-lowcode-action-path') ?? ''
      )
    )
    .toBe('[0]/consequent[0]')
  await workflowsPanel.getByTestId('lowcode-workflow-graph-map-edge-action').first().press('Enter')
  await expect
    .poll(() =>
      editor.page.evaluate(
        () => document.activeElement?.getAttribute('data-lowcode-action-path') ?? ''
      )
    )
    .toBe('[0]/consequent[0]')
  await expect
    .poll(() =>
      editor.page.evaluate(
        () => document.activeElement?.getAttribute('data-lowcode-focus-highlighted') ?? ''
      )
    )
    .toBe('true')
  await workflowsPanel.getByTestId('lowcode-workflow-graph-map-search-clear').click()
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-search-summary')).toHaveCount(0)
  await expect(
    workflowsPanel.getByTestId('lowcode-workflow-graph-map-node-issue').first()
  ).toContainText('2 issues')
  await expect(
    workflowsPanel.getByTestId('lowcode-workflow-graph-map-node-issue').first()
  ).toHaveAttribute('title', 'Alpha has 2 issues')

  await workflowsPanel.getByTestId('lowcode-workflow-graph-map-filter-issues').click()
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-summary')).toContainText(
    '2 nodes, 3 edges'
  )
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-issue-summary')).toContainText(
    '2 issues in issue filter'
  )
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-issue-summary')).toContainText(
    '1 missing, 1 cycle'
  )
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-edge-group-title')).toHaveText(
    ['Calls', 'Missing']
  )
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-edge-group-count')).toHaveText(
    ['2 edges', '1 edge']
  )
  editor.canvas.assertNoErrors()
})

test('workflow graph map issue clean state follows the entry filter', async () => {
  await setupWorkflowGraphEntrypointWithIsolatedIssue()
  await editor.canvas.waitForRender()

  const workflowsPanel = editor.page.getByTestId('lowcode-workflows-section')
  await workflowsPanel.scrollIntoViewIfNeeded()
  await expect(workflowsPanel).toBeVisible()
  await workflowsPanel.getByTestId('lowcode-workflow-graph-toggle').click()

  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-summary')).toContainText(
    '2 nodes, 1 edge'
  )
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-issue-group')).toHaveCount(1)
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-issue-summary')).toContainText(
    '1 issue total'
  )
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-issue-clean')).toHaveCount(0)

  await workflowsPanel.getByTestId('lowcode-workflow-graph-map-filter-entries').click()
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-summary')).toContainText(
    '1 node, 0 edges'
  )
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-node-group-title')).toHaveText(
    ['Entries']
  )
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-node-group-count')).toHaveText(
    ['1 workflow']
  )
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-issue-group')).toHaveCount(0)
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-issue-clean')).toContainText(
    'No entry workflow issues in this map.'
  )

  await workflowsPanel.getByTestId('lowcode-workflow-graph-map-filter-issues').click()
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-summary')).toContainText(
    '1 node, 1 edge'
  )
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-node-group-title')).toHaveText(
    ['Issues']
  )
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-issue-group')).toHaveCount(1)
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-issue-summary')).toContainText(
    '1 issue in issue filter'
  )
  await expect(workflowsPanel.getByTestId('lowcode-workflow-graph-map-issue-clean')).toHaveCount(0)
  editor.canvas.assertNoErrors()
})
