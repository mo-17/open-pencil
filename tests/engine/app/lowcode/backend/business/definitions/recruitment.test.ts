import { describe, expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'
import { parseExpression } from '@open-pencil/lowcode'

import { recruitmentHrDefinition } from '@/app/lowcode/backend/business/definitions/recruitment'
import { createRecruitmentApplication } from '@/app/lowcode/backend/business/model/recruitment/application'
import {
  prepareBusinessModulePages,
  renderBusinessModulePages
} from '@/app/lowcode/backend/business/pages/module'
import { preflightBusinessPages } from '@/app/lowcode/backend/business/pages/preflight'

const authentication = {
  kind: 'oidc-pkce' as const,
  issuer: 'https://identity.example.com',
  clientId: 'hr-pages',
  scopes: ['openid', 'profile'],
  callbackPath: '/_openpencil/auth/callback'
}
const application = () => createRecruitmentApplication('recruitment-pages', authentication)
const definition = recruitmentHrDefinition()

describe('internal HR bilingual workflow pages', () => {
  test('covers every real command on private pages and describes manual boundaries', () => {
    expect(() => preflightBusinessPages(application(), definition)).not.toThrow()
    expect(definition.id).toBe('recruitment-hr')
    expect(definition.pages).toHaveLength(6)
    expect(definition.pages.every((page) => !page.public)).toBe(true)
    expect(
      definition.pages
        .flatMap((page) => page.actions)
        .map((action) => action.commandId)
        .sort()
    ).toEqual(
      application()
        .commands?.commands.map((entry) => entry.id)
        .sort()
    )
    expect(definition.description.en).toContain('No employee self-service')
    expect(definition.description.zh).toContain('薪资')
    expect(definition.pages.find((page) => page.id === 'hr-employees')?.description.zh).toContain(
      '不会创建或回收账号'
    )
  })

  test('derives version and parent identity from current selections rather than editable payloads', () => {
    const commands = application().commands?.commands ?? []
    for (const action of definition.pages.flatMap((page) => page.actions)) {
      if (
        commands
          .find((entry) => entry.id === action.commandId)
          ?.parameters.some((parameter) => parameter.name === 'expectedVersion')
      ) {
        expect(action.parameters.expectedVersion).toEqual({ kind: 'selection', field: 'version' })
        expect(action.inputs.some((input) => input.key === 'expectedVersion')).toBe(false)
      }
      if (action.parameters.candidateId)
        expect(action.parameters.positionId).toEqual({ kind: 'selection', field: 'position_id' })
    }
    const complete = definition.pages
      .flatMap((page) => page.actions)
      .find((action) => action.commandId === 'complete-hr-checklist-item')
    expect(complete?.parameters.employeeId).toEqual({ kind: 'selection', field: 'employee_id' })
    expect(complete?.parameters.positionId).toEqual({ kind: 'selection', field: 'position_id' })
    expect(complete?.when).toEqual({ field: 'completed', values: [false] })
    const offer = definition.pages
      .flatMap((page) => page.actions)
      .find((action) => action.commandId === 'offer-hr-candidate')
    expect(offer?.when).toEqual({ field: 'status', values: ['applied'] })
  })

  test.each(['en', 'zh-CN'])('renders %s protected pages with valid relation filters', (locale) => {
    const editor = createEditor()
    const plan = prepareBusinessModulePages(editor, application(), 'recruitment-hr', { locale })
    const rendered = editor.undo.runBatch('HR pages', () => renderBusinessModulePages(editor, plan))
    expect(rendered.pageIds).toHaveLength(7)
    const nodes = [...editor.graph.getAllNodes()]
    for (const page of definition.pages) {
      expect(
        nodes.some(
          (node) => node.type === 'TEXT' && node.text === page.title[locale === 'en' ? 'en' : 'zh']
        )
      ).toBe(true)
      expect(
        nodes.find((node) => node.lowcodeRoutePattern === page.path)?.lowcodeRequiresAuth
      ).toBe(true)
    }
    for (const node of nodes) {
      if (node.renderCondition) expect(parseExpression(node.renderCondition).ok).toBe(true)
      const source = node.interactiveProps?.dataSourceRef
      if (source?.kind === 'backendResource')
        for (const filter of source.filterEntries ?? [])
          expect(parseExpression(filter.valueExpr).ok).toBe(true)
    }
  })
})
