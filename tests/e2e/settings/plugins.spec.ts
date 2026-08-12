/* eslint-disable max-lines -- Plugin settings lifecycle, marketplace trust badges, and runtime grants share one end-to-end surface. */
import { expect, test, type Page } from '@playwright/test'

import type { ModuleInstanceV1 } from '@open-pencil/scene-graph'

import { CanvasHelper } from '#tests/helpers/canvas'

const MAP_PLUGIN_ID = 'open-pencil.map'
const MAP_MODULE_TYPE = 'map'
const CHART_PLUGIN_ID = 'open-pencil.chart'
const CHART_MODULE_TYPE = 'chart'
const CLIPBOARD_PLUGIN_ID = 'open-pencil.clipboard-toolkit'
const TAURI_EXPORTER_PLUGIN_ID = 'open-pencil.tauri-react-exporter'
const VUE_EXPORTER_PLUGIN_ID = 'open-pencil.vue-exporter'

interface StoredPluginState {
  schemaVersion: number
  pluginId: string
  trustSource: string
  activeDigest: string
  installed: boolean
  enabled: boolean
  pinnedDigest: string | null
}

async function openPlugins(page: Page): Promise<void> {
  await page.getByTestId('app-settings-trigger').click()
  await page.getByTestId('settings-section-plugins').click()
  await expect(page.getByTestId('settings-plugins-panel')).toBeVisible()
}

async function selectPluginView(page: Page, name: 'Browse' | 'Installed'): Promise<void> {
  await page.getByTestId('settings-plugins-view').getByText(name, { exact: true }).click()
}

async function makeMapPinStale(page: Page): Promise<string> {
  return page.evaluate(async (pluginId) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('open-pencil-plugins')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('Plugin database open failed'))
    })
    const transaction = database.transaction('installedPluginState', 'readwrite')
    const records = transaction.objectStore('installedPluginState')
    const record = await new Promise<StoredPluginState | undefined>((resolve, reject) => {
      const request = records.get(pluginId)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('Plugin state read failed'))
    })
    if (!record) throw new Error('Expected the bundled Map plugin state')
    const staleDigest = `app-bundle-sha256:${'A'.repeat(43)}`
    records.put({ ...record, activeDigest: staleDigest, pinnedDigest: staleDigest })
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('Plugin state transaction failed'))
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('Plugin state transaction aborted'))
    })
    database.close()
    return staleDigest
  }, MAP_PLUGIN_ID)
}

async function makeMapSchemaFuture(page: Page): Promise<void> {
  await page.evaluate(async (pluginId) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('open-pencil-plugins')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('Plugin database open failed'))
    })
    const transaction = database.transaction('installedPluginState', 'readwrite')
    const records = transaction.objectStore('installedPluginState')
    const record = await new Promise<StoredPluginState | undefined>((resolve, reject) => {
      const request = records.get(pluginId)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('Plugin state read failed'))
    })
    if (!record) throw new Error('Expected the bundled Map plugin state')
    records.put({ ...record, schemaVersion: 999 })
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('Plugin state transaction failed'))
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('Plugin state transaction aborted'))
    })
    database.close()
  }, MAP_PLUGIN_ID)
}

async function changeMapModule(
  page: Page,
  changes: { moduleType?: string; configVersion?: number }
): Promise<void> {
  await page.evaluate(
    ({ pluginId, changes: moduleChanges }) => {
      const store = window.openPencil?.getStore?.()
      const node = store?.graph
        .getAllNodes()
        .find(
          (candidate) =>
            (candidate.interactiveProps?.module as ModuleInstanceV1 | undefined)?.pluginId ===
            pluginId
        )
      if (!store || !node) throw new Error('Expected Map module node')
      const module = node.interactiveProps?.module as ModuleInstanceV1
      store.graph.updateNode(node.id, {
        interactiveProps: { ...node.interactiveProps, module: { ...module, ...moduleChanges } }
      })
    },
    { pluginId: MAP_PLUGIN_ID, changes }
  )
}

