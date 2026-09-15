import { expect, type Page } from '@playwright/test'

import type { BusinessTestRow } from '#tests/engine/app/lowcode/backend/business/browser/transport/helpers'
import {
  finishBusinessRequest,
  submitBusinessAction,
  type withBusinessBrowser
} from '#tests/helpers/compiler/business/helpers'

export const publishingId = (tail: string) => '00000000-0000-4000-8000-' + tail.padStart(12, '0')
export const publishingDate = '2030-01-01T00:00:00.000Z'
export const publishingBody =
  '<em>Literal editorial text</em>\n' +
  'A manually written article paragraph.\n'.repeat(90) +
  'Final paragraph.'

export const publishingCases = [
  {
    kind: 'personal-blog' as const,
    domain: 'blog' as const,
    title: 'Personal blog',
    roles: ['blog-author'],
    pageTitles: [
      'Business sign in',
      'Account setup',
      'Blog categories',
      'Read blog',
      'My blog bookmarks',
      'Manage blog categories',
      'Write blog'
    ]
  },
  {
    kind: 'automotive-news' as const,
    domain: 'auto' as const,
    title: 'Automotive news',
    roles: ['auto-editor', 'auto-publisher'],
    pageTitles: [
      'Business sign in',
      'Account setup',
      'News categories',
      'Vehicle brands',
      'Vehicle models',
      'Automotive news',
      'My news bookmarks',
      'Manage news categories',
      'Manage vehicle brands',
      'Manage vehicle models',
      'Edit automotive news',
      'Publish automotive news'
    ]
  }
] as const

export type PublishingBrowserSession = Parameters<Parameters<typeof withBusinessBrowser>[3]>[0]

export function publishingBrowserActions(page: Page, api: PublishingBrowserSession['api']) {
  const navigate = (label: string) => page.getByRole('button', { name: label, exact: true }).click()
  const fill = async (values: Record<string, string>) => {
    for (const [label, value] of Object.entries(values))
      await page.getByPlaceholder(label, { exact: true }).fill(value)
  }
  const submit = async (
    label: string,
    commandId: string,
    payload: object,
    result: BusinessTestRow,
    resources: Record<string, BusinessTestRow[]>
  ) => {
    const before = api.calls.length
    api.steps.push({ commandId, payload, result, resources })
    await submitBusinessAction(page, label)
    await expect.poll(() => api.calls.length).toBe(before + 1)
    await finishBusinessRequest(page)
  }
  const catalog = async (
    pageTitle: string,
    entity: string,
    resource: string,
    parameter: string,
    row: BusinessTestRow
  ) => {
    await navigate(pageTitle)
    await navigate('Create entry')
    await fill({ Name: String(row.title), Description: String(row.description) })
    await page.getByRole('combobox').last().selectOption({ label: 'Active' })
    const payload = { title: row.title, description: row.description, active: true }
    const resources = { [resource]: [row], [resource.replace('-management', '')]: [row] }
    await submit('Create entry', `create-${entity}`, payload, row, resources)
    await navigate('Select record')
    await navigate('Edit entry')
    await expect(page.getByRole('combobox').last()).toHaveValue('Active')
    await submit(
      'Edit entry',
      `update-${entity}`,
      { [parameter]: row.id, ...payload },
      { ...row, version: 1 },
      resources
    )
  }
  return { navigate, fill, submit, catalog }
}

export async function expectScrollableArticle(page: Page, text: string): Promise<void> {
  const body = page.getByText('Article text: ' + text, { exact: true }).last()
  await expect(body).toBeVisible()
  await body.scrollIntoViewIfNeeded()
  await expect
    .poll(() =>
      body.evaluate((element) => {
        const style = getComputedStyle(element)
        return style.overflowY === 'auto' && element.scrollHeight > element.clientHeight
      })
    )
    .toBe(true)
  await body.evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  expect(
    await body.evaluate(
      (element) =>
        element.scrollTop > 0 &&
        element.scrollTop >= element.scrollHeight - element.clientHeight - 1
    )
  ).toBe(true)
  await expect(page.locator('em').filter({ hasText: 'Literal editorial text' })).toHaveCount(0)
}
