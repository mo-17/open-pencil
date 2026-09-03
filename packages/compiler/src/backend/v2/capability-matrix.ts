import type { CompilerTarget } from '#compiler/types'

import {
  BACKEND_CAPABILITIES_V2,
  type BackendCapabilityRequirementV2,
  type BackendCapabilityV2,
  type BackendDiagnostic
} from '@open-pencil/lowcode/backend'

import { backendDiagnostic, unsupportedBackendCompilationModeDiagnostic } from '../diagnostics'
import {
  isBackendCompilationModeV2,
  type BackendCapabilityDecisionV2,
  type BackendCompilationModeV2,
  type BackendProviderBundleV2,
  type BackendTargetCapabilityStatusV2,
  type TargetCapabilityMatrixV2
} from './contracts'

const ALL_TARGETS_V2: readonly CompilerTarget[] = Object.freeze([
  'react',
  'vue',
  'expo',
  'flutter',
  'wechat-miniprogram',
  'taro',
  'uni-app',
  'mpx'
])

function capabilityRowV2(
  overrides: Partial<Record<BackendCapabilityV2, BackendTargetCapabilityStatusV2>>
): Readonly<Record<BackendCapabilityV2, BackendTargetCapabilityStatusV2>> {
  return Object.freeze(
    Object.fromEntries(
      BACKEND_CAPABILITIES_V2.map((capability) => [
        capability,
        overrides[capability] ?? 'unsupported'
      ])
    ) as Record<BackendCapabilityV2, BackendTargetCapabilityStatusV2>
  )
}

const WEB_CAPABILITIES_V2 = capabilityRowV2({
  'data.read': 'supported',
  'data.write': 'supported',
  'auth.identity': 'supported',
  'auth.roles': 'supported',
  'policy.row-level': 'supported',
  'server.functions': 'requires-server-bridge',
  'server.http': 'requires-server-bridge',
  'storage.objects': 'supported',
  'migrations.schema': 'supported',
  'migrations.data': 'supported',
  'migrations.backfill': 'supported',
  'realtime.subscribe': 'supported',
  'events.data-change': 'supported',
  'transactions.atomic': 'requires-server-bridge',
  'jobs.schedule': 'requires-server-bridge',
  'queues.publish': 'requires-server-bridge',
  'queues.consume': 'requires-server-bridge',
  'webhooks.receive': 'requires-server-bridge',
  'webhooks.deliver': 'requires-server-bridge',
  'workflows.idempotency': 'requires-server-bridge',
  'workflows.retry': 'requires-server-bridge',
  'workflows.durable-execution': 'requires-server-bridge',
  'observability.logs': 'requires-server-bridge',
  'observability.metrics': 'requires-server-bridge',
  'observability.traces': 'requires-server-bridge',
  'audit.events': 'requires-server-bridge',
  'drift.detect': 'requires-server-bridge'
})

const NATIVE_SOURCE_CAPABILITIES_V2 = capabilityRowV2({
  'data.read': 'source-only',
  'data.write': 'source-only',
  'auth.identity': 'source-only',
  'auth.roles': 'source-only',
  'policy.row-level': 'source-only',
  'server.functions': 'requires-server-bridge',
  'server.http': 'requires-server-bridge',
  'storage.objects': 'source-only',
  'migrations.schema': 'source-only',
  'migrations.data': 'source-only',
  'migrations.backfill': 'source-only',
  'realtime.subscribe': 'source-only',
  'events.data-change': 'source-only',
  'transactions.atomic': 'requires-server-bridge',
  'jobs.schedule': 'requires-server-bridge',
  'queues.publish': 'requires-server-bridge',
  'queues.consume': 'requires-server-bridge',
  'webhooks.receive': 'requires-server-bridge',
  'webhooks.deliver': 'requires-server-bridge',
  'workflows.idempotency': 'requires-server-bridge',
  'workflows.retry': 'requires-server-bridge',
  'workflows.durable-execution': 'requires-server-bridge',
  'observability.logs': 'requires-server-bridge',
  'observability.metrics': 'requires-server-bridge',
  'observability.traces': 'requires-server-bridge',
  'audit.events': 'requires-server-bridge',
  'drift.detect': 'requires-server-bridge'
})

