import { expect, test } from 'bun:test'

import { businessTemplateDefinition } from '@/app/lowcode/backend/business/definitions'

import { expectServerSource, withBusinessStaticExport } from './helpers'

const templates = [
  'procurement-inventory',
  'enterprise-approvals',
  'survey-forms',
  'online-courses',
  'community-forum',
  'asset-management',
  'quote-contracts',
  'recruitment-hr'
] as const

for (const kind of templates)
  for (const target of ['react', 'vue'] as const) {
    test(`${target} ${kind} builds complete routes with real PKCE and isolated server artifacts`, async () => {
      await withBusinessStaticExport(kind, target, (built) => {
        const definition = businessTemplateDefinition(kind)
        expect(definition.id).toBe(kind)
        expect(built.fixture.pageIds).toHaveLength(definition.pages.length + 1)
        for (const page of definition.pages) expect(built.staticJavaScript).toContain(page.path)
        expectServerSource(built, 'backend/nestjs/src/command-plans.ts')
        expectServerSource(built, 'backend/nestjs/migrations/001-initial.sql')
        const plans = built.fixture.output.files.get('backend/nestjs/src/command-plans.ts')
        for (const action of definition.pages.flatMap((page) => page.actions))
          expect(plans).toContain(action.commandId)
        expect(built.fixture.output.files.get('src/lowcode-backend-auth.ts')).toContain(
          'authorizationCodeGrant'
        )
        for (const marker of ['FOR UPDATE', 'JWT_JWKS_URL', 'response_json'])
          expect(built.staticJavaScript).not.toContain(marker)
      })
    }, 60000)
  }
