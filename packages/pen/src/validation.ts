import type { PenDocument } from './convert'
import { isPlainPenRecord, type PenRecord } from './record'

function requirePenRecord(value: unknown, path: string): PenRecord {
  if (!isPlainPenRecord(value)) {
    throw new TypeError(`Invalid .pen document: ${path} must be a plain object`)
  }
  return value
}

function validatePenNode(
  value: unknown,
  path: string,
  seenIds: Set<string>,
  includeIdentity = true
): void {
  const node = requirePenRecord(value, path)
  if (includeIdentity) {
    if (typeof node.id !== 'string' || node.id.length === 0) {
      throw new TypeError(`Invalid .pen document: ${path}.id must be a non-empty string`)
    }
    if (node.id.includes('/')) {
      throw new TypeError(`Invalid .pen document: ${path}.id must not contain "/"`)
    }
    if (seenIds.has(node.id)) {
      throw new TypeError(`Invalid .pen document: duplicate node id "${node.id}"`)
    }
    seenIds.add(node.id)
    if (typeof node.type !== 'string' || node.type.length === 0) {
      throw new TypeError(`Invalid .pen document: ${path}.type must be a non-empty string`)
    }
  }

  if (node.children !== undefined) {
    if (!Array.isArray(node.children)) {
      throw new TypeError(`Invalid .pen document: ${path}.children must be an array`)
    }
    node.children.forEach((child, index) =>
      validatePenNode(child, `${path}.children[${index}]`, seenIds)
    )
  }

  if (node.descendants !== undefined) {
    const descendants = requirePenRecord(node.descendants, `${path}.descendants`)
    for (const [descendantPath, override] of Object.entries(descendants)) {
      const overridePath = `${path}.descendants[${JSON.stringify(descendantPath)}]`
      const overrideRecord = requirePenRecord(override, overridePath)
      const isReplacement = Object.hasOwn(overrideRecord, 'type')
      validatePenNode(overrideRecord, overridePath, seenIds, isReplacement)
    }
  }
}

function validatePenDocument(value: unknown): asserts value is PenDocument {
  const document = requirePenRecord(value, 'document')
  if (typeof document.version !== 'string' || document.version.length === 0) {
    throw new TypeError('Invalid .pen document: document.version must be a non-empty string')
  }
  if (!Array.isArray(document.children)) {
    throw new TypeError('Invalid .pen document: document.children must be an array')
  }
  const seenIds = new Set<string>()
  document.children.forEach((child, index) =>
    validatePenNode(child, `document.children[${index}]`, seenIds)
  )
}

export function parsePenDocument(json: string): PenDocument {
  const value: unknown = JSON.parse(json)
  validatePenDocument(value)
  return value
}
