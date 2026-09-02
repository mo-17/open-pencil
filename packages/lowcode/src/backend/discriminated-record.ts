import {
  diagnostic,
  oneOf,
  record,
  type BackendUnknownRecord,
  type BackendValidationContext
} from './validation-helpers'

interface DiscriminatedRecordShape {
  readonly allowed: readonly string[]
  readonly required: readonly string[]
}

interface MutableDiscriminatedRecord {
  [key: string]: unknown
}

export interface ParsedDiscriminatedRecord<Kind extends string> {
  readonly kind: Kind
  readonly source: BackendUnknownRecord
}

/**
 * Reads a data-only discriminator before selecting an exact record shape.
 * The shallow snapshot prevents any property accessor from running during parsing.
 */
export function discriminatedRecord<const Kind extends string>(
  value: unknown,
  path: string,
  context: BackendValidationContext,
  shapes: Readonly<Record<Kind, DiscriminatedRecordShape>>
): ParsedDiscriminatedRecord<Kind> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    diagnostic(context, 'backend-object-required', path, 'Value must be an object.')
    return undefined
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    diagnostic(context, 'backend-invalid-object', path, 'Only plain objects are allowed.')
    return undefined
  }

  const snapshot = Object.create(null) as MutableDiscriminatedRecord
  let dataOnly = true
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') {
      diagnostic(
        context,
        'backend-object-property',
        path,
        'Object symbol properties are not allowed.'
      )
      dataOnly = false
      continue
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable) {
      diagnostic(
        context,
        'backend-object-property',
        path,
        'Object properties must be enumerable data properties.'
      )
      dataOnly = false
      continue
    }
    if (!Object.hasOwn(descriptor, 'value')) {
      diagnostic(context, 'backend-accessor', path, 'Accessors are not allowed.')
      dataOnly = false
      continue
    }
    snapshot[key] = descriptor.value
  }
  if (!dataOnly) return undefined
  if (!Object.hasOwn(snapshot, 'kind')) {
    diagnostic(context, 'backend-required-field', `${path}.kind`, 'Required field is missing.')
    return undefined
  }

  const kinds = Object.keys(shapes) as Kind[]
  const kind = oneOf(snapshot.kind, `${path}.kind`, context, kinds)
  if (!kind) return undefined
  const shape = shapes[kind]
  const diagnosticCount = context.diagnostics.length
  const source = record(snapshot, path, context, shape.allowed, shape.required)
  return source && context.diagnostics.length === diagnosticCount ? { kind, source } : undefined
}
