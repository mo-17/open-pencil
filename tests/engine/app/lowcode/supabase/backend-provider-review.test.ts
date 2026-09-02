import { describe, expect, test } from 'bun:test'

import { effectScope, nextTick, ref } from 'vue'

import type { SupabaseConfig } from '@open-pencil/scene-graph'

import { useSupabaseBackendProviderReview } from '@/app/lowcode/supabase/backend-provider-review'
import type { AppBackendProviderDocumentGraph } from '@/app/plugins/host/backend-provider'
import {
  DesktopSupabaseBackendReviewError,
  type DesktopSupabaseBackendReviewResult,
  type DesktopSupabaseBackendReviewService
} from '@/app/plugins/host/deployment/desktop-supabase-backend-review'

const PROJECT_URL = 'https://enekobitnhobuiuamvqj.supabase.co'
const GRAPH: AppBackendProviderDocumentGraph = {
  rootId: 'root-1',
  getNode: () => undefined
}
const SECOND_GRAPH: AppBackendProviderDocumentGraph = {
  rootId: 'root-2',
  getNode: () => undefined
}
const THIRD_GRAPH: AppBackendProviderDocumentGraph = {
  rootId: 'root-3',
  getNode: () => undefined
}
// The composable treats the artifact as opaque; artifact validation belongs to the service tests.
const OPAQUE_ARTIFACT = Object.freeze({}) as DesktopSupabaseBackendReviewResult['artifact']
const RESULT: DesktopSupabaseBackendReviewResult = {
  artifact: OPAQUE_ARTIFACT,
  documentDigest: 'document-digest',
  projectRef: 'enekobitnhobuiuamvqj',
  accountId: 'org-1',
  grantGeneration: '123e4567-e89b-42d3-a456-426614174000',
  reviewReady: true,
  blockerCount: 0,
  applyAvailable: false,
  applyPerformed: false
}

describe('Supabase Backend Provider review composable', () => {
  test('keeps the product entry explicit and review-only with no Apply action', async () => {
    const source = await Bun.file(
      'src/components/properties/Lowcode/SupabaseSchemaInspector.vue'
    ).text()
    const reviewSection = source.slice(
      source.indexOf('data-test-id="lowcode-supabase-backend-review"')
    )

    expect(reviewSection).toContain('data-test-id="lowcode-supabase-backend-review-action"')
    expect(reviewSection).toContain('@click="backendReview.review"')
    expect(reviewSection).toContain('panels.lowcodeSupabaseBackendReviewOnly')
    expect(reviewSection).toContain('panels.lowcodeSupabaseBackendReviewApplyUnavailable')
    expect(reviewSection).toContain(
      'data-test-id="lowcode-supabase-backend-review-copy-sql"'
    )
    expect(reviewSection).toContain('@click="copyReviewSql"')
    expect(source).toContain('navigator.clipboard.writeText(sql)')
    expect(reviewSection).toContain('panels.lowcodeSupabaseBackendReviewCopySql')
    expect(reviewSection).toContain('panels.lowcodeSupabaseBackendReviewCopied')
    expect(reviewSection).toContain('panels.lowcodeSupabaseBackendReviewCopyFailed')
    expect(reviewSection).not.toMatch(/@click="[^"]*(?:apply|deploy)/iu)
  })

  test('runs only after an explicit review call and exposes the result', async () => {
    let calls = 0
    const config = ref<SupabaseConfig>({ url: PROJECT_URL, anonKey: '' })
    const service: DesktopSupabaseBackendReviewService = {
      async review(input) {
        calls += 1
        expect(input.readConfig?.()).toBe(config.value)
        return RESULT
      }
    }
    const scope = effectScope()
    const review = scope.run(() =>
      useSupabaseBackendProviderReview(config, () => GRAPH, { service })
    )
    if (!review) throw new Error('Missing composable')

    expect(calls).toBe(0)
    expect(review.state.value).toBe('idle')
    await review.review()
    expect(calls).toBe(1)
    expect(review.state.value).toBe('ready')
    expect(review.result.value).toBe(RESULT)
    scope.stop()
  })

  test('aborts and clears a stale result when the project configuration changes', async () => {
    let resolveReview: ((value: DesktopSupabaseBackendReviewResult) => void) | undefined
    let capturedSignal: AbortSignal | undefined
    const pending = new Promise<DesktopSupabaseBackendReviewResult>((resolve) => {
      resolveReview = resolve
    })
    const config = ref<SupabaseConfig>({ url: PROJECT_URL, anonKey: '' })
    const service: DesktopSupabaseBackendReviewService = {
      review(input) {
        capturedSignal = input.signal
        return pending
      }
    }
    const scope = effectScope()
    const review = scope.run(() =>
      useSupabaseBackendProviderReview(config, () => GRAPH, { service })
    )
    if (!review) throw new Error('Missing composable')

    const operation = review.review()
    expect(review.state.value).toBe('loading')
    config.value = { ...config.value, schema: 'private' }
    await nextTick()
    expect(capturedSignal?.aborted).toBe(true)
    expect(review.state.value).toBe('idle')
    resolveReview?.(RESULT)
    await operation
    expect(review.result.value).toBeNull()
    scope.stop()
  })

  test('maps typed fail-closed errors without exposing an internal message', async () => {
    const service: DesktopSupabaseBackendReviewService = {
      async review() {
        throw new DesktopSupabaseBackendReviewError('desktop-required')
      }
    }
    const scope = effectScope()
    const review = scope.run(() =>
      useSupabaseBackendProviderReview(
        ref<SupabaseConfig>({ url: PROJECT_URL, anonKey: '' }),
        () => GRAPH,
        { service }
      )
    )
    if (!review) throw new Error('Missing composable')

    await review.review()
    expect(review.state.value).toBe('error')
    expect(review.error.value).toBe('desktop-required')
    scope.stop()
  })

  test('reviews the current document graph after a tab switch or graph replacement', async () => {
    let currentGraph = GRAPH
    const observedRootIds: string[] = []
    const service: DesktopSupabaseBackendReviewService = {
      async review(input) {
        observedRootIds.push(input.graph.rootId)
        currentGraph = THIRD_GRAPH
        observedRootIds.push(input.graph.rootId)
        return RESULT
      }
    }
    const scope = effectScope()
    const review = scope.run(() =>
      useSupabaseBackendProviderReview(
        ref<SupabaseConfig>({ url: PROJECT_URL, anonKey: '' }),
        () => currentGraph,
        { service }
      )
    )
    if (!review) throw new Error('Missing composable')

    currentGraph = SECOND_GRAPH
    await review.review()
    expect(observedRootIds).toEqual(['root-2', 'root-3'])
    expect(review.state.value).toBe('ready')
    scope.stop()
  })
})