async function showIncompatiblePendingMapUpdate(page: Page): Promise<void> {
  await page.evaluate(
    async ({ pluginId, moduleType }) => {
      const { appPluginStoreSnapshot } = await import('/src/app/plugins/app.ts')
      const snapshot = appPluginStoreSnapshot.value
      const installed = snapshot.installed.map((candidate) => {
        if (candidate.package.manifest.plugin.id !== pluginId) return candidate
        const plugin = structuredClone(candidate)
        const candidateManifest = structuredClone(plugin.package.manifest)
        candidateManifest.plugin.version = '2.0.0'
        candidateManifest.contributions.modules[0].configVersion = 2
        Object.defineProperty(plugin, 'installedState', {
          configurable: true,
          enumerable: true,
          value: {
            version: 1,
            enabled: plugin.enabled,
            accepted: {
              manifest: plugin.package.manifest,
              verifiedDigest: plugin.package.digest,
              verifiedKeyId: 'test-key'
            },
            history: [],
            pending: {
              candidate: {
                manifest: candidateManifest,
                verifiedDigest: 'test-candidate-digest',
                verifiedKeyId: 'test-key'
              },
              diff: {
                fromVersion: plugin.package.manifest.plugin.version,
                toVersion: candidateManifest.plugin.version,
                addedModules: [],
                removedModules: [],
                updatedModules: [moduleType]
              },
              status: 'pending'
            }
          }
        })
        return plugin
      })
      appPluginStoreSnapshot.value = { ...snapshot, installed }
    },
    { pluginId: MAP_PLUGIN_ID, moduleType: MAP_MODULE_TYPE }
  )
}

async function injectMarketplaceSnapshot(page: Page): Promise<void> {
  await page.evaluate(async (pluginId) => {
    const { appPluginMarketplaceSnapshot } = await import('/src/app/plugins/app.ts')
    const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
    const keyId = 'acme.release'
    const publisherId = 'acme'
    const digest = 'marketplace-test-digest'
    appPluginMarketplaceSnapshot.value = {
      status: 'fresh',
      source: 'network',
      refreshError: null,
      snapshot: {
        snapshot: {
          format: 'openpencil-marketplace-snapshot',
          schemaVersion: 1,
          marketplaceId: 'openpencil.marketplace',
          version: '1.0.0',
          sequence: 8,
          generatedAt: '2026-08-05T00:00:00.000Z',
          expiresAt: '2026-08-10T00:00:00.000Z',
          publisherDirectory: {
            publishers: [
              {
                publisherId,
                name: 'Acme Spatial',
                status: 'active',
                keys: [
                  {
                    keyId,
                    publicKeyPem: '-----BEGIN PUBLIC KEY-----\nTEST\n-----END PUBLIC KEY-----\n',
                    notBefore: '2026-01-01T00:00:00.000Z',
                    notAfter: '2027-01-01T00:00:00.000Z'
                  }
                ]
              }
            ],
            ownerships: [
              {
                pluginId,
                publisherId,
                status: 'active',
                grantedAt: '2026-01-01T00:00:00.000Z'
              }
            ]
          },
          catalogs: [
            {
              channel: 'stable',
              catalogId: 'openpencil.marketplace.stable',
              keyId: 'marketplace.root.2026',
              url: 'https://plugins.example.com/catalogs/stable.json',
              digest
            }
          ],
          listings: [
            {
              pluginId,
              publisherId,
              name: 'Spatial Atlas',
              summary: 'Reviewed spatial modules for maps',
              categories: ['geospatial'],
              keywords: ['atlas-keyword'],
              releases: [{ channel: 'stable', version: '1.0.0', digest }]
            }
          ],
          auditHead: {
            sequence: 19,
            headDigest: 'audit-test-digest',
            url: 'https://plugins.example.com/audit.json'
          },
          runtimeIndex: {
            url: 'https://plugins.example.com/runtime/index.json',
            indexId: 'openpencil.marketplace.runtime',
            keyId: 'marketplace.root.2026',
            digest: 'runtime-index-test-digest'
          },
          integrity: {
            algorithm: 'SHA-256',
            digest,
            signature: {
              algorithm: 'Ed25519',
              keyId: 'marketplace.root.2026',
              value: 'marketplace-test-signature'
            }
          }
        },
        verifiedDigest: digest,
        verifiedKeyId: 'marketplace.root.2026',
        verifiedAt: '2026-08-05T00:00:00.000Z',
        publisherKeyring: {
          schemaVersion: 1,
          keys: [
            {
              keyId,
              publisherId,
              pluginIds: [pluginId],
              publicKey: pair.publicKey,
              notBefore: '2026-01-01T00:00:00.000Z',
              notAfter: '2027-01-01T00:00:00.000Z'
            }
          ]
        },
        diagnostics: []
      }
    }
  }, MAP_PLUGIN_ID)
}

