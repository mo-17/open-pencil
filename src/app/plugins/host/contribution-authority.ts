export interface PluginContributionDataRecord {
  [key: string]: unknown
}

interface JsonAuthorityComparisonState {
  nodes: number
  readonly ancestors: WeakSet<object>
}

export function plainDataContribution(
  value: unknown,
  path: string
): Readonly<PluginContributionDataRecord> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be a plain data object`)
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${path} must be a plain data object`)
  }
  const keys = Reflect.ownKeys(value)
  if (keys.some((key) => typeof key !== 'string')) {
    throw new Error(`${path} must not contain symbol fields`)
  }
  const normalized = Object.create(null) as PluginContributionDataRecord
  for (const key of keys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new Error(`${path}.${key} must be an enumerable data field`)
    }
    normalized[key] = descriptor.value
  }
  return Object.freeze(normalized)
}

function hasComparablePrototype(value: object, isArray: boolean): boolean {
  const prototype = Object.getPrototypeOf(value)
  return isArray
    ? prototype === Array.prototype
    : prototype === Object.prototype || prototype === null
}

function authorityKeys(actual: object, expected: object): readonly string[] | null {
  const actualKeys = Reflect.ownKeys(actual)
  const expectedKeys = Reflect.ownKeys(expected)
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.length > 1_024 ||
    actualKeys.some((key) => typeof key !== 'string' || !Object.hasOwn(expected, key))
  ) {
    return null
  }
  return actualKeys as string[]
}

function authorityChildrenMatch(
  actual: object,
  expected: object,
  keys: readonly string[],
  isArray: boolean,
  state: JsonAuthorityComparisonState
): boolean {
  for (const key of keys) {
    if (isArray && key === 'length') continue
    const descriptor = Object.getOwnPropertyDescriptor(actual, key)
    const expectedDescriptor = Object.getOwnPropertyDescriptor(expected, key)
    if (
      !descriptor?.enumerable ||
      !Object.hasOwn(descriptor, 'value') ||
      !expectedDescriptor ||
      !Object.hasOwn(expectedDescriptor, 'value') ||
      !sameJsonAuthority(descriptor.value, expectedDescriptor.value, state)
    ) {
      return false
    }
  }
  return true
}

export function sameJsonAuthority(
  actual: unknown,
  expected: unknown,
  state: JsonAuthorityComparisonState = { nodes: 0, ancestors: new WeakSet() }
): boolean {
  state.nodes += 1
  if (state.nodes > 4_096) return false
  if (actual === null || expected === null || typeof actual !== 'object') {
    return actual === expected
  }
  if (typeof expected !== 'object' || state.ancestors.has(actual)) return false
  const actualIsArray = Array.isArray(actual)
  if (actualIsArray !== Array.isArray(expected) || !hasComparablePrototype(actual, actualIsArray)) {
    return false
  }
  if (actualIsArray && (actual as unknown[]).length !== (expected as unknown[]).length) return false
  const keys = authorityKeys(actual, expected)
  if (!keys) return false
  state.ancestors.add(actual)
  try {
    return authorityChildrenMatch(actual, expected, keys, actualIsArray, state)
  } finally {
    state.ancestors.delete(actual)
  }
}
