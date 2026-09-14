import { expect, test, type Page } from '@playwright/test'

import {
  closeBackendPreviewIfOpen,
  openAdvancedProviderSettings,
  openBackendLibrary
} from '#tests/helpers/backend-library'
import { CanvasHelper } from '#tests/helpers/canvas'

async function documentState(page: Page) {
  return page.evaluate(() => {
    const editor = window.openPencil?.getStore?.()
    if (!editor) throw new Error('Missing editor')
    const root = editor.graph.getNode(editor.graph.rootId)
    return {
      pages: editor.graph.getPages().map((entry) => entry.id),
      pluginData: root?.pluginData,
      state: root?.lowcodeDocumentState,
      authRedirect: root?.lowcodeAuthRedirect
    }
  })
}

test.beforeEach(async ({ page }) => {
  test.setTimeout(30_000)
  await page.route('http://127.0.0.1:7600/health', (route) =>
    route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
  )
  await page.goto('/')
  await new CanvasHelper(page).waitForInit()
})

test('searches and inspects the library without changing the document or a custom application ID', async ({
  page
}, info) => {
  await openAdvancedProviderSettings(page)
  const panel = page.getByTestId('lowcode-backend-editor')
  const applicationId = panel.getByTestId('lowcode-backend-application-id')
  await applicationId.fill('my_notes_application')
  await applicationId.blur()
  const before = await documentState(page)
  const library = await openBackendLibrary(page)
  const search = library.getByRole('searchbox', { name: 'Search backend library', exact: true })
  await expect(search).toBeFocused()
  await library.getByRole('button', { name: 'Templates', exact: true }).click()
  const notes = library.getByRole('button', { name: 'Personal notes', exact: true })
  const shop = library.getByRole('button', { name: 'Single-item checkout', exact: true })
  await expect(notes).toBeVisible()
  await expect(shop).toBeVisible()
  await expect(
    library.getByRole('button', { name: 'Single-merchant shop', exact: true })
  ).toBeVisible()
  await expect(
    library.getByRole('button', { name: 'Multi-merchant marketplace', exact: true })
  ).toBeVisible()
  await notes.click()
  await expect(library.getByRole('button', { name: 'Use template', exact: true })).toBeVisible()
  expect(await documentState(page)).toEqual(before)
  await search.fill('  PERSONAL NOTES  ')
  await expect(notes).toBeVisible()
  await expect(shop).toHaveCount(0)
  await search.fill('no-matching-backend-79141')
  await expect(notes).toHaveCount(0)
  await expect(shop).toHaveCount(0)
  await expect(library.getByText(/No .*match/i)).toBeVisible()
  await search.fill('')
  await library.getByRole('button', { name: 'Providers', exact: true }).click()
  await expect(notes).toHaveCount(0)
  await expect(shop).toHaveCount(0)
  await library.getByRole('button', { name: 'All', exact: true }).click()
  await expect(notes).toBeVisible()
  await expect(shop).toBeVisible()
  await page.screenshot({ path: info.outputPath('backend-library-browse.png') })
  await page.keyboard.press('Escape')
  await expect(library).toBeHidden()
  await expect(
    page.getByRole('button', { name: 'Browse backend library', exact: true })
  ).toBeFocused()
  await expect(applicationId).toHaveValue('my_notes_application')
  expect(await documentState(page)).toEqual(before)
})

test('uses a notes template only after public identity configuration and restores it with one undo', async ({
  page
}, info) => {
  await openAdvancedProviderSettings(page)
  const panel = page.getByTestId('lowcode-backend-editor')
  await panel.getByTestId('lowcode-backend-application-id').fill('library_notes_custom')
  await panel.getByTestId('lowcode-backend-application-id').blur()
  const before = await documentState(page)
  const library = await openBackendLibrary(page)
  await library.getByRole('button', { name: 'Personal notes', exact: true }).click()
  await library
    .getByRole('combobox', { name: 'Authentication profile', exact: true })
    .selectOption({ label: 'Custom OIDC' })
  const apply = library.getByRole('button', { name: 'Use template', exact: true })
  await expect(apply).toBeDisabled()
  await library
    .getByRole('textbox', { name: 'OIDC issuer', exact: true })
    .fill('https://identity.example.com')
  await expect(apply).toBeDisabled()
  for (const invalid of ['two words', '中文ID']) {
    await library.getByRole('textbox', { name: 'Client ID', exact: true }).fill(invalid)
    await expect(apply).toBeDisabled()
  }
  await library
    .getByRole('textbox', { name: 'Client ID', exact: true })
    .fill('library-public-client')
  await expect(apply).toBeEnabled()
  expect(await documentState(page)).toEqual(before)
  await apply.click()
  await expect(library).toBeHidden()
  await closeBackendPreviewIfOpen(page)
  const pages = page.getByTestId('pages-panel')
  await expect(pages.getByTestId('pages-item')).toHaveCount(3)
  await expect(pages.getByTestId('pages-item').filter({ hasText: 'Personal notes' })).toBeVisible()
  await expect(pages.getByTestId('pages-item').filter({ hasText: 'Notes login' })).toBeVisible()
  await openAdvancedProviderSettings(page)
  await expect(panel.getByTestId('lowcode-backend-application-id')).toHaveValue(
    'library_notes_custom'
  )
  await panel.getByRole('button', { name: 'HTTP API & Login', exact: true }).click()
  await expect(panel.getByLabel('Identity issuer URL', { exact: true })).toHaveValue(
    'https://identity.example.com'
  )
  await expect(panel.getByLabel('Public client ID', { exact: true })).toHaveValue(
    'library-public-client'
  )
  const after = await documentState(page)
  await page.screenshot({ path: info.outputPath('backend-library-notes-created.png') })
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press('Meta+z')
  await expect(pages.getByTestId('pages-item')).toHaveCount(1)
  expect(await documentState(page)).toEqual(before)
  await page.keyboard.press('Meta+Shift+z')
  await expect(pages.getByTestId('pages-item')).toHaveCount(3)
  expect(await documentState(page)).toEqual(after)
  const again = await openBackendLibrary(page)
  await again.getByRole('button', { name: 'Single-item checkout', exact: true }).click()
  await expect(again.getByRole('button', { name: 'Use template', exact: true })).toBeDisabled()
  await expect(again).toContainText('Your current backend and login flow are preserved.')
  await page.keyboard.press('Escape')
  expect(await documentState(page)).toEqual(after)
})

