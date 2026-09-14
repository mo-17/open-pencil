import { expect, test, type Page } from '@playwright/test'

import type * as BackendDocumentModule from '@/app/lowcode/backend/document'

import {
  closeBackendPreviewIfOpen,
  openAdvancedProviderSettings,
  openBackendLibrary,
  useBackendTemplate
} from '#tests/helpers/backend-library'
import { CanvasHelper } from '#tests/helpers/canvas'

async function applicationSnapshot(page: Page) {
  return page.evaluate(async () => {
    const url = new URL('/src/app/lowcode/backend/document.ts', location.origin).href
    const { readBackendProviderDocumentRequest } = (await import(
      /* @vite-ignore */ url
    )) as typeof BackendDocumentModule
    const editor = window.openPencil?.getStore?.()
    if (!editor) throw new Error('Missing test editor')
    const application = readBackendProviderDocumentRequest(editor.graph)?.application
    const root = editor.graph.getNode(editor.graph.rootId)
    return {
      pages: editor.graph
        .getPages()
        .map((entry) => ({ id: entry.id, name: entry.name, path: entry.lowcodeRoutePattern })),
      applicationId: application?.applicationId,
      authentication: application?.httpApi?.browserClient,
      modules: application?.modules?.modules.map((entry) => entry.id),
      resources: application?.httpApi?.resources.map((entry) => entry.id),
      authRedirect: root?.lowcodeAuthRedirect,
      documentState: root?.lowcodeDocumentState,
      pluginData: root?.pluginData
    }
  })
}

test.beforeEach(async ({ page }) => {
  test.setTimeout(60_000)
  await page.route('http://127.0.0.1:7600/health', (route) =>
    route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
  )
  await page.goto('/')
  await new CanvasHelper(page).waitForInit()
  await useBackendTemplate(page, 'Customer CRM')
  await closeBackendPreviewIfOpen(page)
})

test('adds Service desk through a compatibility review while keeping CRM and one shared login/account', async ({
  page
}, info) => {
  const before = await applicationSnapshot(page)
  const library = await openBackendLibrary(page)
  await library.getByRole('button', { name: 'Customer CRM', exact: true }).click()
  await expect(library.getByRole('button', { name: 'Add module', exact: true })).toBeDisabled()
  await expect(library.getByRole('region', { name: 'Customer CRM', exact: true })).toContainText(
    'already installed'
  )
  await library.getByRole('button', { name: 'Service desk', exact: true }).click()
  const review = library.getByRole('region', { name: 'Service desk', exact: true })
  await expect(review).toContainText('share the existing sign-in')
  await expect(review).toContainText('New pages: 2')
  await expect(review).toContainText('/business-login')
  await expect(review).toContainText('/account-setup')
  await expect(
    library.getByRole('combobox', { name: 'Authentication profile', exact: true })
  ).toHaveCount(0)
  expect(await applicationSnapshot(page)).toEqual(before)
  await page.screenshot({ path: info.outputPath('module-installation-review.png') })
  const add = library.getByRole('button', { name: 'Add module', exact: true })
  await expect(add).toBeEnabled()
  await add.click()
  await expect(library).toBeHidden()
  await closeBackendPreviewIfOpen(page)
  await expect(page.getByTestId('pages-panel').getByTestId('pages-item')).toHaveCount(6)
  const after = await applicationSnapshot(page)
  expect(after.applicationId).toBe(before.applicationId)
  expect(after.authentication).toEqual(before.authentication)
  expect(after.authRedirect).toBe(before.authRedirect)
  expect(after.modules).toEqual(expect.arrayContaining(['customer-crm', 'service-desk']))
  expect(after.resources).toEqual(
    expect.arrayContaining(['customers', 'tickets', 'users', 'service-desk-users'])
  )
  expect(after.pages).toEqual(expect.arrayContaining(before.pages))
  expect(after.pages.filter((entry) => entry.path === before.authRedirect)).toHaveLength(1)
  expect(after.pages.filter((entry) => entry.path?.startsWith('/account-setup'))).toHaveLength(1)
  const panel = page.getByTestId('lowcode-backend-editor')
  await panel.getByRole('button', { name: 'Data model', exact: true }).click()
  const model = page.getByTestId('lowcode-backend-model')
  const entities = model.getByTestId('lowcode-backend-entity')
  const entityCount = await entities.count()
  const addTable = model.getByTestId('lowcode-backend-add-entity')
  await expect(addTable).toBeDisabled()
  await model.getByTestId('lowcode-backend-new-entity-module').selectOption('service-desk')
  await expect(addTable).toBeEnabled()
  await addTable.click()
  await expect(entities).toHaveCount(entityCount + 1)
  await entities.last().getByRole('button', { name: 'Remove entity', exact: true }).click()
  await expect(entities).toHaveCount(entityCount)
  await expect(model.locator('p.text-red-500')).toHaveCount(0)
  expect(await applicationSnapshot(page)).toEqual(after)
  await page.screenshot({ path: info.outputPath('crm-with-service-desk.png') })
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  })
  await page.keyboard.press('Meta+z')
  await expect(page.getByTestId('pages-panel').getByTestId('pages-item')).toHaveCount(4)
  expect(await applicationSnapshot(page)).toEqual(before)
  await page.keyboard.press('Meta+Shift+z')
  await expect(page.getByTestId('pages-panel').getByTestId('pages-item')).toHaveCount(6)
  expect(await applicationSnapshot(page)).toEqual(after)
  const installed = await openBackendLibrary(page)
  await installed.getByRole('button', { name: 'Service desk', exact: true }).click()
  await expect(installed.getByRole('button', { name: 'Add module', exact: true })).toBeDisabled()
  await expect(installed.getByRole('region', { name: 'Service desk', exact: true })).toContainText(
    'already installed'
  )
})

test('shows a blocked module review for an unsaved Backend draft without changing the application', async ({
  page
}, info) => {
  const before = await applicationSnapshot(page)
  await openAdvancedProviderSettings(page)
  const applicationId = page.getByTestId('lowcode-backend-application-id')
  await applicationId.fill('changed-unsaved-application')
  await applicationId.blur()
  const library = await openBackendLibrary(page)
  await library.getByRole('button', { name: 'Service desk', exact: true }).click()
  await expect(library.getByRole('button', { name: 'Add module', exact: true })).toBeDisabled()
  await expect(library.getByRole('region', { name: 'Service desk', exact: true })).toContainText(
    'Save or discard the current Backend draft'
  )
  await expect(
    library.getByRole('combobox', { name: 'Authentication profile', exact: true })
  ).toHaveCount(0)
  expect(await applicationSnapshot(page)).toEqual(before)
  await page.screenshot({ path: info.outputPath('module-blocked-draft.png') })
  await page.keyboard.press('Escape')
  await expect(library).toBeHidden()
  await expect(applicationId).toHaveValue('changed-unsaved-application')
})
