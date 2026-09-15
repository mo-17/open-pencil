import { describe, expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'
import { parseExpression } from '@open-pencil/lowcode'

import { communityForumDefinition } from '@/app/lowcode/backend/business/definitions/community'
import { createCommunityApplication } from '@/app/lowcode/backend/business/model/community/application'
import {
  prepareBusinessModulePages,
  renderBusinessModulePages
} from '@/app/lowcode/backend/business/pages/module'
import { preflightBusinessPages } from '@/app/lowcode/backend/business/pages/preflight'

const authentication = {
  kind: 'oidc-pkce' as const,
  issuer: 'https://identity.example.com',
  clientId: 'community-definitions',
  scopes: ['openid', 'profile'],
  callbackPath: '/_openpencil/auth/callback'
}
const application = () => createCommunityApplication('community-pages', authentication)
const definition = communityForumDefinition()

describe('community page definitions', () => {
  test('preflights every bounded action against the real server contract', () => {
    const app = application()
    expect(() => preflightBusinessPages(app, definition)).not.toThrow()
    expect(definition.id).toBe('community-forum')
    expect(definition.pages).toHaveLength(10)
    expect(new Set(definition.pages.map((page) => page.path)).size).toBe(10)
    expect(definition.roles).toEqual(['community-moderator'])
    expect(
      definition.pages
        .flatMap((page) => page.actions)
        .map((action) => action.commandId)
        .sort()
    ).toEqual(app.commands?.commands.map((command) => command.id).sort())
    expect(definition.pages.filter((page) => page.public).map((page) => page.id)).toEqual([
      'community-posts'
    ])
    expect(definition.description.en).toContain('Closed discussions remain public')
    expect(definition.description.zh).toContain('内容下架')
  })

  test('keeps moderation notes off public detail fields and actions off the public reading page', () => {
    const publicPage = definition.pages.find((page) => page.id === 'community-posts')
    expect(publicPage?.actions).toEqual([])
    expect(publicPage?.details?.some((field) => field.field === 'moderation_note')).toBe(false)
    expect(publicPage?.related?.[0]).toMatchObject({
      resourceId: 'community-replies',
      foreignKey: 'post_id'
    })
    expect(
      publicPage?.related?.[0].columns.some((field) => field.field === 'moderation_note')
    ).toBe(false)
    const own = definition.pages.find((page) => page.id === 'community-my-posts')
    expect(own?.details?.some((field) => field.field === 'moderation_note')).toBe(true)
    expect(
      own?.actions.find((action) => action.commandId === 'update-community-post')?.when
    ).toEqual({ field: 'status', values: ['pending', 'rejected'] })
  })

  test('binds moderation versions and reply parent identity from selected records', () => {
    const actions = definition.pages.flatMap((page) => page.actions)
    const app = application()
    for (const action of actions) {
      const command = app.commands?.commands.find((entry) => entry.id === action.commandId)
      if (command?.parameters.some((parameter) => parameter.name === 'expectedVersion')) {
        expect(action.parameters.expectedVersion).toEqual({ kind: 'selection', field: 'version' })
        expect(action.inputs.some((input) => input.key === 'expectedVersion')).toBe(false)
      }
      if (action.parameters.replyId) {
        expect(action.parameters.replyId).toEqual({ kind: 'selection', field: 'id' })
        expect(action.parameters.postId).toEqual({ kind: 'selection', field: 'post_id' })
      }
    }
    expect(actions.find((action) => action.commandId === 'create-community-reply')?.when).toEqual({
      field: 'status',
      values: ['published']
    })
    expect(actions.find((action) => action.commandId === 'remove-community-reply')?.when).toEqual({
      field: 'status',
      values: ['pending', 'published']
    })
  })

  test('uses private follow and report resources and states that report resolution is separate from content moderation', () => {
    const follows = definition.pages.find((page) => page.id === 'community-follows')
    expect(follows?.listing?.resourceId).toBe('community-follows')
    expect(follows?.related?.[0]).toMatchObject({
      resourceId: 'community-posts',
      foreignKey: 'id',
      selectionField: 'post_id'
    })
    expect(
      follows?.actions.find((action) => action.commandId === 'restore-community-follow')?.parameters
    ).toEqual({
      followId: { kind: 'selection', field: 'id' },
      postId: { kind: 'selection', field: 'post_id' }
    })
    expect(
      definition.pages.find((page) => page.id === 'community-my-reports')?.listing?.resourceId
    ).toBe('community-my-reports')
    const moderation = definition.pages.find((page) => page.id === 'community-management-reports')
    expect(moderation?.listing?.resourceId).toBe('community-management-reports')
    expect(moderation?.description.en).toContain('does not automatically hide or alter content')
  })

  for (const locale of ['en', 'zh-CN'])
    test(`renders ${locale} pages with valid private parent lookups`, () => {
      const editor = createEditor()
      const plan = prepareBusinessModulePages(editor, application(), 'community-forum', { locale })
      const rendered = editor.undo.runBatch('Community pages', () =>
        renderBusinessModulePages(editor, plan)
      )
      expect(rendered.pageIds).toHaveLength(11)
      const nodes = [...editor.graph.getAllNodes()]
      for (const page of definition.pages)
        expect(
          nodes.some(
            (node) =>
              node.type === 'TEXT' && node.text === page.title[locale === 'en' ? 'en' : 'zh']
          )
        ).toBe(true)
      for (const node of nodes) {
        if (node.renderCondition) expect(parseExpression(node.renderCondition).ok).toBe(true)
        const source = node.interactiveProps?.dataSourceRef
        if (source?.kind === 'backendResource')
          for (const expression of [
            source.afterExpr,
            source.searchExpr,
            ...(source.filterEntries ?? []).map((entry) => entry.valueExpr)
          ])
            if (expression) expect(parseExpression(expression).ok).toBe(true)
      }
    })
})