test('installs and manages offline plugins without changing existing canvas modules', async ({
  page
}) => {
  test.setTimeout(30_000)
  await page.goto('/?test')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()

  await openPlugins(page)
  await expect(page.getByTestId('plugin-remote-catalog-status')).toContainText('Not configured')
  await expect(page.getByTestId('plugin-remote-catalog-refresh')).toBeDisabled()
  await expect(page.getByTestId('plugin-marketplace-summary')).toHaveCount(0)
  await expect(page.getByTestId(`plugin-catalog-${MAP_PLUGIN_ID}`)).toContainText('Installed')
  await expect(page.getByTestId(`plugin-catalog-${CHART_PLUGIN_ID}`)).toContainText('App bundle')

  const discoverSearch = page.getByTestId('plugin-discover-search')
  await discoverSearch.fill('deterministic')
  await expect(page.getByTestId(`plugin-catalog-${CHART_PLUGIN_ID}`)).toBeVisible()
  await expect(page.getByTestId(`plugin-catalog-${MAP_PLUGIN_ID}`)).toBeHidden()
  await discoverSearch.fill('OpenStreetMap')
  await expect(page.getByTestId(`plugin-catalog-${MAP_PLUGIN_ID}`)).toBeVisible()
  await expect(page.getByTestId(`plugin-catalog-${CHART_PLUGIN_ID}`)).toBeHidden()
  await discoverSearch.fill('')

  await selectPluginView(page, 'Installed')
  const mapCard = page.getByTestId(`plugin-installed-${MAP_PLUGIN_ID}`)
  await expect(mapCard).toContainText('Version')
  await expect(page.getByTestId(`plugin-enabled-${MAP_PLUGIN_ID}`)).toBeChecked()

  await selectPluginView(page, 'Browse')
  await page.getByTestId(`plugin-install-${CHART_PLUGIN_ID}`).click()
  await expect(page.getByTestId(`plugin-installed-${CHART_PLUGIN_ID}`)).toBeVisible()

  await selectPluginView(page, 'Installed')
  const chartCard = page.getByTestId(`plugin-installed-${CHART_PLUGIN_ID}`)
  const chartSwitch = page.getByTestId(`plugin-enabled-${CHART_PLUGIN_ID}`)
  await expect(chartCard).toContainText('Version')
  await expect(chartSwitch).not.toBeChecked()
  await expect(
    page.getByTestId(`plugin-add-${CHART_PLUGIN_ID}-${CHART_MODULE_TYPE}`)
  ).toBeDisabled()

  await chartSwitch.click()
  await expect(chartSwitch).toBeChecked()
  await expect(page.getByTestId(`plugin-add-${CHART_PLUGIN_ID}-${CHART_MODULE_TYPE}`)).toBeEnabled()

  const pinButton = page.getByTestId(`plugin-pin-${CHART_PLUGIN_ID}`)
  await pinButton.click()
  await expect(chartCard).toContainText('Pinned')
  await expect(pinButton).toContainText('Unpin digest')
  await pinButton.click()
  await expect(chartCard).not.toContainText('Pinned')
  await expect(pinButton).toContainText('Pin digest')

  await page.getByTestId('app-settings-done').click()
  await page.reload()
  await canvas.waitForInit()
  await openPlugins(page)
  await selectPluginView(page, 'Installed')
  await expect(page.getByTestId(`plugin-installed-${CHART_PLUGIN_ID}`)).toBeVisible()
  await expect(page.getByTestId(`plugin-enabled-${CHART_PLUGIN_ID}`)).toBeChecked()

  await page.getByTestId(`plugin-add-${CHART_PLUGIN_ID}-${CHART_MODULE_TYPE}`).click()
  await expect(page.getByTestId('app-settings-dialog')).toBeHidden()
  const chartLayer = page.getByTestId('layers-item').filter({ hasText: 'Chart' })
  await expect(chartLayer).toBeVisible()

  await openPlugins(page)
  await selectPluginView(page, 'Installed')
  await page.getByTestId(`plugin-uninstall-${CHART_PLUGIN_ID}`).click()
  await expect(page.getByTestId('plugin-uninstall-dialog')).toBeVisible()
  await page.getByTestId('plugin-uninstall-confirm').click()
  await expect(page.getByTestId(`plugin-installed-${CHART_PLUGIN_ID}`)).toBeHidden()

  await selectPluginView(page, 'Browse')
  await expect(page.getByTestId(`plugin-install-${CHART_PLUGIN_ID}`)).toBeEnabled()
  await page.getByTestId('app-settings-done').click()
  await expect(chartLayer).toBeVisible()
  canvas.assertNoErrors()
})

