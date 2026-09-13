import { describe, expect, test } from 'bun:test'

import {
  backendProviderPlanDigest,
  backendProviderPlanDigestV2,
  createBackendProviderPlan,
  createBackendProviderPlanV2,
  emitBackendProviderPlan,
  emitBackendProviderPlanV2,
  lowerSupabaseBackendApplicationV2ToV1
} from '@open-pencil/compiler/backend'
import {
  deriveBackendApplicationCapabilitiesV2,
  digestBackendApplication,
  digestBackendApplicationV2
} from '@open-pencil/lowcode/backend'

import {
  HTTP_API_DIAGNOSTIC,
  baselineApplication,
  baselineApplicationV2,
  httpAPIApplication,
  httpAPIApplicationV2,
  trackedSupabaseProvider,
  trackedSupabaseProviderV2
} from './helpers'

const MODES = ['production', 'preview', 'source-only-prototype'] as const

describe('HTTP API intent requires an implemented compiler provider', () => {
  test.each(MODES)('V1 rejects %s before any provider validation callback', (mode) => {
    const { registry, selection, calls } = trackedSupabaseProvider()
    const result = createBackendProviderPlan(registry, {
      selection,
      application: httpAPIApplication(),
      target: 'react',
      mode
    })
    expect(result.ok).toBe(false)
    expect(result.diagnostics).toContainEqual(expect.objectContaining(HTTP_API_DIAGNOSTIC))
    expect(calls).toEqual([])
  })

  test.each(MODES)('V2 rejects %s before any provider validation callback', (mode) => {
    const { registry, selection, calls } = trackedSupabaseProviderV2()
    const result = createBackendProviderPlanV2(registry, {
      selection,
      application: httpAPIApplicationV2(),
      target: 'vue',
      mode
    })
    expect(result.ok).toBe(false)
    expect(result.diagnostics).toContainEqual(expect.objectContaining(HTTP_API_DIAGNOSTIC))
    expect(calls).toEqual([])
  })

  test('V1 emission rejects HTTP intent even after application and plan digests are recomputed', async () => {
    const { registry, selection, calls } = trackedSupabaseProvider()
    const baseline = createBackendProviderPlan(registry, {
      selection,
      application: baselineApplication(),
      target: 'react',
      mode: 'production'
    })
    if (!baseline.ok) throw new Error('Baseline V1 provider must plan successfully')
    const application = httpAPIApplication()
    const changed = {
      ...baseline.plan,
      application,
      applicationDigest: await digestBackendApplication(application)
    }
    changed.planDigest = backendProviderPlanDigest(changed)
    calls.length = 0
    const result = emitBackendProviderPlan(registry, { selection, plan: changed })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('HTTP declaration must not emit files')
    expect(result.diagnostics).toContainEqual(expect.objectContaining(HTTP_API_DIAGNOSTIC))
    expect(calls).toEqual([])
  })

  test('V2 emission rejects HTTP intent with recomputed application, actual capabilities and plan digest', async () => {
    const { registry, selection, calls } = trackedSupabaseProviderV2()
    const baseline = createBackendProviderPlanV2(registry, {
      selection,
      application: baselineApplicationV2(),
      target: 'vue',
      mode: 'production'
    })
    if (!baseline.ok) throw new Error('Baseline V2 provider must plan successfully')
    const application = httpAPIApplicationV2()
    const changed = {
      ...baseline.plan,
      application,
      applicationDigest: await digestBackendApplicationV2(application),
      actualCapabilities: deriveBackendApplicationCapabilitiesV2(application)
    }
    changed.planDigest = backendProviderPlanDigestV2(changed)
    calls.length = 0
    const result = emitBackendProviderPlanV2(registry, { selection, plan: changed })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('HTTP declaration must not emit V2 files')
    expect(result.diagnostics).toContainEqual(expect.objectContaining(HTTP_API_DIAGNOSTIC))
    expect(calls).toEqual([])
  })

  test('the public Supabase V2-to-V1 projection preserves HTTP intent for rejection', () => {
    const source = httpAPIApplicationV2()
    const lowered = lowerSupabaseBackendApplicationV2ToV1(source)
    expect(lowered.httpApi).toEqual(source.httpApi)
    const { registry, selection, calls } = trackedSupabaseProvider()
    const result = createBackendProviderPlan(registry, {
      selection,
      application: lowered,
      target: 'vue',
      mode: 'production'
    })
    expect(result.ok).toBe(false)
    expect(result.diagnostics).toContainEqual(expect.objectContaining(HTTP_API_DIAGNOSTIC))
    expect(calls).toEqual([])
  })
})

