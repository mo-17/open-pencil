import { describe, expect, test } from 'bun:test'

import {
  NESTJS_BACKEND_PROVIDER_BUNDLE,
  NESTJS_BACKEND_PROVIDER_DESCRIPTOR,
  SUPABASE_BACKEND_PROVIDER_BUNDLE,
  createBackendProviderPlan,
  createBackendProviderRegistry,
  emitBackendProviderPlan,
  type BackendArtifactSource,
  type BackendProviderBundle
} from '@open-pencil/compiler/backend'
import {
  NESTJS_PRESET_LOCK_SOURCE,
  isReviewedNestJSPresetLockArtifact
} from '@open-pencil/compiler/backend/nestjs/preset-lock'
import { NESTJS_PROJECT_PACKAGE } from '@open-pencil/compiler/backend/nestjs/project'
import {
  containsBackendSecretLikeMaterial,
  parseBackendApplicationSpecV1
} from '@open-pencil/lowcode/backend'

import { baselineApplication } from '../http-api/helpers'
import { nestJSApplication } from './helpers'

const LOCK_PATH = 'backend/nestjs/package-lock.json'
const SECRET_CANARY = ['ghp', 'syntheticCanaryNoAuthority1234'].join('_')

function lockArtifact(change: Partial<BackendArtifactSource> = {}): BackendArtifactSource {
  return {
    path: LOCK_PATH,
    kind: 'server-runtime',
    mediaType: 'application/json',
    content: NESTJS_PRESET_LOCK_SOURCE,
    ...change
  }
}

function emitArtifact(
  artifact: BackendArtifactSource,
  bundle: BackendProviderBundle = NESTJS_BACKEND_PROVIDER_BUNDLE,
  occupiedPaths: readonly string[] = []
) {
  const server = bundle.server
  if (!server) throw new Error('Expected fixture server adapter')
  const registry = createBackendProviderRegistry([
    {
      ...bundle,
      server: { ...server, emit: () => [artifact] }
    }
  ])
  const selection = {
    descriptor: bundle.descriptor,
    packageDigest: `sha256:${'A'.repeat(43)}`,
    enabled: true
  }
  const application =
    bundle === SUPABASE_BACKEND_PROVIDER_BUNDLE ? baselineApplication() : nestJSApplication()
  if (bundle === SUPABASE_BACKEND_PROVIDER_BUNDLE) {
    application.capabilities.push({ capability: 'server.http', required: true })
  }
  const plan = createBackendProviderPlan(registry, {
    selection,
    application,
    target: 'react',
    mode: 'production'
  })
  if (!plan.ok) throw new Error(JSON.stringify(plan.diagnostics))
  return emitBackendProviderPlan(registry, { selection, plan: plan.plan, occupiedPaths })
}

function expectForbidden(artifact: BackendArtifactSource) {
  expect(isReviewedNestJSPresetLockArtifact(artifact, NESTJS_BACKEND_PROVIDER_DESCRIPTOR)).toBe(
    false
  )
  const result = emitArtifact(artifact)
  expect(result.ok).toBe(false)
  if (result.ok) throw new Error('Changed lock bytes must not emit')
  expect(
    result.diagnostics.some(
      (entry) =>
        entry.code === 'backend-artifact-secret-material-forbidden' ||
        entry.code === 'backend-artifact-output-undeclared'
    )
  ).toBe(true)
  expect(JSON.stringify(result)).not.toContain(SECRET_CANARY)
}