test('exposes reviewed command and exporter actions only after enabling their plugins', async ({
  page
}) => {
  await page.goto('/?test')
  await new CanvasHelper(page).waitForInit()
  await openPlugins(page)

  for (const pluginId of [CLIPBOARD_PLUGIN_ID, TAURI_EXPORTER_PLUGIN_ID, VUE_EXPORTER_PLUGIN_ID]) {
    await selectPluginView(page, 'Browse')
    await expect(page.getByTestId(`plugin-catalog-${pluginId}`)).toBeVisible()
    await page.getByTestId(`plugin-install-${pluginId}`).click()
    await expect(page.getByTestId(`plugin-installed-${pluginId}`)).toBeVisible()
  }

  await selectPluginView(page, 'Installed')
  const clipboardSwitch = page.getByTestId(`plugin-enabled-${CLIPBOARD_PLUGIN_ID}`)
  const exporterSwitch = page.getByTestId(`plugin-enabled-${TAURI_EXPORTER_PLUGIN_ID}`)
  const vueExporterSwitch = page.getByTestId(`plugin-enabled-${VUE_EXPORTER_PLUGIN_ID}`)
  const copyText = page.getByTestId(`plugin-command-${CLIPBOARD_PLUGIN_ID}-copy-as-text`)
  const copySVG = page.getByTestId(`plugin-command-${CLIPBOARD_PLUGIN_ID}-copy-as-svg`)
  const copyJSX = page.getByTestId(`plugin-command-${CLIPBOARD_PLUGIN_ID}-copy-as-jsx`)
  const copyPNG = page.getByTestId(`plugin-command-${CLIPBOARD_PLUGIN_ID}-copy-as-png`)
  const exportProject = page.getByTestId(
    `plugin-exporter-${TAURI_EXPORTER_PLUGIN_ID}-tauri-react-source`
  )
  const exportVueProject = page.getByTestId(`plugin-exporter-${VUE_EXPORTER_PLUGIN_ID}-vue-source`)

  await expect(clipboardSwitch).not.toBeChecked()
  await expect(exporterSwitch).not.toBeChecked()
  await expect(vueExporterSwitch).not.toBeChecked()
  for (const action of [copyText, copySVG, copyJSX, copyPNG, exportProject, exportVueProject]) {
    await expect(action).toBeDisabled()
  }

  await clipboardSwitch.click()
  await exporterSwitch.click()
  await vueExporterSwitch.click()
  await expect(clipboardSwitch).toBeChecked()
  await expect(exporterSwitch).toBeChecked()
  await expect(vueExporterSwitch).toBeChecked()
  for (const action of [copyText, copySVG, copyJSX, copyPNG, exportProject, exportVueProject]) {
    await expect(action).toBeEnabled()
  }
})

test('shows verified marketplace snapshot and publisher control-plane badges', async ({ page }) => {
  await page.goto('/?test')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  await injectMarketplaceSnapshot(page)

  await openPlugins(page)
  const marketplace = page.getByTestId('plugin-marketplace-summary')
  await expect(marketplace).toBeVisible()
  await expect(page.getByTestId('plugin-marketplace-status')).toContainText('Verified now')
  await expect(marketplace).toContainText('openpencil.marketplace')
  await expect(marketplace).toContainText('Published · openpencil.marketplace.runtime')
  await expect(page.getByTestId('plugin-marketplace-audit-head')).toContainText('#19')

  const listing = page.getByTestId(`plugin-marketplace-listing-${MAP_PLUGIN_ID}`)
  await expect(listing).toContainText('stable')
  await expect(listing).toContainText('Publisher: Acme Spatial')
  await expect(listing).toContainText('Ownership')
  await expect(listing).toContainText('Signing key')
  await expect(listing.getByText('Active')).toHaveCount(3)
  canvas.assertNoErrors()
})

