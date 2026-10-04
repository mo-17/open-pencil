/** Reject executable properties before a declarative application schema reads values. */
export function applicationDataRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  try {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== null && prototype !== Object.prototype) return undefined
    const descriptors = Object.getOwnPropertyDescriptors(value)
    const keys = Reflect.ownKeys(descriptors)
    if (
      keys.some(
        (key) =>
          typeof key !== 'string' ||
          !descriptors[key].enumerable ||
          !Object.hasOwn(descriptors[key], 'value')
      )
    )
      return undefined
    return Object.fromEntries(keys.map((key) => [key, descriptors[key as string].value]))
  } catch {
    return undefined
  }
}
