import { describe, expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'
import { parseExpression } from '@open-pencil/lowcode'

import { automotiveNewsDefinition } from '@/app/lowcode/backend/business/definitions/automotive'
import { personalBlogDefinition } from '@/app/lowcode/backend/business/definitions/blog'
import { createAutomotiveApplication } from '@/app/lowcode/backend/business/model/automotive/application'
import { createBlogApplication } from '@/app/lowcode/backend/business/model/blog/application'
import {
  prepareBusinessModulePages,
  renderBusinessModulePages
} from '@/app/lowcode/backend/business/pages/module'
import { preflightBusinessPages } from '@/app/lowcode/backend/business/pages/preflight'

const authentication = {
  kind: 'oidc-pkce' as const,
  issuer: 'https://identity.example.com',
  clientId: 'publishing-definition-test',
  scopes: ['openid', 'profile'],
  callbackPath: '/_openpencil/auth/callback'
}

for (const fixture of [
  {
    id: 'personal-blog' as const,
    domain: 'blog',
    definition: personalBlogDefinition,
    application: createBlogApplication,
    pages: 7,
    commands: 10,
    roles: ['blog-author']
  },
  {
    id: 'automotive-news' as const,
    domain: 'auto',
    definition: automotiveNewsDefinition,
    application: createAutomotiveApplication,
    pages: 12,
    commands: 14,
    roles: ['auto-editor', 'auto-publisher']
  }
]) {
  describe(fixture.id + ' page definition', () => {
    const definition = fixture.definition()
    const model = () => fixture.application(fixture.id + '-definition', authentication)
    const action = (id: string) => {
      const found = definition.pages
        .flatMap((page) => page.actions)
        .find((entry) => entry.commandId === id)
      if (!found) throw new Error('Missing publishing action: ' + id)
      return found
    }

    test('preflights every command and exact parameter against the real model', () => {
      const application = model()
      expect(() => preflightBusinessPages(application, definition)).not.toThrow()
      expect(definition.id).toBe(fixture.id)
      expect(definition.roles).toEqual(fixture.roles)
      expect(definition.pages).toHaveLength(fixture.pages - 1)
      expect(new Set(definition.pages.map((page) => page.path)).size).toBe(fixture.pages - 1)
      const actions = definition.pages.flatMap((page) => page.actions)
      expect(actions).toHaveLength(fixture.commands)
      expect(actions.map((entry) => entry.commandId).sort()).toEqual(
        application.commands?.commands.map((entry) => entry.id).sort()
      )
      for (const entry of actions) {
        expect(Object.keys(entry.parameters)).not.toContain('ownerId')
        expect(Object.keys(entry.parameters)).not.toContain('status')
        expect(Object.keys(entry.parameters)).not.toContain('publishedAt')
      }
    })

    test('uses draft-only editing and explicit publish and withdrawal transitions', () => {
      const domain = fixture.domain
      expect(action(`update-${domain}-article`).when).toEqual({
        field: 'status',
        values: ['draft']
      })
      expect(action(`publish-${domain}-article`).when).toEqual({
        field: 'status',
        values: ['draft']
      })
      expect(action(`unpublish-${domain}-article`).when).toEqual({
        field: 'status',
        values: ['published']
      })
      const body = action(`create-${domain}-article`).inputs.find((input) => input.key === 'body')
      expect(body).toMatchObject({ kind: 'textarea', maxLength: 8192, required: false })
      const edit = action(`update-${domain}-article`)
      expect(edit.inputs.find((input) => input.key === 'body')?.fromSelection).toBe('body')
      expect(edit.inputs.find((input) => input.key === 'categoryId')).toMatchObject({
        fromSelection: 'category_id',
        relation: { resourceId: `${domain}-categories` }
      })
      expect(action(`publish-${domain}-article`).parameters.articleId).toEqual({
        kind: 'selection',
        field: 'id'
      })
    })

    test('resolves private bookmarks to current public content without copied article data', () => {
      const domain = fixture.domain
      const bookmarks = definition.pages.find((page) => page.id === `${domain}-bookmarks`)
      expect(bookmarks?.public).toBeUndefined()
      expect(bookmarks?.listing?.search).toBeUndefined()
      expect(bookmarks?.related?.[0]).toMatchObject({
        resourceId: `${domain}-articles`,
        foreignKey: 'id',
        selectionField: 'article_id'
      })
      expect(
        bookmarks?.related?.[0].columns.find((column) => column.field === 'body')?.multiline
      ).toBe(true)
      expect(bookmarks?.related?.[0].columns.map((column) => column.field)).toEqual([
        'title',
        'body'
      ])
      expect(bookmarks?.listing?.columns.map((column) => column.field)).toEqual([
        'article_id',
        'active'
      ])
      expect(action(`restore-${domain}-bookmark`).parameters).toEqual({
        articleId: { kind: 'selection', field: 'article_id' },
        bookmarkId: { kind: 'selection', field: 'id' }
      })
      expect(action(`cancel-${domain}-bookmark`).when).toEqual({ field: 'active', values: [true] })
      expect(action(`restore-${domain}-bookmark`).when).toEqual({
        field: 'active',
        values: [false]
      })
      expect(definition.pages.find((page) => page.id === `${domain}-articles`)?.public).toBe(true)
    })

    for (const locale of ['en', 'zh-CN'])
      test(`renders ${locale} pages with valid strict query expressions`, () => {
        const editor = createEditor()
        const plan = prepareBusinessModulePages(editor, model(), fixture.id, { locale })
        const result = editor.undo.runBatch('Publishing pages test', () =>
          renderBusinessModulePages(editor, plan)
        )
        expect(result.pageIds).toHaveLength(fixture.pages)
        const nodes = [...editor.graph.getAllNodes()]
        for (const node of nodes) {
          if (node.renderCondition) expect(parseExpression(node.renderCondition).ok).toBe(true)
          const source = node.interactiveProps?.dataSourceRef
          if (source?.kind === 'backendResource') {
            for (const expression of [
              source.afterExpr,
              source.searchExpr,
              ...(source.filterEntries ?? []).map((entry) => entry.valueExpr)
            ])
              if (expression) expect(parseExpression(expression).ok).toBe(true)
          }
        }
        for (const page of definition.pages)
          expect(
            nodes.some(
              (node) =>
                node.type === 'TEXT' && node.text === page.title[locale === 'en' ? 'en' : 'zh']
            )
          ).toBe(true)
      })
  })
}

test('automotive editor and publisher pages separate commands and model brand remains immutable', () => {
  const definition = automotiveNewsDefinition()
  expect(
    definition.pages
      .find((page) => page.id === 'auto-management-articles')
      ?.actions.map((action) => action.commandId)
  ).toEqual(['create-auto-article', 'update-auto-article'])
  expect(
    definition.pages
      .find((page) => page.id === 'auto-publication')
      ?.actions.map((action) => action.commandId)
  ).toEqual(['publish-auto-article', 'unpublish-auto-article'])
  const actions = definition.pages.flatMap((page) => page.actions)
  expect(
    actions
      .find((action) => action.commandId === 'update-auto-model')
      ?.inputs.map((input) => input.key)
  ).not.toContain('brandId')
  const create = actions.find((action) => action.commandId === 'create-auto-article')
  expect(create?.inputs.find((input) => input.key === 'modelId')?.relation?.resourceId).toBe(
    'auto-models'
  )
  expect(Object.keys(create?.parameters ?? {})).not.toContain('brandId')
})
