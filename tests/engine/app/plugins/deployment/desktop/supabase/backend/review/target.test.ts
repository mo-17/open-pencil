import { describe, expect, test } from 'bun:test'

import { digestCanonicalManifest } from '@open-pencil/scene-graph'

import { createAppPluginStore, createMemoryAppPluginStateStorage } from '@/app/plugins'
import {
  APP_BACKEND_PROVIDER_REQUEST_FORMAT,
  appBackendProviderDocumentValue,
  listAppBackendProviderDescriptors,
  prepareAppBackendProviderDocumentBuild,
  resolveAppBackendProviderReleaseAuthority,
  type PreparedAppBackendProviderBuild
} from '@/app/plugins/host/backend-provider'
import {
  createDesktopSupabaseBackendReviewService,
  type DesktopSupabaseBackendReviewDependencies,
  type DesktopSupabaseBackendReviewInput
} from '@/app/plugins/host/deployment/desktop/supabase/backend/review'
import { createAppDesktopSupabaseBackendReviewServiceForTestingV1 } from '@/app/plugins/host/deployment/desktop/supabase/backend/review-app'
import type { DesktopSupabaseBackendTarget } from '@/app/plugins/host/deployment/desktop/supabase/backend/target'

import {
  GRANT_GENERATION,
  NOW,
  ORGANIZATION_ID,
  PAT,
  PROJECT_REF,
  PROJECT_URL,
  application,
  bundledBackendProvider,
  catalogResponse,
  graph,
  jsonResponse
} from './helpers'

async function setup() {
  const store = createAppPluginStore({
    storage: createMemoryAppPluginStateStorage(),
    catalog: [bundledBackendProvider()],
    activationCompatibilityPolicy: () => ({ ok: true }),
    engineVersion: '0.15.0'
  })
  const loaded = await store.load()
  if (loaded.error) throw loaded.error
  const descriptor = listAppBackendProviderDescriptors(store)[0]
  if (!descriptor) throw new Error('Missing active Supabase provider')
  const document = graph(
    appBackendProviderDocumentValue({
      format: APP_BACKEND_PROVIDER_REQUEST_FORMAT,
      selection: descriptor,
      application: application()
    })
  )
  const requests: string[] = []
  let nextId = 0
  const appService = createAppDesktopSupabaseBackendReviewServiceForTestingV1({
    isDesktop: () => true,
    pluginStore: store,
    pluginStoreReady: () => Promise.resolve(),
    now: () => NOW,
    nextId: () => `target-review-${++nextId}`,
    fetcher: async (input, init) => {
      const url = String(input)
      requests.push(init?.method ?? 'GET')
      return init?.method === 'POST'
        ? jsonResponse(catalogResponse(), 201, url)
        : jsonResponse(
            { ref: PROJECT_REF, organization_id: ORGANIZATION_ID, organization_slug: 'staging' },
            200,
            url
          )
    },
    dependencyOverrides: {
      resolveCredential: async () => PAT,
      resolveGrantGeneration: async () => GRANT_GENERATION
    }
  })
  function build(target: DesktopSupabaseBackendTarget): PreparedAppBackendProviderBuild {
    const value = prepareAppBackendProviderDocumentBuild(store, document, {
      target,
      mode: 'production'
    })
    if (!value) throw new Error('Missing Backend Provider build')
    return value
  }
  function input(target?: DesktopSupabaseBackendTarget): DesktopSupabaseBackendReviewInput {
    return {
      config: { url: PROJECT_URL, anonKey: '', schema: 'public' },
      graph: document,
      ...(target === undefined ? {} : { target })
    }
  }
  function dependencies(
    overrides: Partial<DesktopSupabaseBackendReviewDependencies> = {}
  ): DesktopSupabaseBackendReviewDependencies {
    return {
      prepareBuild: (_graph, target) => build(target),
      resolveBackendProviderAuthority: (value) =>
        resolveAppBackendProviderReleaseAuthority(store, value.descriptor),
      resolveCredential: async () => PAT,
      resolveGrantGeneration: async () => GRANT_GENERATION,
      async prepareStrictReview(value) {
        if (value.build.plan.target !== 'react' && value.build.plan.target !== 'vue') {
          throw new Error('Expected a supported web target')
        }
        return (await appService.review(input(value.build.plan.target))).artifact
      },
      ...overrides
    }
  }
  return { appService, build, dependencies, input, requests }
}

