import { expect, test } from '@playwright/test'

for (const [story, label] of [
  ['not-provided', 'Not provided'],
  ['invalid', 'Invalid report'],
  ['expired', 'Report expired']
]) {
  test(`context usage explains ${story}`, async ({ page }) => {
    await page.goto(`/iframe.html?id=chat-context-usage--${story}&viewMode=story`)
    const summary = page.locator('summary').filter({ hasText: 'Context window' })
    await expect(summary).toContainText(label)
    await expect(summary).not.toContainText('0%')
    await summary.click()
    await expect(page.getByText(/No reliable history compression event/)).toBeVisible()
  })
}

test('context report shows capacity and keeps token and Skill explanations distinct', async ({
  page
}) => {
  await page.goto('/iframe.html?id=chat-context-usage--available&viewMode=story')
  const summary = page.locator('summary').filter({ hasText: 'Context window' })
  await expect(summary).toContainText('12,000 / 200,000 (6.0%)')
  // The story's interaction may already have expanded the disclosure.
  if ((await page.locator('details').getAttribute('open')) === null) await summary.click()
  await expect(page.getByText(/Latest token report/)).toContainText('1,200')
  await expect(page.getByText(/Skill description shortening/)).toBeVisible()
  await expect(page.getByText(/five minutes/)).toBeVisible()
})