test('selects a provider explicitly for the draft without writing the document', async ({
  page
}) => {
  const provider = await openAdvancedProviderSettings(page)
  const initial = await provider.inputValue()
  const chosen = initial.includes('nestjs') ? 'Supabase' : 'NestJS'
  const before = await documentState(page)
  const library = await openBackendLibrary(page)
  await library.getByRole('button', { name: 'Providers', exact: true }).click()
  await library.getByRole('button', { name: chosen, exact: true }).click()
  await expect(provider).toHaveValue(initial)
  expect(await documentState(page)).toEqual(before)
  const select = library.getByRole('button', { name: 'Select provider', exact: true })
  await expect(select).toBeEnabled()
  await select.click()
  await expect(library).toBeHidden()
  await expect(provider).toHaveValue(new RegExp(chosen.toLowerCase()))
  expect(await documentState(page)).toEqual(before)
})

test('preserves an authored model draft and explains why applying a starter is blocked', async ({
  page
}) => {
  const provider = await openAdvancedProviderSettings(page)
  await provider.selectOption({ label: 'nestjs · open-pencil.nestjs-backend' })
  const panel = page.getByTestId('lowcode-backend-editor')
  await panel.getByRole('button', { name: 'Create personal notes model', exact: true }).click()
  await expect(page.getByTestId('pages-panel').getByTestId('pages-item')).toHaveCount(1)
  await panel.getByRole('button', { name: 'Data model', exact: true }).click()
  await panel.getByTestId('lowcode-backend-add-entity').click()
  const entityName = panel.getByTestId('lowcode-backend-entity-name').last()
  await entityName.fill('custom_inventory')
  await entityName.blur()
  const before = await documentState(page)
  const library = await openBackendLibrary(page)
  await library.getByRole('button', { name: 'Single-item checkout', exact: true }).click()
  await expect(library.getByRole('button', { name: 'Use template', exact: true })).toBeDisabled()
  await expect(library).toContainText(
    'Your draft has changes. Continue editing this model, or use a new document for a starter.'
  )
  await page.keyboard.press('Escape')
  await expect(entityName).toHaveValue('custom_inventory')
  await expect(panel.getByTestId('lowcode-backend-entity')).toHaveCount(2)
  expect(await documentState(page)).toEqual(before)
})

