import { describe, expect, test } from 'bun:test'

import {
  createBackendProviderPlan,
  createBackendProviderRegistry,
  emitBackendProviderPlan
} from '@open-pencil/compiler'

import { createFakeBackendProviderBundle, fakeBackendApplication, fakeSelection } from '../helpers'

const V1_PLAN_DIGEST_GOLDEN = 'r5ZK_7OpUt1pwWQuoUMgLkQCD0Q18qzS6M27JkUX4YE'
const V1_MANIFEST_DIGEST_GOLDEN = 'cm9QegORolFVyIpb6rIb9t9qVIICph9_kkbXs4uF8Ug'

describe('Compiler Backend V1 compatibility', () => {
  test('keeps established V1 plan and manifest bytes unchanged', () => {
    const bundle = createFakeBackendProviderBundle()
    const registry = createBackendProviderRegistry([bundle])
    const selection = fakeSelection(bundle)
    const planned = createBackendProviderPlan(registry, {
      selection,
      application: fakeBackendApplication(),
      target: 'react',
      mode: 'production'
    })
    expect(planned.ok).toBe(true)
    if (!planned.ok) return
    expect(planned.plan.planDigest).toBe(V1_PLAN_DIGEST_GOLDEN)

    const emitted = emitBackendProviderPlan(registry, { plan: planned.plan, selection })
    expect(emitted.ok).toBe(true)
    if (!emitted.ok) return
    expect(emitted.emission.manifestDigest).toBe(V1_MANIFEST_DIGEST_GOLDEN)
    expect(emitted.emission.manifest.format).toBe('openpencil.backend-artifacts.v1')
    expect(emitted.emission.manifest.version).toBe(1)
  })
})
