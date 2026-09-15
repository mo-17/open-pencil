import { describe, expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'
import { parseExpression } from '@open-pencil/lowcode'

import { surveysDefinition } from '@/app/lowcode/backend/business/definitions/surveys'
import { createSurveysApplication } from '@/app/lowcode/backend/business/model/surveys/application'
import {
  prepareBusinessModulePages,
  renderBusinessModulePages
} from '@/app/lowcode/backend/business/pages/module'
import { preflightBusinessPages } from '@/app/lowcode/backend/business/pages/preflight'

const authentication = {
  kind: 'oidc-pkce' as const,
  issuer: 'https://identity.example.com',
  clientId: 'surveys-definitions',
  scopes: ['openid', 'profile'],
  callbackPath: '/_openpencil/auth/callback'
}
const application = () => createSurveysApplication('surveys-pages', authentication)
const definition = surveysDefinition()

describe('survey page definitions', () => {
  test('preflights every exact command and clearly states the fixed, final-response boundary', () => {
    const app = application()
    expect(() => preflightBusinessPages(app, definition)).not.toThrow()
    expect(definition.id).toBe('survey-forms')
    expect(definition.roles).toEqual(['survey-manager'])
    expect(definition.pages).toHaveLength(6)
    expect(new Set(definition.pages.map((page) => page.path)).size).toBe(6)
    expect(definition.description.en).toContain('three fixed question types')
    expect(definition.description.zh).toContain('不含任意表单设计')
    const actions = definition.pages.flatMap((page) => page.actions)
    expect(actions.map((action) => action.commandId).sort()).toEqual(
      app.commands?.commands.map((command) => command.id).sort()
    )
    expect(definition.pages.filter((page) => page.public).map((page) => page.id)).toEqual([
      'survey-versions'
    ])
  })

  test('binds a single bounded submit form to the selected published version', () => {
    const page = definition.pages.find((entry) => entry.id === 'survey-answer')
    expect(page?.description.en).toContain('cannot be edited, deleted or resubmitted')
    expect(page?.actions).toHaveLength(1)
    const submit = page?.actions[0]
    expect(submit?.commandId).toBe('submit-survey-response')
    expect(submit?.parameters.versionId).toEqual({ kind: 'selection', field: 'id' })
    expect(submit?.when).toEqual({ field: 'accepting', values: [true] })
    expect(submit?.inputs).toContainEqual(
      expect.objectContaining({ key: 'rating', kind: 'number', min: 1, max: 5 })
    )
    expect(submit?.inputs).toContainEqual(
      expect.objectContaining({ key: 'choice', kind: 'number', min: 1, max: 3 })
    )
    expect(submit?.inputs).toContainEqual(
      expect.objectContaining({
        key: 'comment',
        kind: 'textarea',
        maxLength: 2000,
        required: false
      })
    )
    expect(submit?.inputs.some((input) => /owner|publication/.test(input.key))).toBe(false)
  })

  test('keeps private answers separate from public questions and retains their immutable question link', () => {
    const own = definition.pages.find((page) => page.id === 'survey-my-responses')
    expect(own?.listing?.resourceId).toBe('survey-responses')
    expect(own?.related?.[0]).toMatchObject({
      resourceId: 'survey-versions',
      foreignKey: 'id',
      selectionField: 'version_id'
    })
    expect(own?.actions).toEqual([])
    const manager = definition.pages.find((page) => page.id === 'survey-management')
    expect(manager?.related?.[0]).toMatchObject({
      resourceId: 'survey-management-responses',
      foreignKey: 'version_id'
    })
    expect(manager?.description.en).toContain('No aggregate statistics')
    expect(manager?.actions[0]).toMatchObject({
      commandId: 'close-survey-version',
      when: { field: 'accepting', values: [true] }
    })
    const drafts = definition.pages.find((page) => page.id === 'survey-drafts')
    const edit = drafts?.actions.find((action) => action.commandId === 'update-survey-draft')
    expect(edit?.inputs.every((input) => input.fromSelection === input.key)).toBe(true)
    expect(
      drafts?.actions.find((action) => action.commandId === 'publish-survey-version')?.inputs
    ).toEqual([])
  })

  for (const locale of ['en', 'zh-CN'])
    test(`renders valid ${locale} query and input bindings`, () => {
      const editor = createEditor()
      const plan = prepareBusinessModulePages(editor, application(), 'survey-forms', { locale })
      const rendered = editor.undo.runBatch('Survey pages', () =>
        renderBusinessModulePages(editor, plan)
      )
      expect(rendered.pageIds).toHaveLength(7)
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
        if (source?.kind === 'backendResource') {
          for (const expression of [
            source.afterExpr,
            source.searchExpr,
            ...(source.filterEntries ?? []).map((entry) => entry.valueExpr)
          ])
            if (expression) expect(parseExpression(expression).ok).toBe(true)
        }
      }
    })
})
