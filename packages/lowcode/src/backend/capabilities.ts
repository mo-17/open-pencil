import { BACKEND_LIMITS } from './limits'
import type { BackendCapabilityRequirement, BackendDiagnostic } from './types'
import {
  array,
  boolean,
  boundedText,
  oneOf,
  record,
  uniqueBy,
  type BackendValidationContext
} from './validation-helpers'

type CapabilityRequirement<Capability extends string> = Omit<
  BackendCapabilityRequirement,
  'capability'
> & { capability: Capability }

interface ParsedCapabilities<Capability extends string> {
  rawCapabilities: unknown[] | undefined
  capabilities: CapabilityRequirement<Capability>[]
}

function requirement<Capability extends string>(
  value: unknown,
  path: string,
  context: BackendValidationContext,
  supported: readonly Capability[]
): CapabilityRequirement<Capability> | undefined {
  const source = record(
    value,
    path,
    context,
    ['capability', 'required', 'reason'],
    ['capability', 'required']
  )
  if (!source) return undefined
  const capability = oneOf(source.capability, `${path}.capability`, context, supported)
  const required = boolean(source.required, `${path}.required`, context)
  const reason =
    source.reason === undefined
      ? undefined
      : boundedText(source.reason, `${path}.reason`, context, BACKEND_LIMITS.maxReasonLength)
  return capability && required !== undefined
    ? { capability, required, ...(reason ? { reason } : {}) }
    : undefined
}

/** Versions supply their own closed supported set; no V2 capability is admitted to V1. */
export function parseCapabilityRequirements<Capability extends string>(
  value: unknown,
  context: BackendValidationContext,
  supported: readonly Capability[]
): ParsedCapabilities<Capability> {
  const rawCapabilities = array(value, '$.capabilities', context, BACKEND_LIMITS.maxCapabilities)
  const capabilities = (rawCapabilities ?? [])
    .map((entry, index) => requirement(entry, `$.capabilities[${index}]`, context, supported))
    .filter((entry): entry is CapabilityRequirement<Capability> => entry !== undefined)
  uniqueBy(
    capabilities.map((entry) => entry.capability),
    '$.capabilities',
    context,
    'capability requirement'
  )
  return { rawCapabilities, capabilities }
}

export function validateRequiredCapabilities<Capability extends string>(
  used: readonly Capability[],
  requirements: readonly CapabilityRequirement<Capability>[]
): BackendDiagnostic[] {
  const declarations = new Map(requirements.map((entry) => [entry.capability, entry]))
  return used.flatMap((capability) => {
    const declaration = declarations.get(capability)
    if (declaration?.required) return []
    const optional = declaration !== undefined
    return [
      {
        code: optional
          ? 'backend-capability-use-not-required'
          : 'backend-capability-use-undeclared',
        severity: 'error' as const,
        path: `$.capabilities.${capability}`,
        message: optional
          ? 'A capability used by Backend IR must be declared with required true.'
          : 'Backend IR uses a capability that is not declared as required.'
      }
    ]
  })
}
