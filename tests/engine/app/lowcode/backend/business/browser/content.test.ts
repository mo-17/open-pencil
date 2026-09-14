import { describe, expect, test } from 'bun:test'

import { expect as browserExpect } from '@playwright/test'

import { finishBusinessRequest, submitBusinessAction, withBusinessBrowser } from './session/helpers'

const articleId = '00000000-0000-4000-8000-000000000100'
const recordedAt = '2026-09-14T00:00:00.000Z'
const body =
  'Opening paragraph.\n' +
  'Plain text content for a complete knowledge-base article. '.repeat(35) +
  '\nFINAL PARAGRAPH VISIBLE'

describe('generated knowledge-base browser workflow', () => {
  test.each(['react', 'vue'] as const)(
    '%s drafts, edits, reviews, publishes and withdraws full article text',
    async (target) => {
      await withBusinessBrowser('content-knowledge-base', target, async ({ page, api, open }) => {
        const draft = {
          id: articleId,
          title: 'Project handbook',
          body,
          category: 'Guides',
          status: 'draft',
          visibility: 'internal',
          published_at: null,
          created_at: recordedAt
        }
        api.steps.push({
          commandId: 'create-article',
          payload: { title: draft.title, body, category: 'Guides' },
          result: draft,
          resources: { articles: [draft] }
        })
        await open('articles')
        await page.getByRole('button', { name: 'New article', exact: true }).click()
        await page.getByPlaceholder('Article title', { exact: true }).fill(draft.title)
        await page.getByPlaceholder('Category', { exact: true }).fill('Guides')
        await page.getByPlaceholder('Article body', { exact: true }).fill(body)
        await submitBusinessAction(page, 'New article')
        await browserExpect(
          page.getByText('Title: Project handbook', { exact: true }).first()
        ).toBeVisible()
        await finishBusinessRequest(page)
        await page.getByRole('button', { name: 'Select record', exact: true }).click()
        const fullText = page.getByText('Article: ' + body, { exact: true })
        await browserExpect(fullText).toBeVisible()
        await browserExpect(fullText).toHaveCSS('white-space', 'pre-wrap')
        expect(await fullText.textContent()).toBe('Article: ' + body)
        await browserExpect(fullText).toContainText('FINAL PARAGRAPH VISIBLE')

        const edited = { ...draft, title: 'Team handbook' }
        api.steps.push({
          commandId: 'edit-article',
          payload: { articleId, title: edited.title, body, category: 'Guides' },
          result: edited,
          resources: { articles: [edited] }
        })
        await page.getByRole('button', { name: 'Edit draft', exact: true }).click()
        await browserExpect(page.getByPlaceholder('Article body', { exact: true })).toHaveValue(
          body
        )
        await page.getByPlaceholder('Article title', { exact: true }).fill(edited.title)
        await submitBusinessAction(page, 'Edit draft')
        await browserExpect(
          page.getByText('Title: Team handbook', { exact: true }).first()
        ).toBeVisible()
        await finishBusinessRequest(page)
        await page.getByRole('button', { name: 'Select record', exact: true }).click()

        const reviewing = { ...edited, status: 'in_review' }
        api.steps.push({
          commandId: 'submit-article',
          payload: { articleId },
          result: reviewing,
          resources: { articles: [reviewing] }
        })
        await page.getByRole('button', { name: 'Submit for review', exact: true }).click()
        await submitBusinessAction(page, 'Submit for review')
        await browserExpect(
          page.getByText('Status: in_review', { exact: true }).first()
        ).toBeVisible()
        await finishBusinessRequest(page)
        await page.getByRole('button', { name: 'Review and publish', exact: true }).click()
        await page.getByRole('button', { name: 'Select record', exact: true }).click()
        const approved = { ...reviewing, status: 'approved' }
        api.steps.push({
          commandId: 'approve-article',
          payload: { articleId, note: 'Reviewed the complete handbook' },
          result: approved,
          resources: { articles: [approved] }
        })
        await page.getByRole('button', { name: 'Approve article', exact: true }).click()
        await page
          .getByPlaceholder('Review note', { exact: true })
          .fill('Reviewed the complete handbook')
        await submitBusinessAction(page, 'Approve article')
        await browserExpect(
          page.getByText('Status: approved', { exact: true }).first()
        ).toBeVisible()
        await finishBusinessRequest(page)
        await page.getByRole('button', { name: 'Select record', exact: true }).click()

        const published = {
          ...approved,
          status: 'published',
          visibility: 'public',
          published_at: recordedAt
        }
        api.steps.push({
          commandId: 'publish-public-article',
          payload: { articleId },
          result: published,
          resources: {
            articles: [published],
            'published-articles': [published],
            'internal-articles': [published]
          }
        })
        await page.getByRole('button', { name: 'Publish publicly', exact: true }).click()
        await submitBusinessAction(page, 'Publish publicly')
        await browserExpect(
          page.getByText('Status: published', { exact: true }).first()
        ).toBeVisible()
        await finishBusinessRequest(page)
        await page.getByRole('button', { name: 'Public knowledge base', exact: true }).click()
        await page.getByRole('button', { name: 'Select record', exact: true }).click()
        await browserExpect(page.getByText('Article: ' + body, { exact: true })).toContainText(
          'FINAL PARAGRAPH VISIBLE'
        )
        await page.getByRole('button', { name: 'Review and publish', exact: true }).click()
        await page.getByRole('button', { name: 'Select record', exact: true }).click()
        const withdrawn = { ...edited, published_at: null }
        api.steps.push({
          commandId: 'unpublish-article',
          payload: { articleId },
          result: withdrawn,
          resources: { articles: [withdrawn], 'published-articles': [], 'internal-articles': [] }
        })
        await page.getByRole('button', { name: 'Unpublish article', exact: true }).click()
        await submitBusinessAction(page, 'Unpublish article')
        await browserExpect(page.getByText('Status: draft', { exact: true }).first()).toBeVisible()
        await finishBusinessRequest(page)
        await page.getByRole('button', { name: 'Public knowledge base', exact: true }).click()
        await browserExpect(page.getByText('Title: Team handbook', { exact: true })).toHaveCount(0)
        expect(new Set(api.calls.map((call) => call.key)).size).toBe(6)
        expect(api.reads).toContain('published-articles')
      })
    },
    120_000
  )
})
