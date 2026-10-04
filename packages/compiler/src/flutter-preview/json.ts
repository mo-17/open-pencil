import { previewBinaryLength } from './binary'
import { FLUTTER_PREVIEW_SNAPSHOT_LIMITS as LIMITS, invalidFlutterPreviewSnapshot } from './limits'

const encoder = new TextEncoder()
const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor'])

interface JSONBudget {
  bytes: number
  values: number
  capture: boolean
  ancestors: WeakSet<object>
}
interface FlutterPreviewJSONRecord {
  [key: string]: unknown
}

function addBytes(budget: JSONBudget, amount: number): void {
  budget.bytes += amount
  if (budget.bytes > LIMITS.maxSnapshotBytes) invalidFlutterPreviewSnapshot()
}

function stringValue(value: string, path: readonly string[], budget: JSONBudget): string {
  const image = path.length === 4 && path[0] === 'graph' && path[1] === 'images' && path[3] === '1'
  const maximum = image ? Math.ceil(LIMITS.maxImageBytes / 3) * 4 : LIMITS.maxStringBytes
  if (value.length > maximum || encoder.encode(value).byteLength > maximum)
    return invalidFlutterPreviewSnapshot()
  addBytes(budget, encoder.encode(JSON.stringify(value)).byteLength)
  return value
}

function arrayValue(value: unknown[], path: readonly string[], budget: JSONBudget): unknown[] {
  if (Object.getPrototypeOf(value) !== Array.prototype) return invalidFlutterPreviewSnapshot()
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value as unknown
  if (!Number.isSafeInteger(length) || typeof length !== 'number' || length > LIMITS.maxArrayLength)
    return invalidFlutterPreviewSnapshot()
  const keys = Reflect.ownKeys(value)
  if (keys.length !== length + 1) return invalidFlutterPreviewSnapshot()
  addBytes(budget, 2 + Math.max(0, length - 1))
  const result: unknown[] = []
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value'))
      return invalidFlutterPreviewSnapshot()
    result.push(cloneValue(descriptor.value, [...path, String(index)], budget))
  }
  return result
}

function recordValue(value: object, path: readonly string[], budget: JSONBudget): object {
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return invalidFlutterPreviewSnapshot()
  const keys = Reflect.ownKeys(value)
  if (keys.length > LIMITS.maxRecordKeys) return invalidFlutterPreviewSnapshot()
  const result = Object.create(null) as FlutterPreviewJSONRecord
  addBytes(budget, 2)
  let count = 0
  for (const key of keys) {
    if (typeof key !== 'string' || forbiddenKeys.has(key)) return invalidFlutterPreviewSnapshot()
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value'))
      return invalidFlutterPreviewSnapshot()
    if (descriptor.value === undefined && budget.capture) continue
    stringValue(key, [], budget)
    addBytes(budget, 1 + (count++ > 0 ? 1 : 0))
    result[key] = cloneValue(descriptor.value, [...path, key], budget)
  }
  return result
}

function cloneObject(value: object, path: readonly string[], budget: JSONBudget): unknown {
  if (budget.ancestors.has(value)) return invalidFlutterPreviewSnapshot()
  if (value instanceof Uint8Array && budget.capture) {
    if (previewBinaryLength(value) > LIMITS.maxBinaryBytes) return invalidFlutterPreviewSnapshot()
    return cloneValue(
      Array.from(Uint8Array.prototype.slice.call(value) as Uint8Array),
      path,
      budget
    )
  }
  budget.ancestors.add(value)
  const result = Array.isArray(value)
    ? arrayValue(value, path, budget)
    : recordValue(value, path, budget)
  budget.ancestors.delete(value)
  return result
}

function cloneValue(value: unknown, path: readonly string[], budget: JSONBudget): unknown {
  if (path.length > LIMITS.maxDepth || ++budget.values > LIMITS.maxValues)
    return invalidFlutterPreviewSnapshot()
  if (value === null || typeof value === 'boolean') {
    addBytes(budget, value === false ? 5 : 4)
    return value
  }
  if (typeof value === 'string') return stringValue(value, path, budget)
  if (typeof value === 'number' && Number.isFinite(value)) {
    addBytes(budget, String(value).length)
    return value
  }
  if (typeof value === 'object') return cloneObject(value, path, budget)
  return invalidFlutterPreviewSnapshot()
}

/** Checks descriptors before reading values or allowing Valibot to access properties. */
export function cloneFlutterPreviewJSON(input: unknown, capture = false): unknown {
  return cloneValue(input, [], { bytes: 0, values: 0, capture, ancestors: new WeakSet() })
}
