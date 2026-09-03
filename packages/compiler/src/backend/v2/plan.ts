import type { CompilerTarget } from '#compiler/types'

import {
  canonicalBackendApplicationV2Bytes,
  containsBackendSecretLikeMaterial,
  deriveBackendApplicationCapabilitiesV2,
  parseBackendApplicationSpecV2,
  validateBackendCapabilityDeclarationsV2,
  type BackendCapabilityRequirementV2,
  type BackendCapabilityV2,
  type BackendDiagnostic
} from '@open-pencil/lowcode/backend'
import type { JSONValue } from '@open-pencil/scene-graph/primitives'

import {
  backendSha256,
  cloneCanonicalBackendValue,
  digestCanonicalBackendValue,
  freezeBackendValue
} from '../canonical'
import {
  backendDiagnostic,
  hasBackendErrors,
  normalizeProviderDiagnostics,
  sortBackendDiagnostics,
  unsupportedBackendCompilationModeDiagnostic
} from '../diagnostics'
import { negotiateBackendCapabilitiesV2 } from './capability-matrix'
import { backendCapabilityAdapterSlotV2 } from './capability-routing'
import {
  BACKEND_PROVIDER_ADAPTER_SLOTS_V2,
  BACKEND_PROVIDER_PLAN_VERSION_V2,
  isBackendCompilationModeV2,
  type BackendCapabilityDecisionV2,
  type BackendCompilationModeV2,
  type BackendProviderAdapterContextV2,
  type BackendProviderAdapterPlansV2,
  type BackendProviderAdapterSlotV2,
  type BackendProviderAuthorityV2,
  type BackendProviderBundleV2,
  type BackendProviderPlanResultV2,
  type BackendProviderPlanV2,
  type BackendProviderSelectionV2
} from './contracts'
import type { BackendProviderRegistryV2 } from './registry'

export interface CreateBackendProviderPlanInputV2 {
  readonly selection: BackendProviderSelectionV2
  readonly application: unknown
  readonly target: CompilerTarget
  readonly mode: BackendCompilationModeV2
}

interface BackendProviderPlanPayloadV2 {
  readonly version: typeof BACKEND_PROVIDER_PLAN_VERSION_V2
  readonly authority: BackendProviderAuthorityV2
  readonly application: BackendProviderPlanV2['application']
  readonly applicationDigest: string
  readonly target: CompilerTarget
  readonly mode: BackendCompilationModeV2
  readonly actualCapabilities: readonly BackendCapabilityV2[]
  readonly capabilities: readonly BackendCapabilityDecisionV2[]
  readonly adapterPlans: BackendProviderAdapterPlansV2
}

export function backendProviderAuthorityV2(
  selection: BackendProviderSelectionV2
): BackendProviderAuthorityV2 {
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
  }) as BackendProviderAuthorityV2
}

export function sameBackendProviderAuthorityV2(
  left: BackendProviderAuthorityV2,
  right: BackendProviderAuthorityV2
): boolean {
  return (
    digestCanonicalBackendValue(left, '$.authorityV2.left') ===
    digestCanonicalBackendValue(right, '$.authorityV2.right')
  )
}

function planPayloadV2(plan: BackendProviderPlanV2): BackendProviderPlanPayloadV2 {
  return {
    version: plan.version,
    authority: plan.authority,
    application: plan.application,
    applicationDigest: plan.applicationDigest,
    target: plan.target,
    mode: plan.mode,
    actualCapabilities: plan.actualCapabilities,
    capabilities: plan.capabilities,
    adapterPlans: plan.adapterPlans
  }
}

export function backendProviderPlanDigestV2(
  plan: BackendProviderPlanV2 | BackendProviderPlanPayloadV2
): string {
  const payload = 'planDigest' in plan ? planPayloadV2(plan) : plan
  return digestCanonicalBackendValue(payload, '$.backendProviderPlanV2')
}

export function activeBackendProviderAdapterSlotsV2(
  bundle: BackendProviderBundleV2,
  decisions: readonly BackendCapabilityDecisionV2[],
  actualCapabilities: readonly BackendCapabilityV2[]
): readonly BackendProviderAdapterSlotV2[] {
  const actual = new Set(actualCapabilities)
  const included = new Set(
    decisions
      .filter((decision) => decision.included && actual.has(decision.capability))
      .map((decision) => decision.capability)
  )
  const active = new Set<BackendProviderAdapterSlotV2>()
  for (const capability of included) {
    const slot = backendCapabilityAdapterSlotV2(capability)
    const adapter = slot ? bundle[slot] : undefined
    if (slot && adapter?.capabilities.includes(capability)) active.add(slot)
  }
  return Object.freeze(BACKEND_PROVIDER_ADAPTER_SLOTS_V2.filter((slot) => active.has(slot)))
}

