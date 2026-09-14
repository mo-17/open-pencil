import { expect, test } from '@playwright/test'

import type * as BackendDocumentModule from '@/app/lowcode/backend/document'

import { closeBackendPreviewIfOpen, openBackendLibrary } from '#tests/helpers/backend-library'
import { CanvasHelper } from '#tests/helpers/canvas'

const cases = [
  {
    title: 'Customer CRM',
    count: 3,
    role: 'crm-manager',
    command: 'create-customer',
    resource: 'customers'
  },
  {
    title: 'Service desk',
    count: 4,
    role: 'support-approver',
    command: 'request-ticket-approval',
    resource: 'tickets'
  },
  {
    title: 'Content and knowledge base',
    count: 6,
    role: 'content-publisher',
    command: 'publish-public-article',
    resource: 'published-articles'
  },
  {
    title: 'Bookings and registration',
    count: 5,
    role: 'booking-manager',
    command: 'reserve-booking',
    resource: 'slots'
  },
  {
    title: 'Projects and tasks',
    count: 4,
    role: 'project-manager',
    command: 'create-task',
    resource: 'project-members'
  }
] as const

test.beforeEach(async ({ page }) => {
  test.setTimeout(60_000)
  await page.route('http://127.0.0.1:7600/health', (route) =>
    route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
  )
  await page.goto('/')
  await new CanvasHelper(page).waitForInit()
})

for (const example of cases)
  test(`installs ${example.title} with working account setup and reviewed commands`, async ({
    page
  }, info) => {
    const library = await openBackendLibrary(page)
    await library.getByRole('button', { name: example.title, exact: true }).click()
    const details = library.getByRole('region', { name: example.title, exact: true })
    await expect(details).toContainText(example.role)
    await expect(details).toContainText('Account setup')
    await expect(details).toContainText('Creation does not grant roles')
    await expect(details).toContainText('Connect attachments')
    await expect(
      library.getByRole('spinbutton', { name: 'Commission (basis points)', exact: true })
    ).toHaveCount(0)
    await page.screenshot({ path: info.outputPath('business-template-review.png') })
    await library.getByRole('button', { name: 'Use template', exact: true }).click()
    await expect(library).toBeHidden()
    await closeBackendPreviewIfOpen(page)
    await expect(page.getByTestId('pages-panel').getByTestId('pages-item')).toHaveCount(
      example.count + 1
    )
    const request = await page.evaluate(async () => {
      const url = new URL('/src/app/lowcode/backend/document.ts', location.origin).href
      const { readBackendProviderDocumentRequest } = (await import(
        /* @vite-ignore */ url
      )) as typeof BackendDocumentModule
      const editor = window.openPencil?.getStore?.()
      if (!editor) throw new Error('Missing test editor')
      const application = readBackendProviderDocumentRequest(editor.graph)?.application
      return {
        commands: application?.commands?.commands.map((command) => command.id),
        resources: application?.httpApi?.resources.map((resource) => ({
          id: resource.id,
          operations: resource.operations
        })),
        commerce: application?.commerce
      }
    })
    expect(request.commands).toContain('register-business-user')
    expect(request.commands).toContain(example.command)
    expect(request.resources).toContainEqual({ id: example.resource, operations: ['list', 'read'] })
    expect(request.commerce).toBeUndefined()
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    })
    await page.keyboard.press('Meta+z')
    await expect(page.getByTestId('pages-panel').getByTestId('pages-item')).toHaveCount(1)
    await page.keyboard.press('Meta+Shift+z')
    await expect(page.getByTestId('pages-panel').getByTestId('pages-item')).toHaveCount(
      example.count + 1
    )
    const existing = await openBackendLibrary(page)
    await existing.getByRole('button', { name: 'Personal notes', exact: true }).click()
    await expect(existing.getByRole('button', { name: 'Use template', exact: true })).toBeDisabled()
    await expect(existing).toContainText('Your current backend and login flow are preserved.')
  })
