import { sha256 } from '@noble/hashes/sha2'

import { BACKEND_LIMITS } from '@open-pencil/lowcode/backend'
import type { JSONValue } from '@open-pencil/scene-graph/primitives'

interface CanonicalValidationState {
  readonly seen: WeakSet<object>
  nodes: number
}

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function compareCanonicalKeys(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}

function canonicalBackendData(value: JSONValue): JSONValue {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalBackendData(entry as JSONValue))
  }
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => compareCanonicalKeys(left, right))
      .map(([key, entry]) => [key, canonicalBackendData(entry as JSONValue)])
  )
}

function encodeBackendBase64URL(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/gu, '')
}

function assertJSONArray(
  value: readonly unknown[],
  path: string,
  state: CanonicalValidationState,
  depth: number
): void {
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError(`${path} must contain plain arrays only`)
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length')
  if (!lengthDescriptor || !('value' in lengthDescriptor)) {
    throw new TypeError(`${path} must contain a plain array length`)
  }
  const length = lengthDescriptor.value
  if (!Number.isSafeInteger(length) || length < 0 || length > BACKEND_LIMITS.maxNodes) {
    throw new TypeError(`${path} exceeds the Backend JSON node limit`)
  }
  for (const key of Reflect.ownKeys(value)) {
    if (key === 'length') continue
    const index = typeof key === 'string' && /^(?:0|[1-9]\d*)$/u.test(key) ? Number(key) : -1
    if (!Number.isSafeInteger(index) || index < 0 || index >= length) {
      throw new TypeError(`${path} must not contain symbols or custom array properties`)
    }
  }
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      throw new TypeError(`${path}[${index}] must be an enumerable data property`)
    }
    assertPlainJSON(descriptor.value, `${path}[${index}]`, state, depth + 1)
  }
}

function assertJSONObject(
  value: object,
  path: string,
  state: CanonicalValidationState,
  depth: number
): void {
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${path} must contain plain objects only`)
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') throw new TypeError(`${path} must not contain symbol keys`)
    if (UNSAFE_KEYS.has(key)) throw new TypeError(`${path}.${key} is not a safe Backend JSON key`)
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      throw new TypeError(`${path}.${key} must be an enumerable data property`)
    }
    assertPlainJSON(descriptor.value, `${path}.${key}`, state, depth + 1)
  }
}

function assertPlainJSON(
  value: unknown,
  path: string,
  state: CanonicalValidationState,
  depth: number
): void {
  state.nodes += 1
  if (state.nodes > BACKEND_LIMITS.maxNodes) {
    throw new TypeError(`${path} exceeds the Backend JSON node limit`)
  }
  if (depth > BACKEND_LIMITS.maxDepth) {
    throw new TypeError(`${path} exceeds the Backend JSON depth limit`)
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${path} must contain finite JSON numbers`)
    return
  }
  if (typeof value !== 'object') throw new TypeError(`${path} must contain JSON data only`)
  if (state.seen.has(value)) throw new TypeError(`${path} must not contain cycles`)
  state.seen.add(value)
  try {
    if (Array.isArray(value)) {
      assertJSONArray(value, path, state, depth)
    } else {
      assertJSONObject(value, path, state, depth)
    }
  } finally {
    state.seen.delete(value)
  }
}

export function canonicalBackendValue(value: unknown, path: string): JSONValue {
  assertPlainJSON(value, path, { seen: new WeakSet(), nodes: 0 }, 0)
  const canonical = canonicalBackendData(value as JSONValue)
  if (
    new TextEncoder().encode(JSON.stringify(canonical)).byteLength >
    BACKEND_LIMITS.maxCanonicalBytes
  ) {
    throw new TypeError(`${path} exceeds the Backend canonical byte limit`)
  }
  return canonical
}

export function canonicalBackendBytes(value: unknown, path: string): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(canonicalBackendValue(value, path)))
}

export function backendSha256(value: string | Uint8Array): string {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value
  return encodeBackendBase64URL(sha256(bytes))
}

export function digestCanonicalBackendValue(value: unknown, path: string): string {
  return backendSha256(canonicalBackendBytes(value, path))
}

export function cloneCanonicalBackendValue<T>(value: T, path: string): T {
  const canonical = canonicalBackendValue(value, path)
  return structuredClone(canonical) as T
}

export function freezeBackendValue<T>(value: T): Readonly<T> {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (descriptor && 'value' in descriptor) freezeBackendValue(descriptor.value)
  }
  return Object.freeze(value)
}
