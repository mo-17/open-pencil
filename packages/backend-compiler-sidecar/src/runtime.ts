import {
  createBackendProviderPlanV2,
  createBackendProviderRegistryV2,
  createSupabaseBackfillCompilerSelectionV1,
  createSupabaseBackfillInspectionSubjectV1,
  createSupabaseBackfillInspectionWireResponseV1,
  parseSupabaseBackfillInspectionWireRequestV1,
  SUPABASE_BACKEND_PROVIDER_BUNDLE_V2,
  type ParsedSupabaseBackfillInspectionWireRequestV1
} from '@open-pencil/compiler/backend'

import { BackendCompilerSidecarError } from './protocol'

const registry = createBackendProviderRegistryV2(
  Object.freeze([SUPABASE_BACKEND_PROVIDER_BUNDLE_V2])
)

function compareASCII(left: string, right: string): number {
  return left < right ? -1 : Number(left > right)
}

/**
 * Detach one immutable application snapshot from the wire request before any
 * planning callback runs. The strict wire parser already bounds this JSON; the
 * second inert-data check prevents programmatic callers from injecting accessors
 * or mutating the value between planning and inspection.
 */
function freezeApplicationSnapshot(value: unknown, ancestors = new Set<object>()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new BackendCompilerSidecarError('invalid-request')
    }
    return value
  }
  if (typeof value !== 'object' || ancestors.has(value)) {
    throw new BackendCompilerSidecarError('invalid-request')
  }
  const prototype = Object.getPrototypeOf(value)
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new BackendCompilerSidecarError('invalid-request')
  }
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      return Object.freeze(value.map((entry) => freezeApplicationSnapshot(entry, ancestors)))
    }
    const keys = Reflect.ownKeys(value)
    if (keys.some((key) => typeof key !== 'string')) {
      throw new BackendCompilerSidecarError('invalid-request')
    }
    return Object.freeze(
      Object.fromEntries(
        (keys as string[]).sort(compareASCII).map((key) => {
          const descriptor = Object.getOwnPropertyDescriptor(value, key)
          if (!descriptor?.enumerable || !('value' in descriptor)) {
            throw new BackendCompilerSidecarError('invalid-request')
          }
          return [key, freezeApplicationSnapshot(descriptor.value, ancestors)]
        })
      )
    )
  } finally {
    ancestors.delete(value)
  }
}

function createFromParsedWireRequest(parsed: ParsedSupabaseBackfillInspectionWireRequestV1) {
  const application = freezeApplicationSnapshot(parsed.request.application)
  const selection = createSupabaseBackfillCompilerSelectionV1()
  const planned = createBackendProviderPlanV2(registry, {
    application,
    target: parsed.request.target,
    mode: 'production',
    selection
  })
  if (!planned.ok) throw new BackendCompilerSidecarError('plan-rejected')

  try {
    const subjectEnvelope = createSupabaseBackfillInspectionSubjectV1(registry, {
      plan: planned.plan,
      selection
    })
    return createSupabaseBackfillInspectionWireResponseV1({
      request: parsed.request,
      requestDigest: parsed.requestDigest,
      subjectEnvelope
    })
  } catch {
    throw new BackendCompilerSidecarError('inspection-failed')
  }
}

/** Parse the canonical wire frame inside the pure Compiler runtime boundary. */
export function createSupabaseBackfillInspectionFromWire(input: string) {
  let parsed: ParsedSupabaseBackfillInspectionWireRequestV1
  try {
    parsed = parseSupabaseBackfillInspectionWireRequestV1(input)
  } catch {
    throw new BackendCompilerSidecarError('invalid-request')
  }
  return createFromParsedWireRequest(parsed)
}
