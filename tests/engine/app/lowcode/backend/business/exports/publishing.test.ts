import { expect, test } from 'bun:test'

import { expectServerSource, withBusinessStaticExport } from './helpers'

const templates = [
  { kind: 'personal-blog', prefix: 'blog', pages: 7, entry: '/blog' },
  { kind: 'automotive-news', prefix: 'auto', pages: 12, entry: '/automotive/news' }
] as const

for (const template of templates) {
  for (const target of ['react', 'vue'] as const) {
    test(`${target} ${template.kind} exports every route, real authentication and server-only publication plans`, async () => {
      await withBusinessStaticExport(template.kind, target, (built) => {
        const { fixture, staticJavaScript } = built
        expect(fixture.pageIds).toHaveLength(template.pages)
        expect(Object.values(fixture.paths)).toContain(template.entry)
        for (const path of Object.values(fixture.paths)) expect(staticJavaScript).toContain(path)
        expectServerSource(built, 'backend/nestjs/src/command-plans.ts')
        expectServerSource(built, 'backend/nestjs/migrations/001-initial.sql')
        expect(fixture.output.files.get('backend/nestjs/src/command-plans.ts')).toContain(
          `publish-${template.prefix}-article`
        )
        expect(fixture.output.files.get('src/lowcode-backend-auth.ts')).toContain(
          'authorizationCodeGrant'
        )
        for (const marker of ['FOR UPDATE', 'response_json', 'JWT_JWKS_URL'])
          expect(staticJavaScript).not.toContain(marker)
      })
    }, 60000)
  }
}
