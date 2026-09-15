import { expect, test } from '#tests/e2e/fixtures'
import { CanvasHelper } from '#tests/helpers/canvas'
import { observeVRTourSampleDownloads } from '#tests/helpers/plugins/vr-tour'

test('installs a VR tour and edits rooms and links with reversible removal', async ({ page }) => {
  test.setTimeout(60_000)
  await observeVRTourSampleDownloads(page)
  const panoramaURL = '/assets/vr-tour/cayley_interior.jpg'
  let panoramaRequests = 0
  await page.route('**' + panoramaURL, async (route) => {
    panoramaRequests++
    await route.fulfill({ status: 204 })
  })
  await page.goto('/?test')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()

  await page.getByTestId('app-settings-trigger').click()
  await page.getByTestId('settings-section-plugins').click()
  const views = page.getByTestId('settings-plugins-view')
  await views.getByText('Browse', { exact: true }).click()
  await page.getByTestId('plugin-discover-search').fill('VR')
  await page.getByTestId('plugin-install-open-pencil.vr-tour').click()
  await expect(page.getByTestId('plugin-installed-open-pencil.vr-tour')).toBeVisible()
  await views.getByText('Installed', { exact: true }).click()
  const enabled = page.getByTestId('plugin-enabled-open-pencil.vr-tour')
  await expect(enabled).not.toBeChecked()
  await enabled.click()
  await expect(enabled).toBeChecked()
  await page.getByTestId('app-settings-done').click()

  await page.getByTestId('toolbar-plugin-modules').click()
  await page.getByTestId('toolbar-plugin-module-open-pencil.vr-tour-vr-tour').click()
  await canvas.waitForRender()
  await expect(page.getByTestId('layers-item').filter({ hasText: 'VR Tour' })).toBeVisible()

  const rooms = page.getByRole('group', { name: 'Rooms and hotspots', exact: true })
  await expect(rooms).toBeVisible()
  await expect(rooms.locator('details')).toHaveCount(2)
  const livingRoom = rooms
    .locator('details')
    .filter({ has: page.locator('summary', { hasText: 'living-room' }) })
  await livingRoom.getByLabel('Room name', { exact: true }).fill('Sunny living room')
  await livingRoom.getByLabel('Room name', { exact: true }).blur()
  await expect(livingRoom.locator('summary')).toHaveText('Sunny living room · living-room')
  const panoramaInput = livingRoom.getByLabel('360° panorama image', { exact: true })
  await panoramaInput.fill(panoramaURL)
  await panoramaInput.blur()
  await expect(panoramaInput).toHaveValue(panoramaURL)
  await canvas.waitForRender()
  expect(panoramaRequests).toBe(0)

  await rooms.getByRole('button', { name: 'Add room', exact: true }).click()
  await expect(rooms.locator('details')).toHaveCount(3)
  const balcony = rooms
    .locator('details')
    .filter({ has: page.locator('summary', { hasText: 'room-1' }) })
  await balcony.locator('summary').click()
  await balcony.getByLabel('Room name', { exact: true }).fill('Balcony')
  await balcony.getByLabel('Room name', { exact: true }).blur()
  await expect(balcony.locator('summary')).toHaveText('Balcony · room-1')

  await livingRoom.getByRole('button', { name: 'Add room link', exact: true }).click()
  const balconyLink = livingRoom.locator('fieldset').last()
  await balconyLink.getByLabel('Link label', { exact: true }).fill('Go to balcony')
  await balconyLink.getByLabel('Link label', { exact: true }).blur()
  await balconyLink
    .getByRole('combobox', { name: 'Destination room', exact: true })
    .selectOption('room-1')
  await expect(livingRoom.locator('fieldset')).toHaveCount(2)

  const initialRoom = page.getByRole('combobox', { name: 'Initial room', exact: true })
  await initialRoom.selectOption('room-1')
  await expect(initialRoom).toHaveValue('room-1')
  if ((await balcony.getAttribute('open')) === null) await balcony.locator('summary').click()
  await balcony.getByRole('button', { name: 'Remove room', exact: true }).click()
  await expect(rooms.locator('details')).toHaveCount(2)
  await expect(livingRoom.locator('fieldset')).toHaveCount(1)
  await expect(initialRoom).toHaveValue('living-room')
  await expect(initialRoom.locator('option', { hasText: 'Balcony' })).toHaveCount(0)

  await canvas.undo()
  await expect(rooms.locator('details')).toHaveCount(3)
  await expect(balcony.locator('summary')).toHaveText('Balcony · room-1')
  await expect(livingRoom.locator('fieldset')).toHaveCount(2)
  await expect(balconyLink.getByLabel('Link label', { exact: true })).toHaveValue('Go to balcony')
  await expect(
    balconyLink.getByRole('combobox', { name: 'Destination room', exact: true })
  ).toHaveValue('room-1')
  await expect(initialRoom).toHaveValue('room-1')
  await expect(panoramaInput).toHaveValue(panoramaURL)

  await canvas.redo()
  await expect(rooms.locator('details')).toHaveCount(2)
  await expect(livingRoom.locator('fieldset')).toHaveCount(1)
  await expect(livingRoom.getByLabel('Room name', { exact: true })).toHaveValue('Sunny living room')
  await expect(initialRoom).toHaveValue('living-room')
  await expect(panoramaInput).toHaveValue(panoramaURL)
  await canvas.waitForRender()
  expect(panoramaRequests).toBe(0)
  canvas.assertNoErrors()
})