// Captured from the existing managed-notes fixture before the HTTP contract and
// compiler guards were added. These hashes cover the complete plan and manifest.
const BASELINES = [
  {
    target: 'react',
    v1: {
      plan: 'OBb8BEOCiypBN7UNg9Y1HZusOwKuiMGm3kFIHVn03rI',
      manifest: 'pPVj_hxzRMkO4Uy3SFcf4Q8GnasEQvxxVJAM5YUpdEw'
    },
    v2: {
      plan: 'eJ7bKzcb42-pYWq0CWi_i6JXnoHdMDNAMGdvgb_exUY',
      manifest: 'IW7JrG1U3oeRaKbB_McHlsBSIUpKneGVxo-AogJKDiY'
    }
  },
  {
    target: 'vue',
    v1: {
      plan: 'RSPcI-VzhS95LWQWNkSrq6_Qc8f-lvgKw5ICtso6lC8',
      manifest: 'aP4yvxoEnR2no_QeJ58QuKsD44jckHv56td8jDhtD-A'
    },
    v2: {
      plan: 'yU8meI58AJyAEMjT5kqcqS5n-F75SX3by5-TXC2SgXs',
      manifest: 'AwSnM5emXwGX-wOQAG1UdVQFjEQS8blu8Ud_VvqNT5s'
    }
  }
] as const

describe('Supabase applications without HTTP API keep their output', () => {
  for (const baseline of BASELINES) {
    test(`V1 ${baseline.target} plan and emitted manifest remain byte-bound to the baseline`, () => {
      const { registry, selection } = trackedSupabaseProvider()
      const result = createBackendProviderPlan(registry, {
        selection,
        application: baselineApplication(),
        target: baseline.target,
        mode: 'production'
      })
      if (!result.ok) throw new Error('Baseline V1 provider must plan successfully')
      expect(Object.hasOwn(result.plan.application, 'httpApi')).toBe(false)
      expect(result.plan.planDigest).toBe(baseline.v1.plan)
      const emitted = emitBackendProviderPlan(registry, { selection, plan: result.plan })
      if (!emitted.ok) throw new Error('Baseline V1 provider must emit successfully')
      expect(emitted.emission.manifestDigest).toBe(baseline.v1.manifest)
      expect([...emitted.emission.files.keys()]).toEqual([
        'backend/supabase/migration-plan.json',
        'openpencil-backend.manifest.json'
      ])
    })

    test(`V2 ${baseline.target} plan and emitted manifest remain byte-bound to the baseline`, () => {
      const { registry, selection } = trackedSupabaseProviderV2()
      const result = createBackendProviderPlanV2(registry, {
        selection,
        application: baselineApplicationV2(),
        target: baseline.target,
        mode: 'production'
      })
      if (!result.ok) throw new Error('Baseline V2 provider must plan successfully')
      expect(Object.hasOwn(result.plan.application, 'httpApi')).toBe(false)
      expect(result.plan.planDigest).toBe(baseline.v2.plan)
      const emitted = emitBackendProviderPlanV2(registry, { selection, plan: result.plan })
      if (!emitted.ok) throw new Error('Baseline V2 provider must emit successfully')
      expect(emitted.emission.manifestDigest).toBe(baseline.v2.manifest)
      expect([...emitted.emission.files.keys()]).toEqual([
        'backend/supabase-v2/base/database-schema.json',
        'backend/supabase-v2/base/migration-plan.json',
        'openpencil-backend.v2.manifest.json'
      ])
    })
  }
})