function providerDiagnosticsV2(
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
          'backend-provider-v2-diagnostic-invalid',
          'error',
          path,
          'Backend Provider V2 validation must return an array of diagnostics.'
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
        'Backend Provider V2 validation failed without producing a trusted result.'
      )
    ]
  }
}

function containsSecretLikePlanDataV2(value: JSONValue): boolean {
  if (typeof value === 'string') return containsBackendSecretLikeMaterial(value)
  if (value === null || typeof value !== 'object') return false
  if (Array.isArray(value)) {
    return value.some((entry) => containsSecretLikePlanDataV2(entry as JSONValue))
  }
  return Object.entries(value).some(
    ([key, entry]) =>
      containsBackendSecretLikeMaterial(key) || containsSecretLikePlanDataV2(entry as JSONValue)
  )
}

export function createBackendProviderAdapterContextV2(
  application: BackendProviderPlanV2['application'],
  selection: BackendProviderSelectionV2,
  target: CompilerTarget,
  mode: BackendCompilationModeV2,
  actualCapabilities: readonly BackendCapabilityV2[],
  capabilities: readonly BackendCapabilityDecisionV2[]
): BackendProviderAdapterContextV2 {
  return Object.freeze({
    application,
    selection,
    target,
    mode,
    actualCapabilities,
    capabilities
  })
}

function actualRequirementsV2(
  application: BackendProviderPlanV2['application'],
  actualCapabilities: readonly BackendCapabilityV2[],
  diagnostics: BackendDiagnostic[]
): readonly BackendCapabilityRequirementV2[] {
  const declarations = new Map(
    application.capabilities.map((requirement) => [requirement.capability, requirement])
  )
  const requirements: BackendCapabilityRequirementV2[] = []
  for (const capability of actualCapabilities) {
    const declaration = declarations.get(capability)
    if (!declaration?.required) {
      diagnostics.push(
        backendDiagnostic(
          'backend-provider-v2-actual-capability-unbound',
          'error',
          `$.capabilities.${capability}`,
          'Backend V2 actual capability must be bound to a required declaration.'
        )
      )
      continue
    }
    requirements.push(Object.freeze({ ...declaration }))
  }
  return Object.freeze(requirements)
}

function invalidApplicationV2(error: unknown): BackendProviderPlanResultV2 {
  void error
  return {
    ok: false,
    diagnostics: Object.freeze([
      backendDiagnostic(
        'backend-provider-v2-application-invalid',
        'error',
        '$.application',
        'Backend Application V2 could not be normalized as bounded inert data.'
      )
    ])
  }
}

