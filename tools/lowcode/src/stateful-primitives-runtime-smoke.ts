#!/usr/bin/env bun
import { chromium } from '@playwright/test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { createPreviewServer } from '@open-pencil/compiler/dev-server'
import { SceneGraph } from '@open-pencil/scene-graph'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const graph = new SceneGraph()
const pageId = graph.getPages()[0].id

graph.updateNode(graph.rootId, {
  lowcodeDocumentState: [
    { id: 'd-open', name: 'openSections', type: 'array', defaultValue: ['shipping'] }
  ]
})

graph.updateNode(pageId, {
  state: [{ id: 's-active', name: 'activeTab', type: 'string', defaultValue: 'overview' }]
})

graph.createNode('FRAME', pageId, {
  name: 'Tabs',
  x: 40,
  y: 40,
  width: 420,
  height: 180,
  interactiveProps: {
    uiKit: {
      primitive: 'tabs',
      valueBinding: { kind: 'ref', stateId: 's-active' },
      items: [
        { value: 'overview', label: 'Overview', content: 'Project overview' },
        { value: 'settings', label: 'Settings', content: 'Project settings' }
      ]
    }
  }
})

graph.createNode('FRAME', pageId, {
  name: 'Accordion',
  x: 40,
  y: 260,
  width: 420,
  height: 220,
  interactiveProps: {
    uiKit: {
      primitive: 'accordion',
      type: 'multiple',
      valueBinding: { kind: 'docState', docStateName: 'openSections' },
      items: [
        { value: 'shipping', title: 'Shipping', content: 'Ships in two days' },
        { value: 'returns', title: 'Returns', content: 'Thirty day returns' }
      ]
    }
  }
})

const out = compile({
  graph,
  pageIds: [pageId],
  options: withDefaults({ packageName: 'stateful-primitives-runtime-smoke', uiKit: 'shadcn' })
})
assert(
  out.warnings.length === 0,
  `Expected no compiler warnings, got ${JSON.stringify(out.warnings)}`
)

const server = await createPreviewServer({ initialFiles: out.files, fsRoot: process.cwd() })
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined

try {
  browser = await chromium.launch({ channel: 'chrome' })
  const page = await browser.newPage()
  await page.goto(server.url)

  await page.getByText('Project overview').waitFor()
  await page.getByText('Ships in two days').waitFor()
  assert(await page.getByText('Project settings').isHidden(), 'settings tab should start hidden')
  assert(await page.getByText('Thirty day returns').isHidden(), 'returns panel should start hidden')

  await page.getByRole('tab', { name: 'Settings' }).click()
  await page.getByText('Project settings').waitFor()
  assert(
    await page.getByText('Project overview').isHidden(),
    'overview tab should hide after click'
  )

  await page.getByRole('button', { name: 'Returns' }).click()
  await page.getByText('Thirty day returns').waitFor()
  await page.getByRole('button', { name: 'Shipping' }).click()
  assert(await page.getByText('Ships in two days').isHidden(), 'shipping panel should close')

  console.log('§22 stateful primitives runtime smoke passed')
} finally {
  await browser?.close()
  await server.close()
}
