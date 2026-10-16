type DataRecord = Record<string, unknown>

/** Reflection errors remain observable for transports whose contract does not translate them. */
export function isPlainSupabaseDataRecord(value: unknown): value is DataRecord {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  )
}

export function readSupabaseDataProperty(
  value: object,
  key: PropertyKey,
  invalid: () => never
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return invalid()
  return descriptor.value
}

/** Shared data-only admission; callers retain their own error codes and validation order. */
export function createSupabaseDataAdmission<Code extends string, Context extends unknown[]>(
  fail: (code: Code, ...context: Context) => never,
  ownsFailure: (cause: unknown) => boolean = () => false
) {
  function ownKeys(value: object, code: Code, ...context: Context): readonly PropertyKey[] {
    try {
      return Reflect.ownKeys(value)
    } catch {
      return fail(code, ...context)
    }
  }

  function ownData(value: object, key: PropertyKey, code: Code, ...context: Context): unknown {
    let descriptor: PropertyDescriptor | undefined
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key)
    } catch {
      return fail(code, ...context)
    }
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value'))
      return fail(code, ...context)
    return descriptor.value
  }

  function plainRecord(value: unknown, code: Code, ...context: Context): DataRecord {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
      return fail(code, ...context)
    let prototype: object | null
    try {
      prototype = Object.getPrototypeOf(value)
    } catch {
      return fail(code, ...context)
    }
    if (prototype !== Object.prototype && prototype !== null) return fail(code, ...context)
    return value as DataRecord
  }

  function enumerableRecord(value: unknown, code: Code, ...context: Context): DataRecord {
    const record = plainRecord(value, code, ...context)
    for (const key of ownKeys(record, code, ...context)) {
      if (typeof key !== 'string') return fail(code, ...context)
      ownData(record, key, code, ...context)
    }
    return record
  }

  function exactKeys(
    value: object,
    expected: readonly string[],
    code: Code,
    ...context: Context
  ): void {
    const keys = ownKeys(value, code, ...context)
    if (
      keys.length !== expected.length ||
      keys.some((key) => typeof key !== 'string' || !expected.includes(key))
    ) {
      return fail(code, ...context)
    }
  }

  function exactRecord(
    value: unknown,
    expected: readonly string[],
    code: Code,
    ...context: Context
  ): DataRecord {
    const record = plainRecord(value, code, ...context)
    exactKeys(record, expected, code, ...context)
    for (const key of expected) ownData(record, key, code, ...context)
    return record
  }

  function recordShape(
    value: unknown,
    expected: readonly string[],
    code: Code,
    ...context: Context
  ): DataRecord {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
      return fail(code, ...context)
    let prototype: object | null
    let keys: readonly PropertyKey[]
    try {
      prototype = Object.getPrototypeOf(value)
      keys = Reflect.ownKeys(value)
    } catch {
      return fail(code, ...context)
    }
    if (
      (prototype !== Object.prototype && prototype !== null) ||
      keys.length !== expected.length ||
      keys.some((key) => typeof key !== 'string' || !expected.includes(key))
    )
      return fail(code, ...context)
    return value as DataRecord
  }

  function snapshotRecord(
    value: unknown,
    expected: readonly string[],
    code: Code,
    ...context: Context
  ): DataRecord {
    try {
      if (value === null || typeof value !== 'object' || Array.isArray(value))
        return fail(code, ...context)
      const prototype = Object.getPrototypeOf(value)
      if (prototype !== Object.prototype && prototype !== null) return fail(code, ...context)
      const descriptors = Object.getOwnPropertyDescriptors(value)
      const keys = Reflect.ownKeys(descriptors)
      if (
        keys.length !== expected.length ||
        keys.some((key) => typeof key !== 'string' || !expected.includes(key))
      )
        return fail(code, ...context)
      const snapshot = Object.create(null) as DataRecord
      for (const key of expected) {
        const descriptor = descriptors[key]
        if (descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value'))
          return fail(code, ...context)
        Object.defineProperty(snapshot, key, {
          configurable: false,
          enumerable: true,
          value: descriptor.value,
          writable: false
        })
      }
      return Object.freeze(snapshot)
    } catch (cause) {
      if (ownsFailure(cause)) throw cause
      return fail(code, ...context)
    }
  }

  function checkedArrayItem(
    value: object,
    keys: readonly PropertyKey[],
    lengthDescriptor: PropertyDescriptor | undefined,
    validPrototype: boolean,
    code: Code,
    ...context: Context
  ): unknown {
    if (
      !validPrototype ||
      keys.length !== 2 ||
      !keys.includes('0') ||
      !keys.includes('length') ||
      lengthDescriptor?.enumerable !== false ||
      !Object.hasOwn(lengthDescriptor, 'value') ||
      lengthDescriptor.value !== 1
    )
      return fail(code, ...context)
    return ownData(value, '0', code, ...context)
  }

  function singleItem(value: unknown, code: Code, ...context: Context): unknown {
    if (!Array.isArray(value) || value.length !== 1) return fail(code, ...context)
    const keys = ownKeys(value, code, ...context)
    let lengthDescriptor: PropertyDescriptor | undefined
    try {
      lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length')
    } catch {
      return fail(code, ...context)
    }
    return checkedArrayItem(value, keys, lengthDescriptor, true, code, ...context)
  }

  function canonicalSingleItem(
    value: unknown,
    code: Code,
    catchArrayCheck: boolean,
    ...context: Context
  ): unknown {
    if (!catchArrayCheck && !Array.isArray(value)) return fail(code, ...context)
    let prototype: object | null
    let descriptor: PropertyDescriptor | undefined
    try {
      if (catchArrayCheck && !Array.isArray(value)) return fail(code, ...context)
      prototype = Object.getPrototypeOf(value)
      descriptor = Object.getOwnPropertyDescriptor(value, 'length')
    } catch {
      return fail(code, ...context)
    }
    return checkedArrayItem(
      value as object,
      ownKeys(value as object, code, ...context),
      descriptor,
      prototype === Array.prototype,
      code,
      ...context
    )
  }

  return {
    ownKeys,
    ownData,
    plainRecord,
    enumerableRecord,
    exactKeys,
    exactRecord,
    recordShape,
    snapshotRecord,
    singleItem,
    canonicalSingleItem
  }
}
