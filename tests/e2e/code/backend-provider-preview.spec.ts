import { expect, test, type Frame, type Page } from '@playwright/test'

import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import type * as AppPluginModule from '@/app/plugins/app'
import type * as BackendProviderModule from '@/app/plugins/host/backend-provider'

import { CanvasHelper } from '#tests/helpers/canvas'

const PREVIEW_FRAME = 'iframe[aria-label="lowcode preview"]'

async function readyFrame(page: Page): Promise<Frame> {
  const pane = page.getByTestId('lowcode-preview-pane')
  await expect(pane).toHaveAttribute('data-preview-host', 'browser-worker')
  await expect(pane).toHaveAttribute('data-preview-status', /^(ready|error|unsupported)$/, {
    timeout: 90_000
  })
  if ((await pane.getAttribute('data-preview-status')) !== 'ready') {
    throw new Error(`Browser preview failed: ${(await pane.innerText()).slice(0, 4_096)}`)
  }
  const iframe = page.locator(PREVIEW_FRAME)
  await expect(iframe).toBeVisible()
  const frame = await (await iframe.elementHandle())?.contentFrame()
  if (!frame) throw new Error('Browser preview iframe is not attached')
  return frame
}

async function declarePrivateUpload(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const editor = window.openPencil?.getStore?.()
    if (!editor) throw new Error('OpenPencil store is not initialized')
    const appURL = performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .find((url) => url.includes('/src/app/plugins/app.ts'))
    if (!appURL) throw new Error('Active App plugin module was not found')
    const backendURL = new URL('/src/app/plugins/host/backend-provider.ts', location.origin).href
    const { appPluginStore, appPluginStoreReady } = (await import(
      /* @vite-ignore */ appURL
    )) as typeof AppPluginModule
    const {
      APP_BACKEND_PROVIDER_REQUEST_FORMAT,
      SUPABASE_BACKEND_PROVIDER_PLUGIN_ID,
      appBackendProviderDocumentValue,
      listAppBackendProviderDescriptors
    } = (await import(/* @vite-ignore */ backendURL)) as typeof BackendProviderModule
    await appPluginStoreReady
    const selection = listAppBackendProviderDescriptors(appPluginStore).find(
      (entry) => entry.pluginId === SUPABASE_BACKEND_PROVIDER_PLUGIN_ID
    )
    if (!selection) throw new Error('Live bundled Supabase Backend Provider is unavailable')
    const application: BackendApplicationSpecV1 = {
      format: 'openpencil.backend-application',
      version: 1,
      applicationId: 'browser-preview-storage',
      dataModel: { version: 1, entities: [], enums: [], relations: [] },
      auth: {
        version: 1,
        identities: [{ id: 'user', kind: 'user' }],
        roles: [],
        ownership: [],
        tenants: [],
        rowAccess: []
      },
      workflows: { version: 1, workflows: [] },
      storage: {
        version: 1,
        buckets: [
          {
            id: 'avatars',
            name: 'avatars',
            access: 'private',
            maxObjectBytes: 1_048_576,
            allowedMimeTypes: ['image/png'],
            pathRules: [
              {
                id: 'owner-files',
                prefix: ['users'],
                principal: { kind: 'owner' },
                operations: ['read', 'create', 'update', 'delete', 'upsert']
              }
            ]
          }
        ]
      },
      capabilities: [
        { capability: 'auth.identity', required: true },
        { capability: 'storage.objects', required: true },
        { capability: 'policy.row-level', required: true }
      ],
      secrets: []
    }
    const node = editor.graph.createNode('INPUT', editor.state.currentPageId, {
      name: 'Private avatar upload',
      x: 20,
      y: 20,
      width: 240,
      height: 40,
      interactiveProps: { upload: { bucket: 'avatars', resultTarget: 'avatarPath' } }
    })
    editor.graph.updateNode(editor.graph.rootId, {
      lowcodeSupabaseConfig: {
        url: 'https://example.supabase.co',
        anonKey: 'browser-e2e-public-placeholder',
        schema: 'public'
      },
      lowcodeDocumentState: [
        { id: 'avatar-path', name: 'avatarPath', type: 'string', defaultValue: '' }
      ],
      pluginData: [
        {
          pluginId: 'open-pencil',
          key: 'lowcode/backendProvider.v1',
          value: appBackendProviderDocumentValue({
            format: APP_BACKEND_PROVIDER_REQUEST_FORMAT,
            selection,
            application
          })
        }
      ]
    })
    return node.id
  })
}

