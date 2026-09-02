import {
  containsBackendSecretLikeMaterial,
  parseBackendApplicationSpecV1,
  validateBackendCapabilityDeclarations
} from '@open-pencil/lowcode/backend'
import type { BackendDiagnostic } from '@open-pencil/lowcode/backend'
import type { JSONValue } from '@open-pencil/scene-graph/primitives'

import type { CompilerTarget } from '../types'
import {
  cloneCanonicalBackendValue,
  digestCanonicalBackendValue,
  freezeBackendValue
} from './canonical'
import { negotiateBackendCapabilities } from './capability-matrix'
import {
  BACKEND_PROVIDER_ADAPTER_SLOTS,
  BACKEND_PROVIDER_PLAN_VERSION,
  type BackendCapabilityDecision,
  type BackendProviderAdapterContext,
  type BackendProviderAdapterPlans,
  type BackendProviderAdapterSlot,
  type BackendProviderAuthority,
  type BackendProviderBundle,
  type BackendProviderPlan,
  type BackendProviderPlanResult,
  type BackendProviderSelection,
  isBackendCompilationMode,
  type BackendCompilationMode
} from './contracts'
import {
  backendDiagnostic,
  hasBackendErrors,
  normalizeProviderDiagnostics,
  sortBackendDiagnostics,
  unsupportedBackendCompilationModeDiagnostic
} from './diagnostics'
import type { BackendProviderRegistry } from './registry'

export interface CreateBackendProviderPlanInput {
  readonly selection: BackendProviderSelection
  readonly application: unknown
  readonly target: CompilerTarget
  readonly mode: BackendCompilationMode
}

interface BackendProviderPlanPayload {
  readonly version: typeof BACKEND_PROVIDER_PLAN_VERSION
  readonly authority: BackendProviderAuthority
  readonly application: BackendProviderPlan['application']
  readonly applicationDigest: string
  readonly target: CompilerTarget
  readonly mode: BackendCompilationMode
  readonly capabilities: readonly BackendCapabilityDecision[]
  readonly adapterPlans: BackendProviderAdapterPlans
}

export function backendProviderAuthority(
  selection: BackendProviderSelection
): BackendProviderAuthority {
  const descriptor = selection.descriptor
  return freezeBackendValue({
    pluginId: descriptor.pluginId,
    packageDigest: selection.packageDigest,
    contributionId: descriptor.contributionId,
    providerId: descriptor.providerId,
    adapterId: descriptor.adapterId,
    adapterVersion: descriptor.adapterVersion,
    contractVersion: descriptor.contractVersion,
    supportedModelVersions: [...descriptor.supportedModelVersions],
    capabilities: [...descriptor.capabilities],
    outputs: [...descriptor.outputs]
  }) as BackendProviderAuthority
}

export function sameBackendProviderAuthority(
  left: BackendProviderAuthority,
  right: BackendProviderAuthority
): boolean {
  return (
    digestCanonicalBackendValue(left, '$.authority.left') ===
    digestCanonicalBackendValue(right, '$.authority.right')
  )
}

function planPayload(plan: BackendProviderPlan): BackendProviderPlanPayload {
  return {
    version: plan.version,
    authority: plan.authority,
    application: plan.application,
    applicationDigest: plan.applicationDigest,
    target: plan.target,
    mode: plan.mode,
    capabilities: plan.capabilities,
    adapterPlans: plan.adapterPlans
  }
}

export function backendProviderPlanDigest(
  plan: BackendProviderPlan | BackendProviderPlanPayload
): string {
  const payload = 'planDigest' in plan ? planPayload(plan) : plan
  return digestCanonicalBackendValue(payload, '$.backendProviderPlan')
}

export function activeBackendProviderAdapterSlots(
  bundle: BackendProviderBundle,
  decisions: readonly BackendCapabilityDecision[]
): readonly BackendProviderAdapterSlot[] {
  const included = new Set(
    decisions.filter((decision) => decision.included).map((decision) => decision.capability)
  )
  return BACKEND_PROVIDER_ADAPTER_SLOTS.filter((slot) => {
    const adapter = bundle[slot]
    return Boolean(
      adapter &&
      (adapter.capabilities.length === 0 ||
        adapter.capabilities.some((capability) => included.has(capability)))
    )
  })
}

function providerDiagnostics(
  callback: (() => readonly BackendDiagnostic[]) | undefined,
  path: string,
  failureCode: string
): readonly BackendDiagnostic[] {
  if (!callback) return []
  try {
    const result = callback()
    if (!Array.isArray(result)) {
      return [
        backendDiagnostic(
          'backend-provider-diagnostic-invalid',
          'error',
          path,
          'Backend Provider validation must return an array of diagnostics.'
        )
      ]
    }
    return normalizeProviderDiagnostics(result, path)
  } catch {
    return [
      backendDiagnostic(
        failureCode,
        'error',
        path,
        'Backend Provider validation failed without producing a trusted result.'
      )
    ]
  }
}

function containsSecretLikePlanData(value: JSONValue): boolean {
  if (typeof value === 'string') return containsBackendSecretLikeMaterial(value)
  if (value === null || typeof value !== 'object') return false
  if (Array.isArray(value)) {
    return value.some((entry) => containsSecretLikePlanData(entry as JSONValue))
  }
  return Object.entries(value).some(
    ([key, entry]) =>
      containsBackendSecretLikeMaterial(key) || containsSecretLikePlanData(entry as JSONValue)
  )
}