test('requires explicit runtime review and grant while exposing local audit decisions', async ({
  page
}) => {
  await page.goto('/?test')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()

  await page.evaluate(async (pluginId) => {
    const pluginApp = await import('/src/app/plugins/app.ts')
    const storeSnapshot = pluginApp.appPluginStoreSnapshot.value
    pluginApp.appPluginStoreSnapshot.value = {
      ...storeSnapshot,
      installed: storeSnapshot.installed.map((candidate) =>
        candidate.package.manifest.plugin.id === pluginId
          ? {
              ...candidate,
              package: { ...candidate.package, trustSource: 'publisher-signature' as const }
            }
          : candidate
      )
    }

    const manager = pluginApp.appPluginRuntimeManager
    type RuntimeReview = Awaited<ReturnType<typeof manager.review>>
    type RuntimePolicy = ReturnType<typeof manager.snapshot>['policies'][number]
    type RuntimeAuditEvent = RuntimePolicy['audit'][number]
    const capabilities = ['document.nodes.read'] as const
    const review: RuntimeReview = {
      pluginId,
      declarativeManifestDigest: 'declarative-test-digest',
      runtimePackageDigest: 'runtime-test-digest',
      kind: 'wasm',
      capabilities,
      executionStatus: 'eligible',
      executionReason: null,
      source: 'cache'
    }
    let audit: RuntimeAuditEvent[] = []

    function appendAudit(action: RuntimeAuditEvent['action']): void {
      audit = [
        ...audit,
        {
          sequence: audit.length + 1,
          occurredAt: new Date(Date.UTC(2026, 7, 5, 8, 0, audit.length)).toISOString(),
          action,
          runtimePackageDigest: review.runtimePackageDigest,
          reasonCode: null
        }
      ]
    }

    function policy(revokedAt: string | null): RuntimePolicy {
      return {
        schemaVersion: 1,
        pluginId,
        declarativeManifestDigest: review.declarativeManifestDigest,
        runtimePackageDigest: review.runtimePackageDigest,
        grantedCapabilities: capabilities,
        grantedAt: '2026-08-05T08:00:00.000Z',
        revokedAt,
        auditSequence: audit.length,
        audit
      }
    }

    function publishPolicy(value: RuntimePolicy): void {
      pluginApp.appPluginRuntimeSnapshot.value = {
        ...pluginApp.appPluginRuntimeSnapshot.value,
        ready: true,
        policies: [value]
      }
    }

    manager.review = async () => review
    manager.grant = async (requestedPluginId, expectedReview) => {
      if (
        requestedPluginId !== pluginId ||
        expectedReview.declarativeManifestDigest !== review.declarativeManifestDigest ||
        expectedReview.runtimePackageDigest !== review.runtimePackageDigest ||
        expectedReview.kind !== review.kind ||
        expectedReview.capabilities.join(',') !== review.capabilities.join(',')
      ) {
        throw new Error('Runtime grant did not preserve the reviewed package')
      }
      appendAudit('grant')
      const value = policy(null)
      publishPolicy(value)
      return value
    }
    manager.execute = async () => {
      appendAudit('execute-succeeded')
      publishPolicy(policy(null))
      return { ok: true }
    }
    manager.revoke = async () => {
      appendAudit('revoke')
      const value = policy('2026-08-05T08:00:02.000Z')
      publishPolicy(value)
      return value
    }
  }, MAP_PLUGIN_ID)

  await openPlugins(page)
  await selectPluginView(page, 'Installed')
  const runtime = page.getByTestId(`plugin-runtime-${MAP_PLUGIN_ID}`)
  await expect(runtime).toBeVisible()
  await expect(page.getByTestId(`plugin-runtime-status-${MAP_PLUGIN_ID}`)).toContainText(
    'Review required'
  )
  await expect(page.getByTestId(`plugin-runtime-grant-${MAP_PLUGIN_ID}`)).toBeDisabled()
  await expect(page.getByTestId(`plugin-runtime-run-${MAP_PLUGIN_ID}`)).toBeDisabled()
  await expect(runtime).toContainText('No local runtime decisions recorded')

  await page.getByTestId(`plugin-runtime-review-${MAP_PLUGIN_ID}`).click()
  await expect(page.getByTestId(`plugin-runtime-status-${MAP_PLUGIN_ID}`)).toContainText('Eligible')
  await expect(runtime).toContainText('document.nodes.read')
  await expect(page.getByTestId(`plugin-runtime-grant-${MAP_PLUGIN_ID}`)).toBeEnabled()

  await page.getByTestId(`plugin-runtime-grant-${MAP_PLUGIN_ID}`).click()
  await expect(page.getByTestId(`plugin-runtime-status-${MAP_PLUGIN_ID}`)).toContainText('Granted')
  await expect(page.getByTestId(`plugin-runtime-run-${MAP_PLUGIN_ID}`)).toBeEnabled()
  await expect(page.getByTestId(`plugin-runtime-revoke-${MAP_PLUGIN_ID}`)).toBeEnabled()
  await expect(runtime).toContainText('grant')

  await page.getByTestId(`plugin-runtime-run-${MAP_PLUGIN_ID}`).click()
  await expect(runtime).toContainText('{"ok":true}')
  await expect(runtime).toContainText('execute-succeeded')

  await page.evaluate(async () => {
    const { appPluginRuntimeManager } = await import('/src/app/plugins/app.ts')
    appPluginRuntimeManager.review = async () => {
      throw new Error('runtime review failed for test')
    }
  })
  await page.getByTestId(`plugin-runtime-review-${MAP_PLUGIN_ID}`).click()
  await expect(runtime).toContainText('runtime review failed for test')
  await expect(runtime).toContainText('{"ok":true}')

  await page.getByTestId(`plugin-runtime-revoke-${MAP_PLUGIN_ID}`).click()
  await expect(runtime).toContainText('revoke')
  await expect(page.getByTestId(`plugin-runtime-revoke-${MAP_PLUGIN_ID}`)).toBeDisabled()

  await page.getByTestId(`plugin-uninstall-${MAP_PLUGIN_ID}`).click()
  await page.getByTestId('plugin-uninstall-confirm').click()
  await expect(page.getByTestId(`plugin-installed-${MAP_PLUGIN_ID}`)).toBeHidden()
  await selectPluginView(page, 'Browse')
  await page.getByTestId(`plugin-install-${MAP_PLUGIN_ID}`).click()
  await selectPluginView(page, 'Installed')
  await page.evaluate(async (pluginId) => {
    const { appPluginStoreSnapshot } = await import('/src/app/plugins/app.ts')
    const snapshot = appPluginStoreSnapshot.value
    appPluginStoreSnapshot.value = {
      ...snapshot,
      installed: snapshot.installed.map((candidate) =>
        candidate.package.manifest.plugin.id === pluginId
          ? {
              ...candidate,
              package: { ...candidate.package, trustSource: 'publisher-signature' as const }
            }
          : candidate
      )
    }
  }, MAP_PLUGIN_ID)
  const reinstalledRuntime = page.getByTestId(`plugin-runtime-${MAP_PLUGIN_ID}`)
  await expect(reinstalledRuntime).toBeVisible()
  await expect(page.getByTestId(`plugin-runtime-status-${MAP_PLUGIN_ID}`)).toContainText(
    'Review required'
  )
  await expect(reinstalledRuntime).not.toContainText('runtime review failed for test')
  await expect(reinstalledRuntime).not.toContainText('{"ok":true}')
  canvas.assertNoErrors()
})

