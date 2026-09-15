import { describe, expect, test } from 'bun:test'

import {
  NESTJS_BACKEND_PROVIDER_DESCRIPTOR,
  NESTJS_PRISMA_CRM_BACKEND_PROVIDER_DESCRIPTOR,
  createBackendProviderPlan,
  createBuiltinBackendProviderRegistry,
  emitBackendProviderPlan,
  type BackendArtifactSource,
  type BackendCompilationMode,
  type BackendProviderDescriptor
} from '@open-pencil/compiler/backend'
import {
  isReviewedPrismaCRMPresetLockArtifact,
  prismaCRMProjectPackage,
  PRISMA_CRM_PRESET_LOCK_SOURCE
} from '@open-pencil/compiler/backend/nestjs/prisma-crm/project'
import { NESTJS_PROJECT_PACKAGE } from '@open-pencil/compiler/backend/nestjs/project'

import { prismaCRMApplication } from './helpers'

function plan(
  descriptor: BackendProviderDescriptor = NESTJS_PRISMA_CRM_BACKEND_PROVIDER_DESCRIPTOR,
  target: 'react' | 'vue' = 'vue',
  mode: BackendCompilationMode = 'production'
) {
  const selection = { descriptor, packageDigest: `sha256:${'A'.repeat(43)}`, enabled: true }
  return {
    selection,
    result: createBackendProviderPlan(createBuiltinBackendProviderRegistry(), {
      selection,
      application: prismaCRMApplication(),
      target,
      mode
    })
  }
}

function emission(
  descriptor: BackendProviderDescriptor = NESTJS_PRISMA_CRM_BACKEND_PROVIDER_DESCRIPTOR,
  target: 'react' | 'vue' = 'vue'
) {
  const prepared = plan(descriptor, target)
  expect(prepared.result.ok, JSON.stringify(prepared.result.diagnostics)).toBe(true)
  if (!prepared.result.ok) throw new Error('Expected CRM source plan')
  const result = emitBackendProviderPlan(createBuiltinBackendProviderRegistry(), {
    selection: prepared.selection,
    plan: prepared.result.plan
  })
  expect(result.ok, JSON.stringify(result.ok ? [] : result.diagnostics)).toBe(true)
  if (!result.ok) throw new Error('Expected CRM source artifacts')
  return result.emission
}

describe('experimental Prisma CRM source provider', () => {
  test.each(['react', 'vue'] as const)(
    'emits reproducible complete %s sources with the independent authority',
    (target) => {
      const first = emission(undefined, target)
      expect(first.files).toEqual(emission(undefined, target).files)
      const files = first.files
      expect(files.get('backend/nestjs/src/resources/customers.service.ts')).toContain(
        '.prismaQuery('
      )
      expect(files.get('backend/nestjs/src/resources/customers.service.ts')).not.toContain(
        'this.database.query('
      )
      expect(files.get('backend/nestjs/src/prisma/contract.prisma')).toContain('model Customer {')
      expect(files.get('backend/nestjs/src/preview-contract.ts')).toContain(
        'const AVAILABLE = false'
      )
      expect(files.get('backend/nestjs/scripts/contract.mjs')).toContain(
        "[cli, 'contract', 'emit']"
      )
      expect(files.get('backend/nestjs/prisma.config.ts')).toContain(
        'skills: { agents: [], check: false }'
      )
      expect(String(files.get('openpencil-backend.manifest.json'))).toContain('nestjs-prisma-crm')
      const packageSource = JSON.parse(String(files.get('backend/nestjs/package.json')))
      expect(packageSource.scripts.prebuild).toBe('node scripts/contract.mjs')
      expect(packageSource.dependencies['@prisma/orm-postgres']).toBe('8.0.0-rc.11')
    }
  )

  test('retains SQL migrations, authority, command execution and other resource sources byte for byte', () => {
    const pg = emission(NESTJS_BACKEND_PROVIDER_DESCRIPTOR).files
    const prisma = emission().files
    for (const [path, source] of pg) {
      if (
        path.includes('/migrations/') ||
        path.includes('/command') ||
        (path.includes('/resources/') && !path.endsWith('/customers.service.ts')) ||
        ['/identity.ts', '/auth.service.ts', '/auth.guard.ts', '/security-policy.json'].some(
          (suffix) => path.endsWith(suffix)
        )
      ) {
        expect(prisma.get(path), path).toEqual(source)
      }
    }
    expect(pg.has('backend/nestjs/prisma.config.ts')).toBe(false)
    expect(pg.get('backend/nestjs/src/database.service.ts')).not.toContain('prismaQuery')
  })

  test.each(['preview', 'source-only-prototype'] as const)(
    'rejects %s instead of emitting an alternate runtime',
    (mode) => {
      const { result } = plan(undefined, 'vue', mode)
      expect(result.ok).toBe(false)
      expect(result.diagnostics.some((entry) => entry.severity === 'error')).toBe(true)
    }
  )

  test('admits only the exact pinned lock under its independent descriptor', () => {
    const artifact: BackendArtifactSource = {
      path: 'backend/nestjs/package-lock.json',
      kind: 'server-runtime',
      mediaType: 'application/json',
      content: PRISMA_CRM_PRESET_LOCK_SOURCE
    }
    expect(
      isReviewedPrismaCRMPresetLockArtifact(artifact, NESTJS_PRISMA_CRM_BACKEND_PROVIDER_DESCRIPTOR)
    ).toBe(true)
    expect(
      isReviewedPrismaCRMPresetLockArtifact(artifact, NESTJS_BACKEND_PROVIDER_DESCRIPTOR)
    ).toBe(false)
    expect(
      isReviewedPrismaCRMPresetLockArtifact(
        { ...artifact, content: artifact.content + '\n' },
        NESTJS_PRISMA_CRM_BACKEND_PROVIDER_DESCRIPTOR
      )
    ).toBe(false)
    expect(
      isReviewedPrismaCRMPresetLockArtifact(
        { ...artifact, path: 'backend/nestjs/other.json' },
        NESTJS_PRISMA_CRM_BACKEND_PROVIDER_DESCRIPTOR
      )
    ).toBe(false)
    const lock = JSON.parse(PRISMA_CRM_PRESET_LOCK_SOURCE)
    const pkg = prismaCRMProjectPackage(NESTJS_PROJECT_PACKAGE)
    expect(lock.packages[''].dependencies).toEqual(pkg.dependencies)
    expect(lock.packages[''].devDependencies).toEqual(pkg.devDependencies)
    expect(lock.packages[''].engines).toEqual(pkg.engines)
    for (const [path, record] of Object.entries(lock.packages)) {
      if (path === '') continue
      if (!record || typeof record !== 'object') throw new Error('Expected locked dependency')
      const resolved: unknown = Reflect.get(record, 'resolved')
      if (typeof resolved !== 'string') throw new Error('Expected registry artifact')
      const url = new URL(resolved)
      expect(url.origin).toBe('https://registry.npmjs.org')
      expect(url.username + url.password + url.search + url.hash).toBe('')
      expect(Reflect.get(record, 'integrity')).toMatch(/^sha512-[A-Za-z0-9+/]{86}==$/u)
    }
  })
})