const MINI_PROGRAM_SOURCE_CAPABILITIES_V2 = capabilityRowV2({
  'data.read': 'source-only',
  'data.write': 'source-only',
  'auth.identity': 'source-only',
  'storage.objects': 'source-only'
})

export const DEFAULT_TARGET_CAPABILITY_MATRIX_V2: TargetCapabilityMatrixV2 = Object.freeze({
  react: WEB_CAPABILITIES_V2,
  vue: WEB_CAPABILITIES_V2,
  expo: NATIVE_SOURCE_CAPABILITIES_V2,
  flutter: NATIVE_SOURCE_CAPABILITIES_V2,
  'wechat-miniprogram': MINI_PROGRAM_SOURCE_CAPABILITIES_V2,
  taro: MINI_PROGRAM_SOURCE_CAPABILITIES_V2,
  'uni-app': MINI_PROGRAM_SOURCE_CAPABILITIES_V2,
  mpx: MINI_PROGRAM_SOURCE_CAPABILITIES_V2
})

export interface BackendCapabilityNegotiationInputV2 {
  readonly requirements: readonly BackendCapabilityRequirementV2[]
  readonly bundle: BackendProviderBundleV2
  readonly target: CompilerTarget
  readonly mode: BackendCompilationModeV2
}

export interface BackendCapabilityNegotiationResultV2 {
  readonly decisions: readonly BackendCapabilityDecisionV2[]
  readonly diagnostics: readonly BackendDiagnostic[]
}

function diagnosticV2(
  capability: BackendCapabilityV2,
  severity: BackendDiagnostic['severity'],
  code: string,
  message: string
): BackendDiagnostic {
  return backendDiagnostic(code, severity, `$.capabilities.${capability}`, message)
}

interface CapabilityResolutionV2 {
  readonly resolution: BackendTargetCapabilityStatusV2
  readonly included: boolean
  readonly diagnostics: readonly BackendDiagnostic[]
}

function missingProviderCapabilityV2(
  requirement: BackendCapabilityRequirementV2
): CapabilityResolutionV2 {
  const { capability, required } = requirement
  return {
    resolution: 'unsupported',
    included: false,
    diagnostics: [
      diagnosticV2(
        capability,
        required ? 'error' : 'warning',
        required
          ? 'backend-provider-v2-capability-required'
          : 'backend-provider-v2-capability-optional-omitted',
        required
          ? 'Selected Backend Provider V2 does not implement a required capability.'
          : 'Selected Backend Provider V2 does not implement this optional capability; it was omitted.'
      )
    ]
  }
}

function sourceOnlyCapabilityV2(
  requirement: BackendCapabilityRequirementV2,
  mode: BackendCompilationModeV2
): CapabilityResolutionV2 {
  const { capability, required } = requirement
  const prototype = mode === 'source-only-prototype'
  const severity = prototype || !required ? 'warning' : 'error'
  let code = 'backend-v2-capability-source-only-optional-omitted'
  let message = 'Optional source-only V2 capability was omitted.'
  if (prototype) {
    code = 'backend-v2-capability-source-only-omitted'
    message = 'V2 capability is source-only for this target and was omitted from executable output.'
  } else if (required) {
    code = 'backend-v2-capability-source-only-mode-required'
    message = 'V2 capability requires an explicit source-only prototype export for this target.'
  }
  return {
    resolution: 'source-only',
    included: false,
    diagnostics: [diagnosticV2(capability, severity, code, message)]
  }
}

function serverBridgeCapabilityV2(
  requirement: BackendCapabilityRequirementV2,
  mode: BackendCompilationModeV2,
  serverCapabilities: ReadonlySet<BackendCapabilityV2>
): CapabilityResolutionV2 {
  const { capability, required } = requirement
  if (mode === 'production' && serverCapabilities.has(capability)) {
    return { resolution: 'supported', included: true, diagnostics: [] }
  }
  if (mode === 'source-only-prototype') {
    return {
      resolution: 'requires-server-bridge',
      included: false,
      diagnostics: [
        diagnosticV2(
          capability,
          'warning',
          'backend-v2-capability-server-bridge-omitted',
          'V2 server-bridge capability was omitted from the source-only prototype.'
        )
      ]
    }
  }
  return {
    resolution: 'requires-server-bridge',
    included: false,
    diagnostics: [
      diagnosticV2(
        capability,
        required ? 'error' : 'warning',
        mode === 'preview'
          ? 'backend-v2-preview-server-capability-unavailable'
          : 'backend-v2-capability-server-bridge-required',
        mode === 'preview'
          ? 'Browser preview cannot execute this V2 server capability.'
          : 'Selected Backend Provider V2 does not supply the required server bridge.'
      )
    ]
  }
}

