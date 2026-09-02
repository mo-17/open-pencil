import { BACKEND_CAPABILITIES } from '@open-pencil/lowcode/backend'
import type {
  BackendCapability,
  BackendCapabilityRequirement,
  BackendDiagnostic
} from '@open-pencil/lowcode/backend'

import type { CompilerTarget } from '../types'
import {
  isBackendCompilationMode,
  type BackendCompilationMode,
  type BackendCapabilityDecision,
  type BackendProviderBundle,
  type BackendTargetCapabilityStatus,
  type TargetCapabilityMatrix
} from './contracts'
import { unsupportedBackendCompilationModeDiagnostic } from './diagnostics'

const ALL_TARGETS: readonly CompilerTarget[] = Object.freeze([
  'react',
  'vue',
  'expo',
  'flutter',
  'wechat-miniprogram',
  'taro',
  'uni-app',
  'mpx'
])

function capabilityRow(
  overrides: Partial<Record<BackendCapability, BackendTargetCapabilityStatus>>
): Readonly<Record<BackendCapability, BackendTargetCapabilityStatus>> {
  return Object.freeze(
    Object.fromEntries(
      BACKEND_CAPABILITIES.map((capability) => [capability, overrides[capability] ?? 'unsupported'])
    ) as Record<BackendCapability, BackendTargetCapabilityStatus>
  )
}

const WEB_CAPABILITIES = capabilityRow({
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
  'realtime.subscribe': 'supported',
  'transactions.atomic': 'requires-server-bridge'
})

/**
 * Vue v1 emits Backend review artifacts, but its generated client deliberately
 * omits Supabase/auth/server/storage runtimes. Explicit prototype exports may
 * retain a static shell with warnings; production must fail closed.
 */
const VUE_CAPABILITIES = capabilityRow({
  'data.read': 'source-only',
  'data.write': 'source-only',
  'auth.identity': 'source-only',
  'auth.roles': 'source-only',
  'policy.row-level': 'supported',
  'server.functions': 'source-only',
  'server.http': 'source-only',
  'storage.objects': 'source-only',
  'migrations.schema': 'supported',
  'migrations.data': 'supported',
  'realtime.subscribe': 'source-only',
  'transactions.atomic': 'source-only'
})

const NATIVE_SOURCE_CAPABILITIES = capabilityRow({
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
  'realtime.subscribe': 'source-only',
  'transactions.atomic': 'requires-server-bridge'
})

const MINI_PROGRAM_SOURCE_CAPABILITIES = capabilityRow({
  'data.read': 'source-only',
  'data.write': 'source-only',
  'auth.identity': 'source-only',
  'storage.objects': 'source-only'
})

export const DEFAULT_TARGET_CAPABILITY_MATRIX: TargetCapabilityMatrix = Object.freeze({
  react: WEB_CAPABILITIES,
  vue: VUE_CAPABILITIES,
  expo: NATIVE_SOURCE_CAPABILITIES,
  flutter: NATIVE_SOURCE_CAPABILITIES,
  'wechat-miniprogram': MINI_PROGRAM_SOURCE_CAPABILITIES,
  taro: MINI_PROGRAM_SOURCE_CAPABILITIES,
  'uni-app': MINI_PROGRAM_SOURCE_CAPABILITIES,
  mpx: MINI_PROGRAM_SOURCE_CAPABILITIES
})

export interface BackendCapabilityNegotiationInput {
  readonly requirements: readonly BackendCapabilityRequirement[]
  readonly bundle: BackendProviderBundle
  readonly target: CompilerTarget
  readonly mode: BackendCompilationMode
}

export interface BackendCapabilityNegotiationResult {
  readonly decisions: readonly BackendCapabilityDecision[]
  readonly diagnostics: readonly BackendDiagnostic[]
}

function diagnostic(
  capability: BackendCapability,
  severity: BackendDiagnostic['severity'],
  code: string,
  message: string
): BackendDiagnostic {
  return {
    code,
    severity,
    path: `$.capabilities.${capability}`,
    message
  }
}

interface CapabilityResolution {
  readonly resolution: BackendTargetCapabilityStatus
  readonly included: boolean
  readonly diagnostics: readonly BackendDiagnostic[]
}

function missingProviderCapability(
  requirement: BackendCapabilityRequirement
): CapabilityResolution {
  const { capability, required } = requirement
  return {
    resolution: 'unsupported',
    included: false,
    diagnostics: [
      diagnostic(
        capability,
        required ? 'error' : 'warning',
        required
          ? 'backend-provider-capability-required'
          : 'backend-provider-capability-optional-omitted',
        required
          ? 'Selected Backend Provider does not implement a required capability.'
          : 'Selected Backend Provider does not implement this optional capability; it was omitted.'
      )
    ]
  }
}