test('keeps library navigation within the dialog and fits a narrow desktop window', async ({
  page
}, info) => {
  await page.setViewportSize({ width: 720, height: 800 })
  const library = await openBackendLibrary(page)
  await expect(
    library.getByRole('searchbox', { name: 'Search backend library', exact: true })
  ).toBeFocused()
  await page.keyboard.press('Tab')
  expect(await library.evaluate((element) => element.contains(document.activeElement))).toBe(true)
  await library.getByRole('button', { name: 'Personal notes', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(library.getByRole('button', { name: 'Use template', exact: true })).toBeVisible()
  const dimensions = await library.evaluate((element) => ({
    width: element.clientWidth,
    scrollWidth: element.scrollWidth,
    overflowing: [...element.querySelectorAll<HTMLElement>('*')]
      .filter((child) => child.scrollWidth > child.clientWidth + 1)
      .map((child) => ({
        tag: child.tagName,
        classes: child.className,
        width: child.clientWidth,
        scrollWidth: child.scrollWidth
      }))
      .slice(0, 15)
  }))
  await info.attach('backend-library-narrow-dimensions', {
    body: JSON.stringify(dimensions, null, 2),
    contentType: 'application/json'
  })
  await page.screenshot({ path: info.outputPath('backend-library-narrow-layout.png') })
  await expect
    .poll(() => library.evaluate((element) => element.scrollWidth <= element.clientWidth + 1))
    .toBe(true)
  const bounds = await library.boundingBox()
  if (!bounds) throw new Error('Backend library is not visible')
  expect(bounds.x).toBeGreaterThanOrEqual(0)
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(720)
  for (let index = 0; index < 16; index++) {
    await page.keyboard.press('Tab')
    expect(await library.evaluate((element) => element.contains(document.activeElement))).toBe(true)
  }
  await page.screenshot({ path: info.outputPath('backend-library-narrow.png') })
  await page.keyboard.press('Escape')
  await expect(library).toBeHidden()
  await expect(
    page.getByRole('button', { name: 'Browse backend library', exact: true })
  ).toBeFocused()
})

test('shows translated backend cards and details after switching the isolated editor to Chinese', async ({
  page
}, info) => {
  const before = await documentState(page)
  await page.getByTestId('app-settings-trigger').click()
  await page.getByTestId('settings-language').click()
  await page.getByRole('option', { name: '中文（简体）', exact: true }).click()
  await page.getByTestId('app-settings-done').click()
  await page.getByRole('button', { name: '浏览后端库', exact: true }).click()
  const library = page.getByRole('dialog', { name: '后端库', exact: true })
  await expect(library).toBeVisible()
  await expect(library.getByRole('searchbox', { name: '搜索后端库', exact: true })).toBeFocused()
  await library.getByRole('button', { name: '应用模板', exact: true }).click()
  await library.getByRole('button', { name: '个人笔记', exact: true }).click()
  await expect(library.getByRole('button', { name: '使用模板', exact: true })).toBeVisible()
  await expect(library).toContainText('只能访问自己的笔记')
  await library.getByRole('button', { name: '多商户平台', exact: true }).click()
  await expect(library.getByRole('heading', { name: '应用模式', exact: true })).toBeVisible()
  await expect(library.getByRole('heading', { name: '角色与访问权限', exact: true })).toBeVisible()
  await expect(library).toContainText('一账号一店')
  await expect(library).toContainText('不含支付、多商品购物车、物流、分账或平台管理页面。')
  await page.screenshot({ path: info.outputPath('backend-library-chinese.png') })
  await page.keyboard.press('Escape')
  expect(await documentState(page)).toEqual(before)
})

test('disables template use while the provider registry is loading', async ({ page }) => {
  const before = await documentState(page)
  const library = await openBackendLibrary(page)
  await library.getByRole('button', { name: 'Personal notes', exact: true }).click()
  await page.evaluate(async () => {
    const { appPluginStoreSnapshot } = await import('/src/app/plugins/app.ts')
    appPluginStoreSnapshot.value = { ...appPluginStoreSnapshot.value, ready: false }
  })
  try {
    await expect(
      library.getByRole('status').filter({ hasText: 'Loading providers…' })
    ).toBeVisible()
    await expect(library.getByRole('button', { name: 'Use template', exact: true })).toHaveCount(0)
    await expect(
      library.getByRole('button', { name: 'Manage plugins', exact: true })
    ).toBeDisabled()
    expect(await documentState(page)).toEqual(before)
  } finally {
    await page.evaluate(async () => {
      const { appPluginStore, appPluginStoreSnapshot } = await import('/src/app/plugins/app.ts')
      appPluginStoreSnapshot.value = appPluginStore.snapshot()
    })
  }
  await expect(library.getByRole('button', { name: 'Use template', exact: true })).toBeEnabled()
})

test('explains unavailable providers and keeps their templates disabled', async ({
  page
}, info) => {
  const before = await documentState(page)
  await page.getByTestId('app-settings-trigger').click()
  await page.getByTestId('settings-section-plugins').click()
  await page.getByTestId('settings-plugins-view').getByText('Installed', { exact: true }).click()
  const enabled = page.getByTestId('plugin-enabled-open-pencil.nestjs-backend')
  await expect(enabled).toBeChecked()
  await enabled.click()
  await expect(enabled).not.toBeChecked()
  await page.getByTestId('app-settings-done').click()
  const library = await openBackendLibrary(page)
  await library.getByRole('button', { name: 'NestJS', exact: true }).click()
  await expect(library.getByRole('button', { name: 'Select provider', exact: true })).toHaveCount(0)
  await expect(library).toContainText('Provider unavailable')
  await library.getByRole('button', { name: 'Personal notes', exact: true }).click()
  await expect(library.getByRole('button', { name: 'Use template', exact: true })).toHaveCount(0)
  await expect(library).toContainText('Manage installation and enabled state in Plugins.')
  await page.screenshot({ path: info.outputPath('backend-library-unavailable.png') })
  await library.getByRole('button', { name: 'Manage plugins', exact: true }).click()
  await expect(library).toBeHidden()
  await expect(page.getByTestId('settings-plugins-panel')).toBeVisible()
  expect(await documentState(page)).toEqual(before)
})