// oxlint-disable-next-line complexity -- Fail-closed ordering keeps parsing before all Provider callbacks.
export function createBackendProviderPlanV2(
  registry: BackendProviderRegistryV2,
  input: CreateBackendProviderPlanInputV2
): BackendProviderPlanResultV2 {
  let mode: unknown
  let target: unknown
  let applicationInput: unknown
  try {
    mode = input.mode
    target = input.target
    applicationInput = input.application
  } catch (error) {
    return invalidApplicationV2(error)
  }
  if (!isBackendCompilationModeV2(mode)) {
    return {
      ok: false,
      diagnostics: Object.freeze([unsupportedBackendCompilationModeDiagnostic()])
    }
  }

  let applicationResult: ReturnType<typeof parseBackendApplicationSpecV2>
  try {
    applicationResult = parseBackendApplicationSpecV2(applicationInput)
  } catch (error) {
    return invalidApplicationV2(error)
  }
  if (!applicationResult.ok) {
    return {
      ok: false,
      diagnostics: sortBackendDiagnostics(applicationResult.diagnostics)
    }
  }
  const diagnostics: BackendDiagnostic[] = [
    ...applicationResult.diagnostics,
    ...validateBackendCapabilityDeclarationsV2(applicationResult.value)
  ]
  if (hasBackendErrors(diagnostics)) {
    return { ok: false, diagnostics: sortBackendDiagnostics(diagnostics) }
  }

  let selection: BackendProviderSelectionV2
  try {
    selection = input.selection
  } catch {
    selection = undefined as never
  }
  const resolved = registry.resolve(selection)
  if (!resolved.ok) {
    return { ok: false, diagnostics: sortBackendDiagnostics(resolved.diagnostics) }
  }

  let application: BackendProviderPlanV2['application']
  let applicationDigest: string
  let actualCapabilities: readonly BackendCapabilityV2[]
  try {
    application = freezeBackendValue(
      cloneCanonicalBackendValue(applicationResult.value, '$.applicationV2')
    ) as BackendProviderPlanV2['application']
    applicationDigest = backendSha256(canonicalBackendApplicationV2Bytes(application))
    actualCapabilities = Object.freeze([...deriveBackendApplicationCapabilitiesV2(application)])
  } catch (error) {
    return invalidApplicationV2(error)
  }

  const requirements = actualRequirementsV2(application, actualCapabilities, diagnostics)
  if (hasBackendErrors(diagnostics)) {
    return { ok: false, diagnostics: sortBackendDiagnostics(diagnostics) }
  }
  const negotiation = negotiateBackendCapabilitiesV2({
    requirements,
    bundle: resolved.value.bundle,
    target: target as CompilerTarget,
    mode
  })
  diagnostics.push(...negotiation.diagnostics)
  if (hasBackendErrors(diagnostics)) {
    return { ok: false, diagnostics: sortBackendDiagnostics(diagnostics) }
  }
  const context = createBackendProviderAdapterContextV2(
    application,
    resolved.value.selection,
    target as CompilerTarget,
    mode,
    actualCapabilities,
    negotiation.decisions
  )

  const bundleValidate = resolved.value.bundle.validate
  diagnostics.push(
    ...providerDiagnosticsV2(
      bundleValidate ? () => bundleValidate(context) : undefined,
      '$.bundle.validate',
      'backend-provider-v2-bundle-validation-failed'
    )
  )

  const activeSlots = activeBackendProviderAdapterSlotsV2(
    resolved.value.bundle,
    negotiation.decisions,
    actualCapabilities
  )
  for (const slot of activeSlots) {
    const adapter = resolved.value.bundle[slot]
    if (!adapter) {
      diagnostics.push(
        backendDiagnostic(
          'backend-provider-v2-adapter-missing',
          'error',
          `$.${slot}`,
          'Backend Provider V2 plan referenced a missing trusted adapter.'
        )
      )
      continue
    }
    const adapterValidate = adapter.validate
    diagnostics.push(
      ...providerDiagnosticsV2(
        adapterValidate ? () => adapterValidate(context) : undefined,
        `$.${slot}.validate`,
        'backend-provider-v2-adapter-validation-failed'
      )
    )
  }
  if (hasBackendErrors(diagnostics)) {
    return { ok: false, diagnostics: sortBackendDiagnostics(diagnostics) }
  }

  const adapterPlans: Partial<Record<BackendProviderAdapterSlotV2, JSONValue>> = {}
  for (const slot of activeSlots) {
    const adapter = resolved.value.bundle[slot]
    if (!adapter) {
      diagnostics.push(
        backendDiagnostic(
          'backend-provider-v2-adapter-missing',
          'error',
          `$.${slot}`,
          'Backend Provider V2 plan referenced a missing trusted adapter.'
        )
      )
      continue
    }
    try {
      const adapterPlan = cloneCanonicalBackendValue(
        adapter.plan(context),
        `$.adapterPlans.${slot}`
      )
      if (containsSecretLikePlanDataV2(adapterPlan)) {
        diagnostics.push(
          backendDiagnostic(
            'backend-provider-v2-plan-secret-material-forbidden',
            'error',
            `$.adapterPlans.${slot}`,
            'Backend Provider V2 plans cannot contain credential or secret material.'
          )
        )
        continue
      }
      adapterPlans[slot] = freezeBackendValue(adapterPlan) as JSONValue
    } catch {
      diagnostics.push(
        backendDiagnostic(
          'backend-provider-v2-plan-failed',
          'error',
          `$.adapterPlans.${slot}`,
          'Backend Provider V2 adapter failed to produce a bounded deterministic plan.'
        )
      )
    }
  }
  if (hasBackendErrors(diagnostics)) {
    return { ok: false, diagnostics: sortBackendDiagnostics(diagnostics) }
  }

  try {
    const payload = freezeBackendValue({
      version: BACKEND_PROVIDER_PLAN_VERSION_V2,
      authority: backendProviderAuthorityV2(resolved.value.selection),
      application,
      applicationDigest,
      target: target as CompilerTarget,
      mode,
      actualCapabilities,
      capabilities: negotiation.decisions,
      adapterPlans
    }) as BackendProviderPlanPayloadV2
    const plan = freezeBackendValue({
      ...payload,
      planDigest: backendProviderPlanDigestV2(payload)
    }) as BackendProviderPlanV2
    return {
      ok: true,
      plan,
      diagnostics: sortBackendDiagnostics(diagnostics)
    }
  } catch {
    return {
      ok: false,
      diagnostics: sortBackendDiagnostics([
        ...diagnostics,
        backendDiagnostic(
          'backend-provider-v2-plan-failed',
          'error',
          '$.plan',
          'Backend Provider V2 plan exceeded the canonical data boundary.'
        )
      ])
    }
  }
}
