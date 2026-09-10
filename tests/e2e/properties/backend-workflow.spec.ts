import { expect, test, type Page } from '@playwright/test'

import type * as PluginApp from '@/app/plugins/app'
import type * as BackendProviderHost from '@/app/plugins/host/backend-provider'

import { CanvasHelper } from '#tests/helpers/canvas'

test('Backend branch and environment edits survive save, undo, redo, and server compilation', async ({
  page
}) => {
  test.setTimeout(60_000)
  // The optional MCP companion is unrelated to document editing or compilation.
  await page.route('http://127.0.0.1:7600/health', (route) =>
    route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
  )
  await page.addInitScript(() => performance.setResourceTimingBufferSize(10_000))
  await page.goto('/')
  const editor = { page, canvas: new CanvasHelper(page) }
  await editor.canvas.waitForInit()
  const documentPluginData = () => readDocumentPluginData(page)
  // A public client configuration is required to emit executable frontend workflow bindings.
  // This fixture compiles source only and never connects to Supabase.
  await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    store.graph.updateNode(store.graph.rootId, {
      lowcodeSupabaseConfig: {
        url: 'https://example.supabase.co',
        anonKey: 'local-public-placeholder',
        schema: 'public'
      }
    })
  })
  const panel = editor.page.getByTestId('lowcode-backend-editor')
  const provider = panel.getByTestId('lowcode-backend-provider')
  await expect(provider).toBeEnabled()
  await expect(provider.locator('option')).toHaveCount(1)
  await panel.getByRole('button', { name: 'Workflows', exact: true }).click()

  const references = panel.getByTestId('lowcode-backend-environment-references')
  await references.getByTestId('lowcode-backend-environment-new-name').fill('WEBHOOK_ENDPOINT')
  await references.getByTestId('lowcode-backend-environment-add').click()
  await panel.getByTestId('lowcode-backend-add-workflow').click()
  const workflow = panel.getByTestId('lowcode-backend-workflow')
  await workflow.getByLabel('Workflow name', { exact: true }).fill('Conditional notification')
  const rootSteps = workflow
    .getByTestId('lowcode-backend-workflow-steps')
    .and(workflow.locator('[data-depth="0"]'))
  await rootSteps.getByTestId('lowcode-backend-add-step-branch').click()
  const branch = rootSteps.getByTestId('lowcode-backend-workflow-step-branch')
  await branch.getByLabel('Branch condition expression').fill('true')
  const consequent = branch.getByTestId('lowcode-backend-workflow-consequent')
  const alternate = branch.getByTestId('lowcode-backend-workflow-alternate')
  await consequent.getByTestId('lowcode-backend-add-step-http.request').click()
  const http = consequent.getByTestId('lowcode-backend-workflow-step-http.request')
  await http.getByLabel('Value source', { exact: true }).selectOption('environment')
  await expect(http.getByLabel('URL value source')).toHaveValue('WEBHOOK_ENDPOINT')
  const panelBounds = await panel.boundingBox()
  if (!panelBounds) throw new Error('Backend editor is not visible')
  for (const field of await http.locator('input, select').all()) {
    const bounds = await field.boundingBox()
    if (!bounds) throw new Error('Nested HTTP field is not visible')
    expect(bounds.x).toBeGreaterThanOrEqual(panelBounds.x)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(panelBounds.x + panelBounds.width)
  }
  await consequent.getByLabel('HTTP status').fill('201')
  await consequent.getByLabel('HTTP status').blur()
  await consequent.getByLabel('Response expression (optional)').fill('"sent"')
  await consequent.getByLabel('Response expression (optional)').blur()
  await alternate.getByLabel('HTTP status').fill('403')
  await alternate.getByLabel('HTTP status').blur()

  await references.getByTestId('lowcode-backend-environment-name').fill('HOOK_ENDPOINT')
  await references.getByTestId('lowcode-backend-environment-name').blur()
  await expect(http.getByLabel('URL value source')).toHaveValue('HOOK_ENDPOINT')
  await references.getByRole('button', { name: 'Remove environment reference' }).click()
  await expect(references.getByTestId('lowcode-backend-environment-operation-error')).toBeVisible()
  await expect(references.getByTestId('lowcode-backend-environment-name')).toHaveValue(
    'HOOK_ENDPOINT'
  )

  const previous = await documentPluginData()
  await expect(panel.getByTestId('lowcode-backend-save')).toBeEnabled()
  await panel.getByTestId('lowcode-backend-save').click()
  await expect.poll(documentPluginData).not.toEqual(previous)
  const saved = await documentPluginData()
  await editor.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await editor.canvas.undo()
  await expect.poll(documentPluginData).toEqual(previous)
  await editor.canvas.redo()
  await expect.poll(documentPluginData).toEqual(saved)
  await expect(http.getByLabel('URL value source')).toHaveValue('HOOK_ENDPOINT')
  await expect(consequent.getByLabel('HTTP status')).toHaveValue('201')
  await expect(alternate.getByLabel('HTTP status')).toHaveValue('403')

  const compiled = await editor.page.evaluate(async () => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const resources = performance.getEntriesByType('resource').map((entry) => entry.name)
    const hostURL = resources.find(
      (url) => new URL(url).pathname === '/src/app/plugins/host/backend-provider.ts'
    )
    const appURL = resources.find((url) => new URL(url).pathname === '/src/app/plugins/app.ts')
    if (!hostURL || !appURL) throw new Error('Active Backend Host modules were not loaded')
    const host: typeof BackendProviderHost = await import(hostURL)
    const app: typeof PluginApp = await import(appURL)
    await app.appPluginStoreReady
    const declaration = host.readAppBackendProviderDocumentRequest(store.graph)
    const output = host.compileAppBackendProviderDocument(app.appPluginStore, {
      graph: store.graph,
      pageIds: [store.state.currentPageId],
      options: {
        packageName: 'backend-workflow-editor-check',
        target: 'react',
        reactVersion: '19',
        router: 'none',
        typescript: true,
        devMode: false
      }
    })
    return {
      declaration,
      warnings: output.warnings,
      serverSources:
        output.artifactOwnership?.executableServerWorkflowFiles.map((path) => ({
          path,
          content: output.files.get(path)
        })) ?? []
    }
  })
  expect(compiled.declaration?.application.secrets).toEqual([
    { kind: 'environment', name: 'HOOK_ENDPOINT', exposure: 'server', required: true }
  ])
  const source = compiled.serverSources.find(
    (entry) => entry.path === 'supabase/functions/openpencil-runtime/index.ts'
  )?.content
  expect(typeof source, JSON.stringify(compiled.warnings)).toBe('string')
  expect(source).toContain('requiredEnvironment("HOOK_ENDPOINT")')
  expect(source).not.toContain('WEBHOOK_ENDPOINT')
  expect(source).toContain('return { status: 201, body: "sent" }')
  expect(source).toContain('return { status: 403, body: null }')
  expect(compiled.warnings.map((warning) => warning.code)).not.toContain(
    'server-workflow-unsupported'
  )
  editor.canvas.assertNoErrors()
  await consequent.scrollIntoViewIfNeeded()
  await editor.page.screenshot({ path: test.info().outputPath('backend-workflow.png') })
})

async function readDocumentPluginData(page: Page) {
  return page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    return store.graph.getNode(store.graph.rootId)?.pluginData ?? []
  })
}