describe('Desktop Supabase Backend review target authority', () => {
  test('uses public compiler target digests and preserves the default React review', async () => {
    const prepared = await setup()
    const react = prepared.build('react')
    const vue = prepared.build('vue')
    expect(react.plan.applicationDigest).toBe(vue.plan.applicationDigest)
    expect(react.plan.planDigest).not.toBe(vue.plan.planDigest)
    expect(react.emission.manifestDigest).not.toBe(vue.emission.manifestDigest)
    const reviewed = await prepared.appService.review(prepared.input())
    expect(reviewed.artifact.manifest.target).toBe('react')
    expect(reviewed.artifact.manifest.compiler.planDigest).toBe(react.plan.planDigest)
    expect(prepared.requests).toEqual(['GET', 'GET', 'POST'])
  })

  test('builds and returns an actual Vue App review without granting Apply', async () => {
    const prepared = await setup()
    const vue = prepared.build('vue')
    const reviewed = await prepared.appService.review(prepared.input('vue'))
    expect(reviewed.artifact.manifest.target).toBe('vue')
    expect(reviewed.artifact.manifest.compiler).toEqual({
      applicationDigest: vue.plan.applicationDigest,
      planDigest: vue.plan.planDigest,
      emissionManifestDigest: vue.emission.manifestDigest
    })
    expect(reviewed.applyAvailable).toBe(false)
    expect(reviewed.applyPerformed).toBe(false)
    expect(prepared.requests).toEqual(['GET', 'GET', 'POST'])
  })

  test('captures target once and uses it for initial and fresh builds', async () => {
    const prepared = await setup()
    const targets: DesktopSupabaseBackendTarget[] = []
    let targetReads = 0
    const input = {
      ...prepared.input(),
      get target(): DesktopSupabaseBackendTarget {
        targetReads += 1
        return targetReads === 1 ? 'vue' : 'react'
      }
    }
    const service = createDesktopSupabaseBackendReviewService(
      prepared.dependencies({
        prepareBuild(_graph, target) {
          targets.push(target)
          return prepared.build(target)
        },
        async prepareStrictReview(value) {
          await value.revalidateLocalAuthority({ stage: 'initial' })
          return (await prepared.appService.review(prepared.input('vue'))).artifact
        }
      })
    )
    const reviewed = await service.review(input)
    expect(targetReads).toBe(1)
    expect(targets).toEqual(['vue', 'vue', 'vue'])
    expect(reviewed.artifact.manifest.target).toBe('vue')
  })

  test('rejects unsupported runtime targets before build or credential resolution', async () => {
    const prepared = await setup()
    let calls = 0
    const service = createDesktopSupabaseBackendReviewService(
      prepared.dependencies({
        prepareBuild() {
          calls += 1
          return prepared.build('react')
        },
        async resolveCredential() {
          calls += 1
          return PAT
        }
      })
    )
    for (const target of [null, '', 'flutter', 'Vue', 1, { target: 'vue' }]) {
      const input = prepared.input()
      Object.defineProperty(input, 'target', { value: target })
      await expect(service.review(input)).rejects.toMatchObject({ code: 'invalid-target' })
    }
    expect(calls).toBe(0)
    expect(prepared.requests).toEqual([])
  })

  for (const mismatch of ['plan', 'emission'] as const) {
    test(`rejects an initial ${mismatch} target mismatch before credential use`, async () => {
      const prepared = await setup()
      const vue = prepared.build('vue')
      let credentialCalls = 0
      let strictCalls = 0
      const wrong =
        mismatch === 'plan'
          ? { ...vue, plan: { ...vue.plan, target: 'react' as const } }
          : {
              ...vue,
              emission: {
                ...vue.emission,
                manifest: { ...vue.emission.manifest, target: 'react' as const }
              }
            }
      const service = createDesktopSupabaseBackendReviewService(
        prepared.dependencies({
          prepareBuild: () => wrong,
          async resolveCredential() {
            credentialCalls += 1
            return PAT
          },
          async prepareStrictReview() {
            strictCalls += 1
            return (await prepared.appService.review(prepared.input('vue'))).artifact
          }
        })
      )
      await expect(service.review(prepared.input('vue'))).rejects.toMatchObject({
        code: 'backend-provider-unavailable'
      })
      expect(credentialCalls).toBe(0)
      expect(strictCalls).toBe(0)
    })

    test(`rejects a changed ${mismatch} target at fresh revalidation`, async () => {
      const prepared = await setup()
      const vue = prepared.build('vue')
      let buildCalls = 0
      const service = createDesktopSupabaseBackendReviewService(
        prepared.dependencies({
          prepareBuild() {
            buildCalls += 1
            if (buildCalls === 1) return vue
            return mismatch === 'plan'
              ? { ...vue, plan: { ...vue.plan, target: 'react' } }
              : {
                  ...vue,
                  emission: {
                    ...vue.emission,
                    manifest: { ...vue.emission.manifest, target: 'react' }
                  }
                }
          }
        })
      )
      await expect(service.review(prepared.input('vue'))).rejects.toMatchObject({
        code: 'review-stale'
      })
      expect(buildCalls).toBe(2)
    })
  }

  for (const target of ['react', 'flutter', '']) {
    test(`rejects a returned ${target || 'empty'} target even with a recomputed artifact digest`, async () => {
      const prepared = await setup()
      const service = createDesktopSupabaseBackendReviewService(
        prepared.dependencies({
          async prepareStrictReview() {
            const artifact = (await prepared.appService.review(prepared.input('vue'))).artifact
            const manifest = { ...artifact.manifest, target }
            return {
              ...artifact,
              manifest,
              manifestDigest: await digestCanonicalManifest(manifest)
            }
          }
        })
      )
      await expect(service.review(prepared.input('vue'))).rejects.toMatchObject({
        code: 'artifact-invalid'
      })
    })
  }
})
