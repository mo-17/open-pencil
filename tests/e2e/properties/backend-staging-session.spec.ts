import { expect, test, type Page } from '@playwright/test'
import type * as Vue from 'vue'

import type * as ActiveEditor from '@/app/editor/active-store'
import type * as StagingRelease from '@/app/lowcode/supabase/backend/provider-staging-release'
import type { DesktopSupabaseBackendReviewResult } from '@/app/plugins/host/deployment/desktop/supabase/backend/review'
import type * as StagingService from '@/app/plugins/host/deployment/desktop/supabase/backend/staging/release'
import type * as Tabs from '@/app/tabs'

import { CanvasHelper } from '#tests/helpers/canvas'

const PROJECT_REF = 'enekobitnhobuiuamvqj'

test('Inspector preserves a thrown staging unknown outcome across configuration and editor lifecycles', async ({
  page
}) => {
  test.setTimeout(60_000)
  let remoteRequests = 0
  await page.route(
    (url) => /(^|\.)supabase\.(co|com|in)$/u.test(url.hostname),
    (route) => {
      remoteRequests += 1
      return route.abort('blockedbyclient')
    }
  )
  await page.route('http://127.0.0.1:7600/health', (route) =>
    route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
  )
  await page.addInitScript(() => performance.setResourceTimingBufferSize(10_000))
  const canvas = new CanvasHelper(page)
  await page.goto('/')
  await canvas.waitForInit()
  await page.evaluate((projectRef) => {
    const editor = window.openPencil?.getStore?.()
    if (!editor) throw new Error('App editor is not initialized')
    editor.graph.updateNode(editor.graph.rootId, {
      lowcodeSupabaseConfig: {
        url: `https://${projectRef}.supabase.co`,
        anonKey: '',
        schema: 'public'
      }
    })
  }, PROJECT_REF)
  const inspector = page.getByTestId('lowcode-supabase-schema-inspector')
  await expect(inspector).toBeVisible()
  await expect(page.getByTestId('lowcode-supabase-backend-review-artifact')).toHaveCount(0)

  const seeded = await seedUnknownSession(page)
  expect(seeded).toEqual({
    calls: 1,
    state: 'outcome-unknown',
    error: 'outcome-unknown',
    result: null
  })
  await expectUnknownWithoutApply(page)

  // Change the actual document configuration through its property-panel control.
  const schema = page.getByTestId('lowcode-supabase-schema')
  await schema.fill('private')
  await schema.blur()
  await expect(schema).toHaveValue('private')
  await expectUnknownWithoutApply(page)

  // Selecting a canvas node unmounts the document inspector; deselecting mounts it again.
  await canvas.drawRect(160, 160, 100, 80)
  await expect(inspector).toHaveCount(0)
  await canvas.pressKey('Escape')
  await expect(inspector).toBeVisible()
  await expectUnknownWithoutApply(page)

  const ids = await page.evaluate(async () => {
    const resources = performance.getEntriesByType('resource').map((entry) => entry.name)
    const url = resources.find((entry) => new URL(entry).pathname === '/src/app/tabs/index.ts')
    if (!url) throw new Error('Active tab module was not loaded')
    const tabs: typeof Tabs = await import(url)
    const previous = tabs.getActiveStore()
    const firstId = tabs.getActiveTabId()
    const config = previous.graph.getNode(previous.graph.rootId)?.lowcodeSupabaseConfig
    if (!config) throw new Error('First editor configuration is missing')
    const next = tabs.createTab()
    next.store.graph.updateNode(next.store.graph.rootId, {
      lowcodeSupabaseConfig: structuredClone(config)
    })
    return {
      firstIndex: tabs.getTabsSnapshot().findIndex((tab) => tab.id === firstId),
      sameEditor: previous === next.store
    }
  })
  expect(ids.sameEditor).toBe(false)
  await canvas.waitForInit()
  await expect(schema).toHaveValue('private')
  await expect(inspector).toBeVisible()
  await expect(page.getByTestId('lowcode-supabase-backend-staging-no-retry')).toHaveCount(0)
  await expect(page.getByTestId('lowcode-supabase-backend-staging-error')).toHaveCount(0)
  await expect(page.getByTestId('lowcode-supabase-backend-staging-apply')).toHaveCount(0)

  await page.getByTestId('tabbar-tab').nth(ids.firstIndex).click()
  await canvas.waitForInit()
  await expect(schema).toHaveValue('private')
  await expectUnknownWithoutApply(page)
  expect(remoteRequests).toBe(0)
  canvas.assertNoErrors()
  await page.getByTestId('lowcode-supabase-backend-staging-no-retry').scrollIntoViewIfNeeded()
  await page.screenshot({ path: test.info().outputPath('staging-unknown-restored.png') })
})

