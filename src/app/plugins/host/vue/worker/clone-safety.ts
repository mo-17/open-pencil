export function descriptorFunction(
  descriptor: PropertyDescriptor | undefined,
  field: 'get' | 'value'
): (...args: unknown[]) => unknown {
  const candidate = descriptor
    ? Object.getOwnPropertyDescriptor(descriptor, field)?.value
    : undefined
  if (typeof candidate !== 'function') {
    throw new TypeError('Vue source Worker intrinsic is unavailable')
  }
  return candidate as (...args: unknown[]) => unknown
}

export function intrinsicNumber(descriptor: PropertyDescriptor | undefined, value: object): number {
  const result = Reflect.apply(descriptorFunction(descriptor, 'get'), value, [])
  if (typeof result !== 'number' || !Number.isSafeInteger(result) || result < 0) {
    throw new TypeError('Vue source Worker collection is invalid')
  }
  return result
}

export function intrinsicValue(descriptor: PropertyDescriptor | undefined, value: object): unknown {
  return Reflect.apply(descriptorFunction(descriptor, 'get'), value, [])
}

export function intrinsicMethod(
  descriptor: PropertyDescriptor | undefined,
  value: object
): unknown {
  return Reflect.apply(descriptorFunction(descriptor, 'value'), value, [])
}

export function assertExactPrototype(value: object, prototype: object, label: string): void {
  if (Object.getPrototypeOf(value) !== prototype) {
    throw new TypeError(`Vue source Worker ${label} must use its built-in prototype`)
  }
}

export function ownDataDescriptors(value: object, label: string): PropertyDescriptorMap {
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError(`Vue source Worker ${label} must not contain symbol properties`)
  }
  const descriptors = Object.getOwnPropertyDescriptors(value)
  if (
    Object.values(descriptors).some(
      (descriptor) => Object.hasOwn(descriptor, 'get') || Object.hasOwn(descriptor, 'set')
    )
  ) {
    throw new TypeError(`Vue source Worker ${label} must not contain accessors`)
  }
  return descriptors
}

export function assertUnextendedCollection(value: object, label: string): void {
  if (Object.keys(ownDataDescriptors(value, label)).length > 0) {
    throw new TypeError(`Vue source Worker ${label} must not contain custom properties`)
  }
}
