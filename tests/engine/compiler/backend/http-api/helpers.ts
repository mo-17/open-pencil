import {
  SUPABASE_BACKEND_PROVIDER_BUNDLE,
  SUPABASE_BACKEND_PROVIDER_BUNDLE_V2,
  createBackendProviderRegistry,
  createBackendProviderRegistryV2,
  lowerSupabaseBackendApplicationV2ToV1
} from '@open-pencil/compiler/backend'
import {
  lowerBackendApplicationSpecV1ToV2,
  parseBackendApplicationSpecV1,
  type BackendApplicationSpecV1
} from '@open-pencil/lowcode/backend'

import { fakeBackendApplicationV2 } from '../v2/helpers'

export const HTTP_API_DIAGNOSTIC = {
  code: 'backend-http-api-provider-unimplemented',
  severity: 'error',
  path: '$.application.httpApi'
} as const

const PACKAGE_DIGEST = `sha256:${'A'.repeat(43)}`

export function httpAPIApplication() {
  const source: BackendApplicationSpecV1 = {
    format: 'openpencil.backend-application',
    version: 1,
    applicationId: 'http-api.notes',
    dataModel: {
      version: 1,
      entities: [
        {
          id: 'notes',
          name: 'notes',
          management: 'managed',
          fields: [
            { id: 'id', name: 'id', type: 'uuid', nullable: false },
            { id: 'owner_id', name: 'owner_id', type: 'uuid', nullable: false },
            { id: 'title', name: 'title', type: 'string', nullable: false }
          ],
          primaryKey: { fields: ['id'] }
        }
      ],
      enums: [],
      relations: []
    },
    auth: {
      version: 1,
      identities: [{ id: 'user', kind: 'user' }],
      roles: [],
      tenants: [],
      ownership: [{ id: 'note-owner', entityId: 'notes', identityFieldId: 'owner_id' }],
      rowAccess: [
        {
          id: 'owner-select',
          entityId: 'notes',
          effect: 'allow',
          operations: ['select'],
          principal: { kind: 'owner', ownershipId: 'note-owner' }
        }
      ]
    },
    workflows: { version: 1, workflows: [] },
    capabilities: [
      { capability: 'auth.identity', required: true },
      { capability: 'data.read', required: true },
      { capability: 'migrations.schema', required: true },
      { capability: 'policy.row-level', required: true },
      { capability: 'server.http', required: true }
    ],
    secrets: ['JWT_ISSUER', 'JWT_AUDIENCE', 'JWT_JWKS_URL'].map((name) => ({
      kind: 'environment',
      name,
      exposure: 'server',
      required: true
    })),
    httpApi: {
      version: 1,
      authentication: {
        kind: 'jwt',
        identityId: 'user',
        issuerEnvironment: 'JWT_ISSUER',
        audienceEnvironment: 'JWT_AUDIENCE',
        jwksUrlEnvironment: 'JWT_JWKS_URL',
        algorithms: ['RS256']
      },
      resources: [
        {
          id: 'notes-api',
          path: '/notes',
          entityId: 'notes',
          operations: ['list'],
          readFields: ['id', 'title'],
          maxPageSize: 20
        }
      ]
    }
  }
  const parsed = parseBackendApplicationSpecV1(source)
  if (!parsed.ok)
    throw new Error(
      `Invalid HTTP fixture: ${parsed.diagnostics.map((entry) => entry.code).join(', ')}`
    )
  if (!parsed.value.httpApi) throw new Error('HTTP fixture normalization discarded the declaration')
  return parsed.value
}

export function httpAPIApplicationV2() {
  const lowered = lowerBackendApplicationSpecV1ToV2(httpAPIApplication())
  if (!lowered.ok)
    throw new Error(
      `Invalid HTTP V2 fixture: ${lowered.diagnostics.map((entry) => entry.code).join(', ')}`
    )
  if (!lowered.value.httpApi) throw new Error('HTTP V2 fixture lowering discarded the declaration')
  return lowered.value
}

export function baselineApplication() {
  return lowerSupabaseBackendApplicationV2ToV1(fakeBackendApplicationV2())
}

export const baselineApplicationV2 = fakeBackendApplicationV2

export function trackedSupabaseProvider() {
  const calls: string[] = []
  const base = SUPABASE_BACKEND_PROVIDER_BUNDLE
  const registry = createBackendProviderRegistry([
    {
      ...base,
      validate(context) {
        calls.push('bundle.validate')
        return base.validate?.(context) ?? []
      }
    }
  ])
  const selection = { descriptor: base.descriptor, packageDigest: PACKAGE_DIGEST, enabled: true }
  return { registry, selection, calls }
}

export function trackedSupabaseProviderV2() {
  const calls: string[] = []
  const base = SUPABASE_BACKEND_PROVIDER_BUNDLE_V2
  const registry = createBackendProviderRegistryV2([
    {
      ...base,
      validate(context) {
        calls.push('bundle.validate')
        return base.validate?.(context) ?? []
      }
    }
  ])
  const selection = { descriptor: base.descriptor, packageDigest: PACKAGE_DIGEST, enabled: true }
  return { registry, selection, calls }
}