function sourceOnlyCapability(
  requirement: BackendCapabilityRequirement,
  mode: BackendCompilationMode
): CapabilityResolution {
  const { capability, required } = requirement
  const prototype = mode === 'source-only-prototype'
  const severity = prototype || !required ? 'warning' : 'error'
  let code = 'backend-capability-source-only-optional-omitted'
  let message = 'Optional source-only capability was omitted.'
  if (prototype) {
    code = 'backend-capability-source-only-omitted'
    message = 'Capability is source-only for this target and was omitted from the executable plan.'
  } else if (required) {
    code = 'backend-capability-source-only-mode-required'
    message = 'Capability requires an explicit source-only prototype export for this target.'
  }
  return {
    resolution: 'source-only',
    included: false,
    diagnostics: [diagnostic(capability, severity, code, message)]
  }
}

function serverBridgeCapability(
  requirement: BackendCapabilityRequirement,
  mode: BackendCompilationMode,
  serverCapabilities: ReadonlySet<BackendCapability>
): CapabilityResolution {
  const { capability, required } = requirement
  if (mode === 'production' && serverCapabilities.has(capability)) {
    return { resolution: 'supported', included: true, diagnostics: [] }
  }
  if (mode === 'source-only-prototype') {
    return {
      resolution: 'requires-server-bridge',
      included: false,
      diagnostics: [
        diagnostic(
          capability,
          'warning',
          'backend-capability-server-bridge-omitted',
          'Server-bridge capability was omitted from the source-only prototype.'
        )
      ]
    }
  }
  return {
    resolution: 'requires-server-bridge',
    included: false,
    diagnostics: [
      diagnostic(
        capability,
        required ? 'error' : 'warning',
        mode === 'preview'
          ? 'backend-preview-server-capability-unavailable'
          : 'backend-capability-server-bridge-required',
        mode === 'preview'
          ? 'Browser preview cannot execute this server capability.'
          : 'Selected Backend Provider does not supply the required server bridge.'
      )
    ]
  }
}

function unsupportedTargetCapability(
  requirement: BackendCapabilityRequirement
): CapabilityResolution {
  const { capability, required } = requirement
  return {
    resolution: 'unsupported',
    included: false,
    diagnostics: [
      diagnostic(
        capability,
        required ? 'error' : 'warning',
        required
          ? 'backend-target-capability-unsupported'
          : 'backend-target-capability-optional-omitted',
        required
          ? 'Compiler target does not support a required Backend capability.'
          : 'Compiler target does not support this optional Backend capability; it was omitted.'
      )
    ]
  }
}

function resolveCapability(
  requirement: BackendCapabilityRequirement,
  providerSupported: boolean,
  targetStatus: BackendTargetCapabilityStatus,
  mode: BackendCompilationMode,
  serverCapabilities: ReadonlySet<BackendCapability>
): CapabilityResolution {
  if (!providerSupported) return missingProviderCapability(requirement)
  if (targetStatus === 'supported') {
    return { resolution: 'supported', included: true, diagnostics: [] }
  }
  if (targetStatus === 'source-only') return sourceOnlyCapability(requirement, mode)
  if (targetStatus === 'requires-server-bridge') {
    return serverBridgeCapability(requirement, mode, serverCapabilities)
  }
  return unsupportedTargetCapability(requirement)
}

export function negotiateBackendCapabilities(
  input: BackendCapabilityNegotiationInput
): BackendCapabilityNegotiationResult {
  let mode: unknown
  try {
    mode = input.mode
  } catch {
    mode = undefined
  }
  if (!isBackendCompilationMode(mode)) {
    return {
      decisions: [],
      diagnostics: [unsupportedBackendCompilationModeDiagnostic()]
    }
  }
  let target: unknown
  try {
    target = input.target
  } catch {
    target = undefined
  }
  if (!ALL_TARGETS.includes(target as CompilerTarget)) {
    return {
      decisions: [],
      diagnostics: [
        {
          code: 'backend-target-unsupported',
          severity: 'error',
          path: '$.target',
          message: 'Compiler target has no Backend capability policy.'
        }
      ]
    }
  }

  const decisions: BackendCapabilityDecision[] = []
  const diagnostics: BackendDiagnostic[] = []
  const seen = new Set<BackendCapability>()
  const providerCapabilities = new Set(input.bundle.descriptor.capabilities)
  const serverCapabilities = new Set(input.bundle.server?.capabilities)
  const requirements = [...input.requirements].sort((left, right) =>
    left.capability.localeCompare(right.capability, 'en')
  )

  for (const requirement of requirements) {
    const { capability, required } = requirement
    if (seen.has(capability)) {
      diagnostics.push(
        diagnostic(
          capability,
          'error',
          'backend-capability-requirement-duplicate',
          'Backend capability requirements must be unique.'
        )
      )
      continue
    }
    seen.add(capability)
    const providerSupported = providerCapabilities.has(capability)
    const targetStatus = DEFAULT_TARGET_CAPABILITY_MATRIX[target as CompilerTarget][capability]
    const resolution = resolveCapability(
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