test('keeps the catalog usable when a pinned app-bundle digest needs recovery', async ({
  page
}) => {
  await page.goto('/?test')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  await openPlugins(page)
  await expect(page.getByTestId(`plugin-catalog-${MAP_PLUGIN_ID}`)).toBeVisible()
  await page.getByTestId('app-settings-done').click()

  const staleDigest = await makeMapPinStale(page)
  await page.reload()
  await canvas.waitForInit()
  await openPlugins(page)

  await expect(page.getByTestId('settings-plugins-load-error')).toBeVisible()
  const installMap = page.getByTestId(`plugin-install-${MAP_PLUGIN_ID}`)
  await expect(installMap).toBeEnabled()
  await expect(installMap).toContainText('Replace pinned version')
  await installMap.click()
  const replacementDialog = page.getByTestId('plugin-replace-pin-dialog')
  await expect(replacementDialog).toBeVisible()
  await expect(page.getByTestId('plugin-replace-pin-previous-digest')).toHaveText(
    `Pinned digest ${staleDigest}`
  )
  await expect(page.getByTestId('plugin-replace-pin-new-digest')).toHaveText(
    /^New digest app-bundle-sha256:[A-Za-z0-9_-]{43}$/
  )
  await replacementDialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(replacementDialog).toBeHidden()
  await expect(page.getByTestId('settings-plugins-load-error')).toBeVisible()
  await expect(installMap).toContainText('Replace pinned version')

  await installMap.click()
  await page.getByTestId('plugin-replace-pin-confirm').click()
  await expect(page.getByTestId('settings-plugins-load-error')).toBeHidden()
  await expect(page.getByTestId(`plugin-catalog-${MAP_PLUGIN_ID}`)).toContainText('Installed')
  canvas.assertNoErrors()
})

