import { describe, expect, test } from 'bun:test'

import { emitNestJSProject } from '#compiler/backend/nestjs/project'
import { nestJSUsageGuide } from '#compiler/backend/nestjs/usage'

import { composeBusinessModules } from '@/app/lowcode/backend/business/composition'
import {
  createBusinessApplication,
  type BusinessTemplateId
} from '@/app/lowcode/backend/business/model'

import { nestJSApplication } from '../helpers'
import { modelFiles, modelRequired } from '../model-capabilities/helpers'

function textFile(files: ReturnType<typeof modelFiles>, path: string): string {
  const content = files.get(path)
  if (typeof content !== 'string') throw new Error('Expected generated text file ' + path)
  return content
}

const application = (kind: BusinessTemplateId) =>
  createBusinessApplication(
    'usage-fixture',
    {
      kind: 'oidc-pkce',
      issuer: 'https://identity.example.com',
      clientId: 'enterprise-public-client',
      scopes: ['openid', 'profile'],
      callbackPath: '/_openpencil/auth/callback'
    },
    kind
  )

describe('generated NestJS identity and first-use guide', () => {
  for (const [kind, role, command] of [
    ['asset-management', 'asset-manager', 'issue-asset-loan'],
    ['quote-contracts', 'contract-manager', 'confirm-quote-contract'],
    ['recruitment-hr', 'recruitment-hr', 'start-hr-onboarding'],
    ['customer-crm', 'crm-manager', 'assign-customer']
  ] as const)
    test(`emits real ${kind} role, identity and account instructions through the trusted provider`, () => {
      const app = application(kind)
      const files = modelFiles(app)
      const readme = textFile(files, 'backend/nestjs/README.md')
      expect(readme).toContain('`' + role + '`')
      expect(readme).toContain('`' + command + '`')
      expect(readme).toContain('`openpencil_roles`')
      expect(readme).toContain('not automatically read')
      expect(readme).toContain('access token, not the ID token')
      expect(readme).toContain('`https://identity.example.com`')
      expect(readme).toContain('`enterprise-public-client`')
      expect(readme).toContain('`/_openpencil/auth/callback`')
      expect(readme).toContain('`register-business-user`: POST `/commands/register-business-user`')
      expect(readme).toContain('limited by the model to one record per account')
      expect(readme).toContain('does not load it')
      expect(readme).toContain('valid JWT can retain its claims until expiry')
      if (kind === 'customer-crm')
        expect(readme).toContain('Commands that first select this owned record: `create-customer`')
      else
        expect(readme).toContain(
          'No command in this export requires selecting this record as an owner-scoped input'
        )
      for (const entry of app.secrets) expect(readme).toContain('`' + entry.name + '`')
      const guide = textFile(files, 'backend/nestjs/LOCAL-RUN.md')
      expect(guide).toContain('Optional personal-notes Keycloak shortcut')
      expect(guide.indexOf('--issuer')).toBeLessThan(guide.indexOf('--local-keycloak'))
      expect(guide).toContain('If your current directory is')
      expect(guide).toContain('Login does not register')
    })

  test('a CRM and three-module suite shares one startup and derives every role without duplicate profile registration', () => {
    const app = composeBusinessModules(
      application('customer-crm'),
      ['customer-crm', 'asset-management', 'quote-contracts', 'recruitment-hr'],
      { adoptExisting: ['customer-crm'] }
    ).application
    const readme = textFile(modelFiles(app), 'backend/nestjs/README.md')
    expect(readme).toContain('This export contains 5 declared modules')
    expect(readme).toContain('Start one NestJS process and apply its shared migration once')
    expect(readme).toContain('adding a module does not automatically grant its roles')
    for (const role of app.auth.roles) expect(readme).toContain('| `' + role.id + '` |')
    expect(readme.split('`register-business-user`: POST').length - 1).toBe(1)
  })

  test('uses actual custom authentication environment names, not hard-coded JWT names', () => {
    const app = application('asset-management')
    const http = modelRequired(app.httpApi)
    const rename = {
      JWT_ISSUER: 'ENTERPRISE_ISSUER',
      JWT_AUDIENCE: 'ENTERPRISE_AUDIENCE',
      JWT_JWKS_URL: 'ENTERPRISE_JWKS'
    }
    http.authentication.issuerEnvironment = rename.JWT_ISSUER
    http.authentication.audienceEnvironment = rename.JWT_AUDIENCE
    http.authentication.jwksUrlEnvironment = rename.JWT_JWKS_URL
    for (const secret of app.secrets)
      if (secret.name in rename) secret.name = rename[secret.name as keyof typeof rename]
    const readme = textFile(modelFiles(app), 'backend/nestjs/README.md')
    for (const name of Object.values(rename)) expect(readme).toContain('`' + name + '`')
    for (const name of Object.keys(rename)) expect(readme).not.toContain('`' + name + '`')
  })

  test('derives one-per-owner initialization structurally and avoids inventing one when the proof is absent', () => {
    const app = application('quote-contracts')
    const register = modelRequired(
      app.commands?.commands.find((command) => command.id === 'register-business-user')
    )
    register.id = 'create-own-card'
    register.path = '/commands/create-own-card'
    const generated = textFile(modelFiles(app), 'backend/nestjs/README.md')
    expect(generated).toContain('`create-own-card`: POST `/commands/create-own-card`')
    expect(generated).not.toContain('register-business-user')
    const noProof = structuredClone(app)
    const users = modelRequired(
      noProof.dataModel.entities.find((entity) => entity.name === 'users')
    )
    users.uniques = users.uniques?.filter(
      (unique) => unique.fields.length !== 1 || unique.fields[0] !== 'owner_id'
    )
    const noProofGuide = nestJSUsageGuide(noProof)
    expect(noProofGuide).toContain(
      'No one-record-per-account initialization command was identified'
    )
    expect(noProofGuide).not.toContain('`create-own-card`: POST')
  })

  test('handles API-only applications and preserves the experimental Prisma instructions', () => {
    const apiOnly = nestJSApplication()
    const guide = nestJSUsageGuide(apiOnly)
    expect(guide).toContain('no generated browser identity client')
    expect(guide).toContain('no business role IDs')
    expect(guide).toContain('runner starts only the database and API')
    const prisma = modelRequired(
      emitNestJSProject(application('customer-crm'), true).find(
        (file) => file.path === 'backend/nestjs/README.md'
      )
    ).content
    expect(prisma).toContain('Node 24.19')
    expect(prisma).toContain('editor managed/external preview is unsupported')
    expect(prisma).toContain('## Identity and application setup')
  })

  test('keeps authored inline identity strings inside Markdown code instead of injecting headings or table cells', () => {
    const app = application('quote-contracts')
    const browser = modelRequired(app.httpApi?.browserClient)
    browser.authentication.clientId = 'client`|\n# injected <script>'
    const guide = nestJSUsageGuide(app)
    expect(guide).toContain('`` client`\\| # injected <script> ``')
    expect(guide).not.toContain('\n# injected')
  })
})
