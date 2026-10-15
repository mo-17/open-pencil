import { expect, test, type Page, type Route } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

const DRAFT_ENDPOINT = 'https://late-draft-storage.example'
const DRAFT_ROUTE = `${DRAFT_ENDPOINT}/**`

async function readProfileSettings(page: Page, profileIds: string[]) {
  return page.evaluate(async (ids) => {
    const path = '/src/app/integrations/storage/index.ts'
    const { readStoragePreferences, storageCredentialStatuses, ensureS3StorageAuthority } =
      await import(path)
    return Promise.all(
      ids.map(async (profileId) => ({
        profileId,
        preferences: readStoragePreferences('s3-compatible', profileId),
        credentials: await storageCredentialStatuses('s3-compatible', profileId),
        authority: ensureS3StorageAuthority(profileId)
      }))
    )
  }, profileIds)
}

for (const boundary of ['profile', 'provider-unmount'] as const) {
  test(`a pending storage Test stays nonpersistent after ${boundary} changes its owner`, async ({
    page
  }) => {
    await page.goto('/?test')
    const canvas = new CanvasHelper(page)
    await canvas.waitForInit()
    await page.getByTestId('app-settings-trigger').click()
    await page.getByTestId('settings-section-storage').click()
    const storage = page.getByTestId('settings-storage-panel')
    await storage
      .locator('[data-slot="storage-provider-option"][data-provider-id="s3-compatible"]')
      .click()
    const profiles = storage.getByTestId('storage-profiles')
    const chooser = profiles.getByRole('combobox', { name: 'Active storage profile', exact: true })
    const originalProfileId = await chooser.inputValue()
    await profiles.getByRole('button', { name: 'Add', exact: true }).click()
    await profiles.getByLabel('Profile name', { exact: true }).fill('Second draft account')
    await profiles.getByRole('button', { name: 'Create', exact: true }).click()
    const otherProfileId = await chooser.inputValue()
    expect(otherProfileId).not.toBe(originalProfileId)
    await chooser.selectOption(originalProfileId)
    const before = await readProfileSettings(page, [originalProfileId, otherProfileId])
    const s3 = storage.getByTestId('settings-storage-s3')
    await s3.getByLabel('Endpoint', { exact: true }).fill(DRAFT_ENDPOINT)
    await s3.getByLabel('Bucket', { exact: true }).fill('draft-bucket')
    await s3.getByLabel('Access key ID', { exact: true }).fill('test-only-draft-access')
    await s3.getByLabel('Secret access key', { exact: true }).fill('test-only-draft-secret')

    const release = Promise.withResolvers<undefined>()
    const handlerDone = Promise.withResolvers<undefined>()
    let heldRequest: ReturnType<Route['request']> | undefined
    const routeHandler = async (route: Route) => {
      heldRequest = route.request()
      try {
        await release.promise
        try {
          await route.fulfill({
            status: 200,
            contentType: 'application/xml',
            body:
              route.request().method() === 'HEAD'
                ? ''
                : '<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>'
          })
        } catch (error) {
          if (!route.request().failure()) throw error
        }
      } finally {
        handlerDone.resolve(undefined)
      }
    }
    await page.route(DRAFT_ROUTE, routeHandler)
    try {
      await s3.getByTestId('settings-storage-test').click()
      await expect.poll(() => heldRequest !== undefined).toBe(true)
      if (!heldRequest) throw new Error('The real draft connection request was not captured')
      const changeOwner = async () => {
        if (boundary === 'profile') {
          await chooser.selectOption(otherProfileId)
          await expect(chooser).toHaveValue(otherProfileId)
          await expect(s3.getByLabel('Endpoint', { exact: true })).toHaveValue('')
        } else {
          await storage
            .locator('[data-slot="storage-provider-option"][data-provider-id="google-drive"]')
            .click()
          await expect(s3).toHaveCount(0)
        }
      }
      await Promise.all([
        page.waitForEvent('requestfailed', { predicate: (request) => request === heldRequest }),
        changeOwner()
      ])
      release.resolve(undefined)
      await handlerDone.promise
      if (boundary === 'profile') {
        await expect(s3.getByRole('status')).toHaveCount(0)
        await expect(s3.getByTestId('settings-storage-test')).toBeEnabled()
        await expect(s3.getByLabel('Access key ID', { exact: true })).toHaveValue('')
        await expect(s3.getByLabel('Secret access key', { exact: true })).toHaveValue('')
      } else {
        await expect(storage.getByTestId('settings-storage-s3')).toHaveCount(0)
      }
      expect(await readProfileSettings(page, [originalProfileId, otherProfileId])).toEqual(before)
      canvas.assertNoErrors()
    } finally {
      release.resolve(undefined)
      await page.unroute(DRAFT_ROUTE, routeHandler)
    }
  })
}