describe('exact reviewed NestJS preset lock artifact', () => {
  test('permits the unchanged static bytes while the generic secret scanner still rejects SRI', () => {
    expect(containsBackendSecretLikeMaterial(NESTJS_PRESET_LOCK_SOURCE)).toBe(true)
    expect(
      isReviewedNestJSPresetLockArtifact(lockArtifact(), NESTJS_BACKEND_PROVIDER_DESCRIPTOR)
    ).toBe(true)
    const result = emitArtifact(lockArtifact())
    expect(result.ok, JSON.stringify(result.ok ? [] : result.diagnostics)).toBe(true)
    if (!result.ok) throw new Error('Expected the exact reviewed lock')
    expect(result.emission.files.get(LOCK_PATH)).toBe(NESTJS_PRESET_LOCK_SOURCE)
    expect(
      result.emission.manifest.artifacts.find((entry) => entry.path === LOCK_PATH)?.byteLength
    ).toBe(new TextEncoder().encode(NESTJS_PRESET_LOCK_SOURCE).length)
  })

  test.each([
    ['appended byte', NESTJS_PRESET_LOCK_SOURCE + '\n'],
    ['equivalent JSON whitespace', NESTJS_PRESET_LOCK_SOURCE.replace('{\n', '{ \n')],
    ['changed value', NESTJS_PRESET_LOCK_SOURCE.replace('0.0.0', '0.0.1')],
    ['appended canary', NESTJS_PRESET_LOCK_SOURCE + SECRET_CANARY],
    ['original secret canary', SECRET_CANARY]
  ])('rejects %s without a generic hash exemption', (_name, content) => {
    expect(containsBackendSecretLikeMaterial(content)).toBe(true)
    expectForbidden(lockArtifact({ content }))
  })

  test.each([
    ['path', { path: 'backend/nestjs/other-lock.json' }],
    ['case', { path: 'backend/nestjs/Package-lock.json' }],
    ['kind', { kind: 'client-config' as const }],
    ['media type', { mediaType: 'text/plain' }]
  ])('rejects the exact bytes under another %s', (_name, change) => {
    expectForbidden(lockArtifact(change))
  })

  test('does not grant another reviewed provider the NestJS lock exception', () => {
    expect(
      isReviewedNestJSPresetLockArtifact(
        lockArtifact(),
        SUPABASE_BACKEND_PROVIDER_BUNDLE.descriptor
      )
    ).toBe(false)
    const result = emitArtifact(lockArtifact(), SUPABASE_BACKEND_PROVIDER_BUNDLE)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('A different provider cannot use the exception')
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'backend-artifact-secret-material-forbidden' })
    )
    expect(
      isReviewedNestJSPresetLockArtifact(lockArtifact(), {
        ...NESTJS_BACKEND_PROVIDER_DESCRIPTOR,
        adapterVersion: '1.0.1'
      })
    ).toBe(false)
  })

  test('retains normal path reservation and rejects binary representations', () => {
    expect(emitArtifact(lockArtifact(), NESTJS_BACKEND_PROVIDER_BUNDLE, [LOCK_PATH]).ok).toBe(false)
    const binary = lockArtifact({ content: new TextEncoder().encode(NESTJS_PRESET_LOCK_SOURCE) })
    expect(isReviewedNestJSPresetLockArtifact(binary, NESTJS_BACKEND_PROVIDER_DESCRIPTOR)).toBe(
      false
    )
    const result = emitArtifact(binary)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('Text-only artifact policy must remain enforced')
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'backend-artifact-binary-content-forbidden' })
    )
  })

  test('continues rejecting SRI-like strings in application input', () => {
    const integrity: unknown =
      JSON.parse(NESTJS_PRESET_LOCK_SOURCE).packages['node_modules/@nestjs/common'].integrity
    if (typeof integrity !== 'string') throw new Error('Expected a reviewed package integrity')
    expect(containsBackendSecretLikeMaterial(integrity)).toBe(true)
    const application = structuredClone(nestJSApplication())
    application.dataModel.entities[0].fields[2].default = {
      kind: 'literal',
      value: integrity
    }
    const result = parseBackendApplicationSpecV1(application)
    expect(result.ok).toBe(false)
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'backend-secret-material-forbidden' })
    )
  })

  test('stores the admitted snapshot when an adapter exposes changing accessors', () => {
    const artifact = lockArtifact()
    let contentReads = 0
    let pathReads = 0
    Object.defineProperties(artifact, {
      content: {
        enumerable: true,
        get() {
          contentReads += 1
          return contentReads === 1 ? NESTJS_PRESET_LOCK_SOURCE : SECRET_CANARY
        }
      },
      path: {
        enumerable: true,
        get() {
          pathReads += 1
          return pathReads === 1 ? LOCK_PATH : 'backend/nestjs/unreviewed.json'
        }
      }
    })
    const result = emitArtifact(artifact)
    expect(result.ok, JSON.stringify(result.ok ? [] : result.diagnostics)).toBe(true)
    if (!result.ok) throw new Error('Expected the admitted static snapshot')
    expect(contentReads).toBe(1)
    expect(pathReads).toBe(1)
    expect(result.emission.files.get(LOCK_PATH)).toBe(NESTJS_PRESET_LOCK_SOURCE)
    expect(result.emission.files.has('backend/nestjs/unreviewed.json')).toBe(false)
  })

  test('keeps the locked root pins and bounded registry SHA-512 integrity records', () => {
    const lock = JSON.parse(NESTJS_PRESET_LOCK_SOURCE)
    expect(lock.lockfileVersion).toBe(3)
    expect(lock.packages[''].dependencies).toEqual(NESTJS_PROJECT_PACKAGE.dependencies)
    expect(lock.packages[''].devDependencies).toEqual(NESTJS_PROJECT_PACKAGE.devDependencies)
    const records = Object.entries(lock.packages).filter(([path]) => path !== '')
    expect(records.length).toBeGreaterThan(0)
    for (const [_path, record] of records) {
      if (!record || typeof record !== 'object') throw new Error('Expected a pinned package record')
      const resolved = Reflect.get(record, 'resolved')
      const integrity = Reflect.get(record, 'integrity')
      if (typeof resolved !== 'string' || typeof integrity !== 'string')
        throw new Error('Expected package provenance')
      const url = new URL(resolved)
      expect(url.origin).toBe('https://registry.npmjs.org')
      expect(url.username + url.password + url.search + url.hash).toBe('')
      expect(integrity).toMatch(/^sha512-[A-Za-z0-9+/]{86}==$/u)
      const bytes = Buffer.from(integrity.slice(7), 'base64')
      expect(bytes.byteLength).toBe(64)
      expect(bytes.toString('base64')).toBe(integrity.slice(7))
    }
  })
})
