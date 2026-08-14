export interface KiwiRuntimeLimits {
  maxArrayItems?: number
  maxSchemaDefinitions?: number
  maxFieldsPerDefinition?: number
  maxSchemaFields?: number
  maxDecodeDepth?: number
}

/** Recommended limits for untrusted/dynamic Kiwi input. They are never applied implicitly. */
export const KIWI_RUNTIME_LIMITS: Readonly<Required<KiwiRuntimeLimits>> = Object.freeze({
  /** Maximum total decoded items across all non-byte arrays in one message buffer. */
  maxArrayItems: 1_000_000,
  /** Maximum number of definitions accepted from a dynamic Kiwi schema. */
  maxSchemaDefinitions: 4_096,
  /** Maximum fields accepted on any one schema definition. */
  maxFieldsPerDefinition: 4_096,
  /** Maximum fields accepted across an entire dynamic schema. */
  maxSchemaFields: 65_536,
  /** Maximum nested STRUCT/MESSAGE decoder calls for one message buffer. */
  maxDecodeDepth: 64
})

function checkedOptionalLimit(value: number | undefined, label: string): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${label} must be a positive safe integer`)
  }
  return value
}

export function normalizeKiwiRuntimeLimits(
  limits: KiwiRuntimeLimits | undefined
): Readonly<KiwiRuntimeLimits> | undefined {
  if (limits === undefined) return undefined
  return Object.freeze({
    maxArrayItems: checkedOptionalLimit(limits.maxArrayItems, 'maxArrayItems'),
    maxSchemaDefinitions: checkedOptionalLimit(limits.maxSchemaDefinitions, 'maxSchemaDefinitions'),
    maxFieldsPerDefinition: checkedOptionalLimit(
      limits.maxFieldsPerDefinition,
      'maxFieldsPerDefinition'
    ),
    maxSchemaFields: checkedOptionalLimit(limits.maxSchemaFields, 'maxSchemaFields'),
    maxDecodeDepth: checkedOptionalLimit(limits.maxDecodeDepth, 'maxDecodeDepth')
  })
}