export function createBackendProviderAdapterContext(
  application: BackendProviderPlan['application'],
  selection: BackendProviderSelection,
  target: CompilerTarget,
  mode: BackendCompilationMode,
  capabilities: readonly BackendCapabilityDecision[]
): BackendProviderAdapterContext {
  return Object.freeze({ application, selection, target, mode, capabilities })
}

export function createBackendProviderPlan(
  registry: BackendProviderRegistry,
  input: CreateBackendProviderPlanInput
): BackendProviderPlanResult {
  let mode: unknown
  try {
    mode = input.mode
  } catch {
    mode = undefined
  }
  if (!isBackendCompilationMode(mode)) {
    return { ok: false, diagnostics: [unsupportedBackendCompilationModeDiagnostic()] }
  }
  let target: unknown
  try {
    target = input.target
  } catch {
    target = undefined
  }
  const resolved = registry.resolve(input.selection)
  if (!resolved.ok)
    return {
      ok: false,
      diagnostics: sortBackendDiagnostics(resolved.diagnostics)
    }

  const applicationResult = parseBackendApplicationSpecV1(input.application)
  if (!applicationResult.ok) {
    return {
      ok: false,
      diagnostics: sortBackendDiagnostics(applicationResult.diagnostics)
    }
  }
  const diagnostics: BackendDiagnostic[] = [
    ...applicationResult.diagnostics,
    ...validateBackendCapabilityDeclarations(applicationResult.value)
  ]
  if (hasBackendErrors(diagnostics)) {
    return { ok: false, diagnostics: sortBackendDiagnostics(diagnostics) }
  }
  const application = freezeBackendValue(
    cloneCanonicalBackendValue(applicationResult.value, '$.application')
  ) as BackendProviderPlan['application']
  const negotiation = negotiateBackendCapabilities({
    requirements: application.capabilities,
    bundle: resolved.value.bundle,
    target: target as CompilerTarget,
    mode
  })
  diagnostics.push(...negotiation.diagnostics)
  if (hasBackendErrors(diagnostics)) {
    return { ok: false, diagnostics: sortBackendDiagnostics(diagnostics) }
  }
  const context = createBackendProviderAdapterContext(
    application,
    resolved.value.selection,
    target as CompilerTarget,
    mode,
    negotiation.decisions
  )

  const bundleValidate = resolved.value.bundle.validate
  diagnostics.push(
    ...providerDiagnostics(
      bundleValidate ? () => bundleValidate(context) : undefined,
      '$.bundle.validate',
      'backend-provider-bundle-validation-failed'
    )
  )

  const activeSlots = activeBackendProviderAdapterSlots(
    resolved.value.bundle,
    negotiation.decisions
  )
  for (const slot of activeSlots) {
    const adapter = resolved.value.bundle[slot]
    if (!adapter) {
      diagnostics.push(
        backendDiagnostic(
          'backend-provider-adapter-missing',
          'error',
          `$.${slot}`,
          'Backend Provider plan referenced a missing trusted adapter.'
        )
      )
      continue
    }
    const adapterValidate = adapter.validate
    diagnostics.push(
      ...providerDiagnostics(
        adapterValidate ? () => adapterValidate(context) : undefined,
        `$.${slot}.validate`,
        'backend-provider-adapter-validation-failed'
      )
    )
  }
  if (hasBackendErrors(diagnostics)) {
    return { ok: false, diagnostics: sortBackendDiagnostics(diagnostics) }
  }

  const adapterPlans: Partial<Record<BackendProviderAdapterSlot, JSONValue>> = {}
  for (const slot of activeSlots) {
    const adapter = resolved.value.bundle[slot]
    if (!adapter) {
      diagnostics.push(
        backendDiagnostic(
          'backend-provider-adapter-missing',
          'error',
          `$.${slot}`,
          'Backend Provider plan referenced a missing trusted adapter.'
        )
      )
      continue
    }
    try {
      const adapterPlan = cloneCanonicalBackendValue(
        adapter.plan(context),
        `$.adapterPlans.${slot}`
      )
      if (containsSecretLikePlanData(adapterPlan)) {
        diagnostics.push(
          backendDiagnostic(
            'backend-provider-plan-secret-material-forbidden',
            'error',
            `$.adapterPlans.${slot}`,
            'Backend Provider plans cannot contain credential or secret material.'
          )
        )
        continue
      }
      adapterPlans[slot] = freezeBackendValue(adapterPlan) as JSONValue
    } catch {
      diagnostics.push(
        backendDiagnostic(
          'backend-provider-plan-failed',
          'error',
          `$.adapterPlans.${slot}`,
          'Backend Provider adapter failed to produce a bounded deterministic plan.'
        )
      )
    }
  }
  if (hasBackendErrors(diagnostics)) {
    return { ok: false, diagnostics: sortBackendDiagnostics(diagnostics) }
  }

  const payload = freezeBackendValue({
    version: BACKEND_PROVIDER_PLAN_VERSION,
    authority: backendProviderAuthority(resolved.value.selection),
    application,
    applicationDigest: digestCanonicalBackendValue(application, '$.application'),
    target: target as CompilerTarget,
    mode,
    capabilities: negotiation.decisions,
    adapterPlans
  }) as BackendProviderPlanPayload
  const plan = freezeBackendValue({
    ...payload,
    planDigest: backendProviderPlanDigest(payload)
  }) as BackendProviderPlan
  return {
    ok: true,
    plan,
    diagnostics: sortBackendDiagnostics(diagnostics)
  }
}
