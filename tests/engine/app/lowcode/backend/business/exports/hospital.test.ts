import { expect, test } from 'bun:test'

import { expectServerSource, withBusinessStaticExport } from './helpers'

const ROUTES = [
  '/business-login',
  '/account-setup',
  '/hospital/departments',
  '/hospital/doctors',
  '/hospital/registration',
  '/hospital/patients',
  '/hospital/appointments',
  '/hospital/admin/departments',
  '/hospital/admin/doctors',
  '/hospital/admin/slots',
  '/hospital/admin/appointments'
]

for (const target of ['react', 'vue'] as const) {
  test(`${target} hospital export builds eleven real pages with PKCE and server-only command plans`, async () => {
    await withBusinessStaticExport('hospital-registration', target, (built) => {
      const { fixture, result, staticJavaScript } = built
      expect(fixture.pageIds).toHaveLength(11)
      expect(new Set(Object.values(fixture.paths))).toEqual(new Set(ROUTES))
      const extension = target === 'react' ? '.tsx' : '.vue'
      expect(
        [...fixture.output.files.keys()].filter(
          (path) => path.startsWith('src/pages/') && path.endsWith(extension)
        )
      ).toHaveLength(11)
      for (const route of ROUTES) expect(staticJavaScript).toContain(route)
      const authentication = fixture.output.files.get('src/lowcode-backend-auth.ts')
      expect(authentication).toContain("import * as oidc from 'openid-client'")
      for (const operation of [
        'randomPKCECodeVerifier',
        'calculatePKCECodeChallenge',
        'authorizationCodeGrant'
      ])
        expect(authentication).toContain('oidc.' + operation)
      expect(staticJavaScript).toContain('https://identity.example.com')
      expect(staticJavaScript).toContain('code_challenge_method')
      expect(staticJavaScript).toContain('S256')
      expectServerSource(built, 'backend/nestjs/src/command-plans.ts')
      expectServerSource(built, 'backend/nestjs/src/command.service.ts')
      expectServerSource(built, 'backend/nestjs/migrations/001-initial.sql')
      expect(fixture.output.files.get('backend/nestjs/src/command-plans.ts')).toContain(
        'restore-hospital-appointment'
      )
      expect(result.serverFiles.some((path) => path.endsWith('/src/command-execution.ts'))).toBe(
        true
      )
      for (const serverMarker of ['FOR UPDATE', 'command_digest', 'response_json', 'JWT_JWKS_URL'])
        expect(staticJavaScript).not.toContain(serverMarker)
    })
  }, 60000)
}