function unsupportedTargetCapabilityV2(
  requirement: BackendCapabilityRequirementV2
): CapabilityResolutionV2 {
  const { capability, required } = requirement
  return {
    resolution: 'unsupported',
    included: false,
    diagnostics: [
      diagnosticV2(
        capability,
        required ? 'error' : 'warning',
        required
          ? 'backend-v2-target-capability-unsupported'
          : 'backend-v2-target-capability-optional-omitted',
        required
          ? 'Compiler target does not support a required Backend V2 capability.'
          : 'Compiler target does not support this optional Backend V2 capability; it was omitted.'
      )
    ]
  }
}

function resolveCapabilityV2(
  requirement: BackendCapabilityRequirementV2,
  providerSupported: boolean,
  targetStatus: BackendTargetCapabilityStatusV2,
  mode: BackendCompilationModeV2,
  serverCapabilities: ReadonlySet<BackendCapabilityV2>
): CapabilityResolutionV2 {
  if (!providerSupported) return missingProviderCapabilityV2(requirement)
  if (targetStatus === 'supported') {
    return { resolution: 'supported', included: true, diagnostics: [] }
  }
  if (targetStatus === 'source-only') return sourceOnlyCapabilityV2(requirement, mode)
  if (targetStatus === 'requires-server-bridge') {
    return serverBridgeCapabilityV2(requirement, mode, serverCapabilities)
  }
  return unsupportedTargetCapabilityV2(requirement)
}

export function negotiateBackendCapabilitiesV2(
  input: BackendCapabilityNegotiationInputV2
): BackendCapabilityNegotiationResultV2 {
  let mode: unknown
  try {
    mode = input.mode
  } catch {
    mode = undefined
  }
  if (!isBackendCompilationModeV2(mode)) {
    return {
      decisions: Object.freeze([]),
      diagnostics: Object.freeze([unsupportedBackendCompilationModeDiagnostic()])
    }
  }
  let target: unknown
  try {
    target = input.target
  } catch {
    target = undefined
  }
  if (!ALL_TARGETS_V2.includes(target as CompilerTarget)) {
    return {
      decisions: Object.freeze([]),
      diagnostics: Object.freeze([
        backendDiagnostic(
          'backend-v2-target-unsupported',
          'error',
          '$.target',
          'Compiler target has no Backend V2 capability policy.'
        )
      ])
    }
  }

  const decisions: BackendCapabilityDecisionV2[] = []
  const diagnostics: BackendDiagnostic[] = []
  const seen = new Set<BackendCapabilityV2>()
  const providerCapabilities = new Set(input.bundle.descriptor.capabilities)
  const serverCapabilities = new Set(input.bundle.server?.capabilities)
  const requirements = [...input.requirements].sort((left, right) =>
    left.capability.localeCompare(right.capability, 'en')
  )

  for (const requirement of requirements) {
    const { capability, required } = requirement
    if (seen.has(capability)) {
      diagnostics.push(
        diagnosticV2(
          capability,
          'error',
          'backend-v2-capability-requirement-duplicate',
          'Backend V2 capability requirements must be unique.'
        )
      )
      continue
    }
    seen.add(capability)
    const providerSupported = providerCapabilities.has(capability)
    const targetStatus = DEFAULT_TARGET_CAPABILITY_MATRIX_V2[target as CompilerTarget][capability]
    const resolution = resolveCapabilityV2(
      requirement,
      providerSupported,
      targetStatus,
      mode,
      serverCapabilities
    )
    diagnostics.push(...resolution.diagnostics)
    decisions.push(
      Object.freeze({
        capability,
        required,
        providerSupported,
        targetStatus,
        resolution: resolution.resolution,
        included: resolution.included
      })
    )
  }

  return {
    decisions: Object.freeze(decisions),
    diagnostics: Object.freeze(diagnostics)
  }
}