async function replaceWithLocalBackend(page: Page, nodeId: string): Promise<void> {
  await page.evaluate(async (id) => {
    const editor = window.openPencil?.getStore?.()
    if (!editor) throw new Error('OpenPencil store is not initialized')
    const backendURL = new URL('/src/app/plugins/host/backend-provider.ts', location.origin).href
    const { readAppBackendProviderDocumentRequest, appBackendProviderDocumentValue } =
      (await import(/* @vite-ignore */ backendURL)) as typeof BackendProviderModule
    const request = readAppBackendProviderDocumentRequest(editor.graph)
    if (!request) throw new Error('Expected the current private Storage declaration')
    const application = structuredClone(request.application)
    delete application.storage
    application.auth.identities = []
    application.capabilities = []
    application.applicationId = 'browser-preview-local'
    editor.graph.updateNode(id, { interactiveProps: {} })
    editor.graph.clearNodeFields(editor.graph.rootId, ['lowcodeSupabaseConfig'])
    editor.graph.updateNode(editor.graph.rootId, {
      lowcodeDocumentState: [],
      pluginData: [
        {
          pluginId: 'open-pencil',
          key: 'lowcode/backendProvider.v1',
          value: appBackendProviderDocumentValue({ ...request, application })
        }
      ]
    })
  }, nodeId)
}

test('real Browser Worker blocks Supabase networking and invalidates local Backend previews under Manual refresh', async ({
  page
}) => {
  test.setTimeout(240_000)
  await page.setViewportSize({ width: 2200, height: 900 })
  // The isolated Vite test server intentionally has no MCP companion process.
  await page.route('http://127.0.0.1:7600/health', (route) =>
    route.fulfill({
      status: 204,
      headers: { 'access-control-allow-origin': '*' }
    })
  )
  const remoteOperations: string[] = []
  await page.route('https://*.supabase.co/**', (route) => {
    remoteOperations.push(route.request().url())
    return route.abort('blockedbyclient')
  })
  await page.addInitScript(() => {
    performance.setResourceTimingBufferSize(10_000)
    // oxlint-disable-next-line open-pencil/no-direct-storage-access -- Isolated browser test preferences must precede app startup.
    localStorage.setItem('op-online-fonts-enabled', 'false')
    // oxlint-disable-next-line open-pencil/no-direct-storage-access -- No remote font service is needed for this Storage regression.
    localStorage.setItem(
      'op-font-providers',
      JSON.stringify({ google: false, fontsource: false, bunny: false, fontshare: false })
    )
  })
  await page.goto('/')
  await new CanvasHelper(page).waitForInit()
  await readyFrame(page)
  await page.getByTestId('lowcode-preview-refresh-policy').selectOption('manual')

  const nodeId = await declarePrivateUpload(page)
  const pane = page.getByTestId('lowcode-preview-pane')
  await expect(pane).toHaveAttribute('data-preview-status', 'error', { timeout: 30_000 })
  await expect(pane).toContainText(
    'Browser preview blocks generated Supabase, server workflow, and analytics networking.'
  )
  await expect(page.locator(PREVIEW_FRAME)).toHaveCount(0)
  await page.getByTestId('lowcode-preview-diagnostics-toggle').click()
  await expect(
    page.getByTestId('lowcode-preview-diagnostic').filter({
      hasText: 'browser-preview-network-runtime-unsupported'
    })
  ).toHaveCount(1)
  await page.getByTestId('lowcode-preview-diagnostics-toggle').click()

  // Keep the live Provider declaration, removing only network runtime intent.
  // Browser isolation remains intact; the actual Worker must compile this locally.
  const activity = page.getByTestId('lowcode-preview-compile-activity')
  const previousRevision = await activity.getAttribute('data-latest-revision')
  if (!previousRevision) throw new Error('Preview compile revision is unavailable')
  await replaceWithLocalBackend(page, nodeId)
  await expect(activity).not.toHaveAttribute('data-latest-revision', previousRevision, {
    timeout: 15_000
  })
  const localFrame = await readyFrame(page)
  const localInput = localFrame.locator(`[data-node-id="${nodeId}"]`)
  await expect(localInput).toBeVisible()
  await expect(localInput).not.toHaveAttribute('type', 'file')
  await expect(page.getByTestId('lowcode-preview-compile-activity')).toHaveAttribute(
    'data-policy',
    'manual'
  )
  const oldIframe = await page.locator(PREVIEW_FRAME).elementHandle()
  if (!oldIframe) throw new Error('Expected a visible local Backend preview')
  await page.getByTestId('app-settings-trigger').click()
  await page.getByTestId('settings-section-plugins').click()
  await expect(page.getByTestId('settings-plugins-panel')).toBeVisible()
  await page.getByTestId('settings-plugins-view').getByText('Installed', { exact: true }).click()
  const providerSwitch = page.getByTestId('plugin-enabled-open-pencil.supabase-backend')
  await expect(providerSwitch).toBeChecked()
  expect(await oldIframe.evaluate((element) => element.isConnected)).toBe(true)
  await providerSwitch.click()
  await expect(providerSwitch).not.toBeChecked()
  await expect(page.locator(PREVIEW_FRAME)).toHaveCount(0, { timeout: 5_000 })
  expect(await oldIframe.evaluate((element) => element.isConnected)).toBe(false)
  await expect(page.getByTestId('lowcode-preview-pane')).toHaveAttribute(
    'data-preview-status',
    'error',
    { timeout: 15_000 }
  )
  expect(remoteOperations).toEqual([])
})
