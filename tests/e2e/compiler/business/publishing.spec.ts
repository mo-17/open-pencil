import { expect, test } from '@playwright/test'

import { withBusinessBrowser } from '#tests/helpers/compiler/business/helpers'
import {
  expectScrollableArticle,
  publishingBody,
  publishingBrowserActions,
  publishingCases,
  publishingDate,
  publishingId
} from '#tests/helpers/compiler/business/publishing/helpers'

for (const fixture of publishingCases) {
  for (const target of ['react', 'vue'] as const) {
    test(`${target} ${fixture.kind} writes publishes bookmarks and withdraws current public text`, async ({
      page
    }, info) => {
      test.setTimeout(150_000)
      // Generated React/Vue run in Chromium; identity and HTTP are scripted, not live role proof.
      await withBusinessBrowser(
        page,
        fixture.kind,
        target,
        async ({ api, open, fixture: compiled }) => {
          const domain = fixture.domain
          const auto = domain === 'auto'
          const { navigate, fill, submit, catalog } = publishingBrowserActions(page, api)
          const category = {
            id: publishingId('2'),
            title: 'Editorial',
            description: 'Manually edited stories',
            active: true,
            version: 0,
            created_at: publishingDate
          }
          const brand = {
            id: publishingId('3'),
            title: 'Example Motors',
            description: 'Fictional test brand',
            active: true,
            version: 0,
            created_at: publishingDate
          }
          const model = {
            id: publishingId('4'),
            brand_id: brand.id,
            brand_title: brand.title,
            title: 'Example One',
            description: 'Fictional test model',
            segment: 'Compact',
            energy_type: 'Electric',
            active: true,
            version: 0,
            created_at: publishingDate
          }
          const profile = {
            id: publishingId('1'),
            title: 'Editorial account',
            active: true,
            created_at: publishingDate
          }
          await open('account')
          await navigate('Register my profile')
          await fill({ 'Display name': profile.title })
          await submit(
            'Register my profile',
            'register-business-user',
            { title: profile.title },
            profile,
            { 'my-profile': [profile] }
          )
          await catalog(
            auto ? 'Manage news categories' : 'Manage blog categories',
            `${domain}-category`,
            `${domain}-management-categories`,
            'categoryId',
            category
          )
          if (auto) {
            await catalog(
              'Manage vehicle brands',
              'auto-brand',
              'auto-management-brands',
              'brandId',
              brand
            )
            await navigate('Manage vehicle models')
            await navigate('Create vehicle model')
            await navigate('Choose · Active brand')
            await fill({
              Name: model.title,
              Description: model.description,
              Segment: model.segment,
              'Energy type': model.energy_type
            })
            await page.getByRole('combobox').last().selectOption({ label: 'Active' })
            const payload = {
              title: model.title,
              description: model.description,
              segment: model.segment,
              energyType: model.energy_type,
              active: true
            }
            const resources = { 'auto-models': [model], 'auto-management-models': [model] }
            await submit(
              'Create vehicle model',
              'create-auto-model',
              { brandId: brand.id, ...payload },
              model,
              resources
            )
            await navigate('Select record')
            await navigate('Edit vehicle model')
            await expect(page.getByPlaceholder('Energy type', { exact: true })).toHaveValue(
              'Electric'
            )
            await expect(
              page.getByRole('button', { name: 'Choose · Active brand', exact: true })
            ).toHaveCount(0)
            await submit(
              'Edit vehicle model',
              'update-auto-model',
              { modelId: model.id, ...payload },
              { ...model, version: 1 },
              resources
            )
          }
          const editorTitle = auto ? 'Edit automotive news' : 'Write blog'
          const publishTitle = auto ? 'Publish automotive news' : 'Write blog'
          const publicTitle = auto ? 'Automotive news' : 'Read blog'
          const bookmarksTitle = auto ? 'My news bookmarks' : 'My blog bookmarks'
          const article = {
            id: publishingId('5'),
            category_id: category.id,
            category_title: category.title,
            title: 'First editorial article',
            summary: 'A public reading example',
            body: publishingBody,
            status: 'draft',
            published_at: null,
            version: 0,
            created_at: publishingDate,
            ...(auto
              ? {
                  model_id: model.id,
                  model_title: model.title,
                  brand_id: brand.id,
                  brand_title: brand.title
                }
              : {})
          }
          await navigate(editorTitle)
          await navigate('Create article draft')
          await navigate('Choose · Active category')
          if (auto) await navigate('Choose · Active vehicle model')
          await fill({
            Title: article.title,
            Summary: article.summary,
            'Article text': article.body
          })
          const content = {
            categoryId: category.id,
            title: article.title,
            summary: article.summary,
            body: article.body,
            ...(auto ? { modelId: model.id } : {})
          }
          await submit('Create article draft', `create-${domain}-article`, content, article, {
            [`${domain}-management-articles`]: [article]
          })
          await navigate('Select record')
          await navigate('Edit article draft')
          await expect(page.getByPlaceholder('Article text', { exact: true })).toHaveValue(
            publishingBody
          )
          await expect(page.getByText('Selected: ' + category.id, { exact: true })).toBeVisible()
          if (auto)
            await expect(page.getByText('Selected: ' + model.id, { exact: true })).toBeVisible()
          // Submit without choosing again: exact HTTP payload verifies relation value prefill.
          await fill({ 'Editorial note': 'Draft reviewed' })
          await submit(
            'Edit article draft',
            `update-${domain}-article`,
            { articleId: article.id, ...content, note: 'Draft reviewed' },
            { ...article, version: 1 },
            { [`${domain}-management-articles`]: [{ ...article, version: 1 }] }
          )
          await navigate(publicTitle)
          await expect(
            page.getByRole('button', { name: 'Select record', exact: true })
          ).toHaveCount(0)
          await navigate(publishTitle)
          await navigate('Select record')
          await navigate('Publish article')
          await fill({ 'Editorial note': 'Approved for public reading' })
          const published = {
            ...article,
            status: 'published',
            published_at: publishingDate,
            version: 2
          }
          await submit(
            'Publish article',
            `publish-${domain}-article`,
            { articleId: article.id, note: 'Approved for public reading' },
            published,
            { [`${domain}-management-articles`]: [published], [`${domain}-articles`]: [published] }
          )
          await navigate(publicTitle)
          await navigate('Select record')
          await expectScrollableArticle(page, publishingBody)
          await navigate('Bookmark article')
          const bookmark = {
            id: publishingId('6'),
            article_id: article.id,
            active: true,
            version: 0,
            created_at: publishingDate
          }
          await submit(
            'Bookmark article',
            `create-${domain}-bookmark`,
            { articleId: article.id },
            bookmark,
            { [`${domain}-bookmarks`]: [bookmark] }
          )
          await navigate(bookmarksTitle)
          await navigate('Select record')
          await expectScrollableArticle(page, publishingBody)
          await page.screenshot({
            path: info.outputPath('publishing-bookmark-current-article.png'),
            fullPage: true
          })
          await navigate('Remove bookmark')
          await submit(
            'Remove bookmark',
            `cancel-${domain}-bookmark`,
            { bookmarkId: bookmark.id },
            { ...bookmark, active: false, version: 1 },
            { [`${domain}-bookmarks`]: [{ ...bookmark, active: false, version: 1 }] }
          )
          await navigate('Select record')
          await navigate('Restore bookmark')
          await submit(
            'Restore bookmark',
            `restore-${domain}-bookmark`,
            { articleId: article.id, bookmarkId: bookmark.id },
            { ...bookmark, version: 2 },
            { [`${domain}-bookmarks`]: [{ ...bookmark, version: 2 }] }
          )
          await navigate(publishTitle)
          await navigate('Select record')
          if (!auto) {
            await navigate('Edit article draft')
            await expect(page.getByPlaceholder('Article text', { exact: true })).toHaveValue(
              publishingBody
            )
            // The action menu stays available, but the published record has no form submit button.
            await expect(
              page.getByRole('button', { name: 'Edit article draft', exact: true })
            ).toHaveCount(1)
          }
          await navigate('Withdraw article')
          await fill({ 'Editorial note': 'Return to draft' })
          await submit(
            'Withdraw article',
            `unpublish-${domain}-article`,
            { articleId: article.id, note: 'Return to draft' },
            { ...article, version: 3 },
            {
              [`${domain}-management-articles`]: [{ ...article, version: 3 }],
              [`${domain}-articles`]: []
            }
          )
          await navigate(bookmarksTitle)
          const resourcePath = compiled.application.httpApi?.resources.find(
            (resource) => resource.id === `${domain}-articles`
          )?.path
          if (!resourcePath) throw new Error('Missing public article route')
          const publicRead = page.waitForResponse((response) => {
            const url = new URL(response.url())
            return (
              response.request().method() === 'GET' &&
              url.pathname === compiled.apiBasePath + resourcePath &&
              url.searchParams.get('filter') === JSON.stringify({ id: article.id })
            )
          })
          await navigate('Select record')
          expect(await (await publicRead).json()).toEqual({ data: [], nextCursor: null })
          await expect(
            page.getByText('Article text: ' + publishingBody, { exact: true })
          ).toHaveCount(0)
          await expect(page.getByText('Title: ' + article.title, { exact: true })).toHaveCount(0)
          await page.screenshot({
            path: info.outputPath('publishing-withdrawn-bookmark.png'),
            fullPage: true
          })
          expect(api.calls).toHaveLength(auto ? 14 : 10)
          expect(new Set(api.calls.map((call) => call.key)).size).toBe(api.calls.length)
          expect(api.reads).toContain(`${domain}-articles`)
          expect(api.reads).toContain(`${domain}-bookmarks`)
        }
      )
    })
  }
}
