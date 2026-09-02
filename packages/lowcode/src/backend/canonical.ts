import { canonicalManifestBytes, digestCanonicalManifest } from '@open-pencil/scene-graph'

import type { BackendApplicationSpecV1, DataModelIR } from './types'
import { parseBackendApplicationSpecV1, validateDataModelIR } from './validate'

function invalidBackendMessage(codes: readonly string[]): string {
  return `Backend contract validation failed: ${codes.join(', ')}`
}

export function canonicalBackendApplicationBytes(value: unknown): Uint8Array {
  const parsed = parseBackendApplicationSpecV1(value)
  if (!parsed.ok) {
    throw new TypeError(invalidBackendMessage(parsed.diagnostics.map((entry) => entry.code)))
  }
  return canonicalManifestBytes(parsed.value)
}

export async function digestBackendApplication(value: unknown): Promise<string> {
  const parsed = parseBackendApplicationSpecV1(value)
  if (!parsed.ok) {
    throw new TypeError(invalidBackendMessage(parsed.diagnostics.map((entry) => entry.code)))
  }
  return digestCanonicalManifest(parsed.value)
}

export function canonicalDataModelBytes(value: unknown): Uint8Array {
  const parsed = validateDataModelIR(value)
  if (!parsed.ok) {
    throw new TypeError(invalidBackendMessage(parsed.diagnostics.map((entry) => entry.code)))
  }
  return canonicalManifestBytes(parsed.value)
}

export async function digestDataModel(value: unknown): Promise<string> {
  const parsed = validateDataModelIR(value)
  if (!parsed.ok) {
    throw new TypeError(invalidBackendMessage(parsed.diagnostics.map((entry) => entry.code)))
  }
  return digestCanonicalManifest(parsed.value)
}

export function normalizedBackendApplication(value: unknown): BackendApplicationSpecV1 {
  const parsed = parseBackendApplicationSpecV1(value)
  if (!parsed.ok) {
    throw new TypeError(invalidBackendMessage(parsed.diagnostics.map((entry) => entry.code)))
  }
  return parsed.value
}

export function normalizedDataModel(value: unknown): DataModelIR {
  const parsed = validateDataModelIR(value)
  if (!parsed.ok) {
    throw new TypeError(invalidBackendMessage(parsed.diagnostics.map((entry) => entry.code)))
  }
  return parsed.value
}