test('requires confirmation before resetting a future-schema local plugin record', async ({
  page
}) => {
  await page.goto('/?test')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  await openPlugins(page)
  await expect(page.getByTestId(`plugin-catalog-${MAP_PLUGIN_ID}`)).toContainText('Installed')
  await page.getByTestId('app-settings-done').click()

  await makeMapSchemaFuture(page)
  await page.reload()
  await canvas.waitForInit()
  await openPlugins(page)

  await expect(page.getByTestId('settings-plugins-load-error')).toBeVisible()
  const reset = page.getByTestId(`plugin-reset-local-state-${MAP_PLUGIN_ID}`)
  await expect(reset).toBeVisible()
  await reset.click()
  const dialog = page.getByTestId('plugin-reset-local-state-dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText(MAP_PLUGIN_ID)
  await page.getByTestId('plugin-reset-local-state-cancel').click()
  await expect(dialog).toBeHidden()
  await expect(page.getByTestId('settings-plugins-load-error')).toBeVisible()
  await expect(reset).toBeVisible()

  await reset.click()
  await page.getByTestId('plugin-reset-local-state-confirm').click()
  await expect(page.getByTestId('settings-plugins-load-error')).toBeHidden()
  await expect(page.getByTestId(`plugin-catalog-${MAP_PLUGIN_ID}`)).toContainText('Installed')
  await selectPluginView(page, 'Installed')
  await expect(page.getByTestId(`plugin-enabled-${MAP_PLUGIN_ID}`)).toBeChecked()
  canvas.assertNoErrors()
})

test('writes a verified lock for plugin modules used by the current document', async ({ page }) => {
  await page.goto('/?test')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()

  await openPlugins(page)
  await selectPluginView(page, 'Installed')
  const dependencyPanel = page.getByTestId('plugin-document-dependencies')
  await expect(dependencyPanel).toContainText('This document does not use plugin modules.')
  await expect(page.getByTestId('plugin-document-lock-status')).toContainText('Lock missing')
  await expect(page.getByTestId('plugin-document-write-lock')).toBeDisabled()

  await page.getByTestId(`plugin-add-${MAP_PLUGIN_ID}-${MAP_MODULE_TYPE}`).click()
  await expect(page.getByTestId('app-settings-dialog')).toBeHidden()

  await openPlugins(page)
  await selectPluginView(page, 'Installed')
  const dependency = page.getByTestId(`plugin-document-dependency-${MAP_PLUGIN_ID}`)
  await expect(dependency).toContainText('Document lock missing')
  await expect(dependency).toContainText('Modules: map')

  await page.getByTestId('plugin-document-write-lock').click()
  await expect(page.getByTestId('plugin-document-lock-status')).toContainText('Lock verified')
  await expect(dependency).toContainText('Ready')
  await expect(dependencyPanel).toContainText('Document plugin lock updated.')

  await changeMapModule(page, { configVersion: 2 })
  await expect(dependency).toContainText('Module config version mismatch')
  await expect(page.getByTestId('plugin-document-write-lock')).toBeDisabled()

  await changeMapModule(page, { moduleType: 'unknown-module', configVersion: 1 })
  await expect(dependency).toContainText('Module not declared by accepted plugin')
  await expect(dependency).toContainText('Modules: unknown-module@v1')
  canvas.assertNoErrors()
})

test('blocks a pending update with a host-incompatible module contribution', async ({ page }) => {
  await page.goto('/?test')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  await showIncompatiblePendingMapUpdate(page)

  await openPlugins(page)
  await selectPluginView(page, 'Installed')
  const compatibility = page.getByTestId(`plugin-update-compatibility-${MAP_PLUGIN_ID}`)
  await expect(compatibility).toContainText(
    'map: Plugin module config version 2 is incompatible with host version 1'
  )
  await expect(page.getByTestId(`plugin-update-accept-${MAP_PLUGIN_ID}`)).toBeDisabled()
  canvas.assertNoErrors()
})
