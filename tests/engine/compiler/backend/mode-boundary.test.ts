import { describe, expect, test } from 'bun:test'

import {
  createBackendProviderPlan,
  createBackendProviderRegistry,
  emitBackendProviderPlan,
  negotiateBackendCapabilities
} from '@open-pencil/compiler'
import type { BackendProviderBundle, BackendProviderPlan } from '@open-pencil/compiler'

import { createFakeBackendProviderBundle, fakeBackendApplication, fakeSelection } from './helpers'

const INVALID_BACKEND_COMPILATION_MODES = [
  ['string', 'development'],
  ['null', null],
  ['boolean', false],
  ['number', 1],
  ['object', {}],
  ['array', []],
  ['undefined', undefined]
] as const

function unsupportedModeDiagnostic() {
  return {
    code: 'backend-compilation-mode-unsupported',
    severity: 'error',
    path: '$.mode',
    message: 'Compiler Backend mode is unsupported.'
  } as const
}

function trapCanonicalReads<T extends object>(value: T, state: { reads: number }): T {
  return new Proxy(value, {
    get(target, property, receiver) {
      state.reads += 1
      return Reflect.get(target, property, receiver)
    },
    ownKeys(target) {
      state.reads += 1
      return Reflect.ownKeys(target)
    },
    getOwnPropertyDescriptor(target, property) {
      state.reads += 1
      return Reflect.getOwnPropertyDescriptor(target, property)
    }
  })
}

function forgedPlanWithMode(
  plan: BackendProviderPlan,
  mode: unknown,
  state: { canonicalReads: number },
  label: string
): BackendProviderPlan {
  return new Proxy(
    { ...plan },
    {
      get(target, property, receiver) {
        if (property === 'mode') return mode
        if (property === 'version') {
          state.canonicalReads += 1
          throw new Error(`canonical plan work ran for invalid ${label} mode`)
        }
        return Reflect.get(target, property, receiver)
      }
    }
  ) as BackendProviderPlan
}

describe('Compiler BackendCompilationMode runtime boundary', () => {
  test('fails closed before plan canonicalization or Provider callbacks', () => {
    const base = createFakeBackendProviderBundle()
    if (!base.data) throw new Error('Fake Provider data adapter is required')
    const data = base.data
    const calls = { bundleValidate: 0, adapterValidate: 0, plan: 0 }
    const bundle: BackendProviderBundle = {
      ...base,
      validate() {
        calls.bundleValidate += 1
        return []
      },
      data: {
        ...data,
        validate() {
          calls.adapterValidate += 1
          return []
        },
        plan(context) {
          calls.plan += 1
          return data.plan(context)
        }
      }
    }
    const registry = createBackendProviderRegistry([bundle])

    for (const [, mode] of INVALID_BACKEND_COMPILATION_MODES) {
      const canonicalState = { reads: 0 }
      const result = createBackendProviderPlan(registry, {
        selection: fakeSelection(bundle),
        application: trapCanonicalReads(fakeBackendApplication(), canonicalState),
        target: 'react',
        mode
      } as never)

      expect(result).toEqual({ ok: false, diagnostics: [unsupportedModeDiagnostic()] })
      expect(canonicalState.reads).toBe(0)
    }
    expect(calls).toEqual({ bundleValidate: 0, adapterValidate: 0, plan: 0 })
  })

  test('fails closed before negotiation inspects requirements or Provider capabilities', () => {
    for (const [, mode] of INVALID_BACKEND_COMPILATION_MODES) {
      const reads = { bundle: 0, requirements: 0 }
      const result = negotiateBackendCapabilities({
        mode,
        target: 'react',
        get requirements() {
          reads.requirements += 1
          throw new Error('requirements must not be read for an invalid mode')
        },
        get bundle() {
          reads.bundle += 1
          throw new Error('bundle must not be read for an invalid mode')
        }
      } as never)

      expect(result).toEqual({ decisions: [], diagnostics: [unsupportedModeDiagnostic()] })
      expect(reads).toEqual({ bundle: 0, requirements: 0 })
    }
  })

  test('fails closed before canonical work or Provider callbacks on forged plan re-emit', () => {
    const base = createFakeBackendProviderBundle()
    if (!base.data) throw new Error('Fake Provider data adapter is required')
    const data = base.data
    const calls = { bundleValidate: 0, adapterValidate: 0, plan: 0, emit: 0 }
    const bundle: BackendProviderBundle = {
      ...base,
      validate() {
        calls.bundleValidate += 1
        return []
      },
      data: {
        ...data,
        validate() {
          calls.adapterValidate += 1
          return []
        },
        plan(context) {
          calls.plan += 1
          return data.plan(context)
        },
        emit(context, plan) {
          calls.emit += 1
          return data.emit(context, plan)
        }
      }
    }
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
    calls.bundleValidate = 0
    calls.adapterValidate = 0
    calls.plan = 0

    for (const [label, mode] of INVALID_BACKEND_COMPILATION_MODES) {
      const canonicalState = { canonicalReads: 0 }
      const result = emitBackendProviderPlan(registry, {
        plan: forgedPlanWithMode(planned.plan, mode, canonicalState, label),
        selection
      })

      expect(result).toEqual({ ok: false, diagnostics: [unsupportedModeDiagnostic()] })
      expect(canonicalState.canonicalReads).toBe(0)
    }
    expect(calls).toEqual({ bundleValidate: 0, adapterValidate: 0, plan: 0, emit: 0 })
  })
})
