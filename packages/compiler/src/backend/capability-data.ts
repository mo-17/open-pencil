import type { CompilerTarget } from '#compiler/types'

import type { BackendDiagnostic } from '@open-pencil/lowcode/backend'

import { hasBackendErrors, sortBackendDiagnostics } from './diagnostics'

export function orderedCapabilityRequirements<T extends { readonly capability: string }>(
  requirements: readonly T[]
): T[] {
  return [...requirements].sort((left, right) =>
    left.capability.localeCompare(right.capability, 'en')
  )
}

export function recordCapabilityDecision<C extends string, S extends string, R extends string>(
  decisions: {
    readonly capability: C
    readonly required: boolean
    readonly providerSupported: boolean
    readonly targetStatus: S
    readonly resolution: R
    readonly included: boolean
  }[],
  diagnostics: BackendDiagnostic[],
  capability: C,
  required: boolean,
  providerSupported: boolean,
  targetStatus: S,
  resolution: {
    readonly resolution: R
    readonly included: boolean
    readonly diagnostics: readonly BackendDiagnostic[]
  }
): void {
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

export function negotiateProviderCapabilities<Requirements, Bundle, Mode, Decisions>(
  negotiate: (input: {
    requirements: Requirements
    bundle: Bundle
    target: CompilerTarget
    mode: Mode
  }) => { readonly decisions: Decisions; readonly diagnostics: readonly BackendDiagnostic[] },
  requirements: Requirements,
  bundle: Bundle,
  target: CompilerTarget,
  mode: Mode,
  diagnostics: BackendDiagnostic[]
):
  | Readonly<{ ok: true; decisions: Decisions }>
  | Readonly<{ ok: false; diagnostics: readonly BackendDiagnostic[] }> {
  const negotiation = negotiate({ requirements, bundle, target, mode })
  diagnostics.push(...negotiation.diagnostics)
  if (hasBackendErrors(diagnostics))
    return { ok: false, diagnostics: sortBackendDiagnostics(diagnostics) }
  return { ok: true, decisions: negotiation.decisions }
}