async function expectUnknownWithoutApply(page: Page) {
  await expect(page.getByTestId('lowcode-supabase-backend-staging-release')).toBeVisible()
  await expect(page.getByTestId('lowcode-supabase-backend-staging-error')).toContainText(
    'staging outcome is unknown'
  )
  await expect(page.getByTestId('lowcode-supabase-backend-staging-no-retry')).toContainText(
    'Do not retry'
  )
  await expect(page.getByTestId('lowcode-supabase-backend-review-artifact')).toHaveCount(0)
  await expect(page.getByTestId('lowcode-supabase-backend-staging-receipt')).toHaveCount(0)
  await expect(page.getByTestId('lowcode-supabase-backend-staging-apply')).toHaveCount(0)
}

async function seedUnknownSession(page: Page) {
  return page.evaluate(async (projectRef) => {
    const resources = performance.getEntriesByType('resource').map((entry) => entry.name)
    const loadedURL = (path: string) => {
      const url = resources.find((entry) => new URL(entry).pathname === path)
      if (!url) throw new Error(`Active module was not loaded: ${path}`)
      return url
    }
    const vue: typeof Vue = await import(loadedURL('/node_modules/.vite/deps/vue.js'))
    const active: typeof ActiveEditor = await import(
      loadedURL('/src/app/editor/active-store/index.ts')
    )
    const staging: typeof StagingRelease = await import(
      loadedURL('/src/app/lowcode/supabase/backend/provider-staging-release.ts')
    )
    const service: typeof StagingService = await import(
      loadedURL('/src/app/plugins/host/deployment/desktop/supabase/backend/staging/release.ts')
    )
    const editor = active.getActiveEditorStore()
    const readConfig = () => editor.graph.getNode(editor.graph.rootId)?.lowcodeSupabaseConfig
    let calls = 0
    const scope = vue.effectScope()
    // Only seed the real composable's private session. This fixture grants no Host authority.
    const release = scope.run(() =>
      staging.useSupabaseBackendProviderStagingRelease(
        vue.computed(readConfig),
        vue.ref({
          artifact: { manifestDigest: 'local-ui-review' },
          projectRef,
          accountId: 'local-ui-account'
        } as DesktopSupabaseBackendReviewResult),
        () => editor.graph,
        {
          readContext: () => ({ identity: editor, readGraph: () => editor.graph, readConfig }),
          service: {
            async release(input) {
              calls += 1
              input.onTransition?.({ dispatch: 'dispatched' } as Parameters<
                NonNullable<typeof input.onTransition>
              >[0])
              throw new service.DesktopSupabaseBackendStagingReleaseError('outcome-unknown')
            }
          }
        }
      )
    )
    if (!release) throw new Error('Staging composable was not created')
    try {
      await release.release(projectRef, true)
      await release.release(projectRef, true)
      return {
        calls,
        state: release.state.value,
        error: release.error.value,
        result: release.result.value
      }
    } finally {
      scope.stop()
    }
  }, PROJECT_REF)
}
