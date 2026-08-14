import type { PenDocument } from './convert'
import {
  assertPenSourceByteLimit,
  assertPenValueQuotas,
  resolvePenParseLimits,
  type PenParseLimits,
  type ResolvedPenParseLimits
} from './limits'
import { isPlainPenRecord, type PenRecord } from './record'

interface PenValidationState {
  seenIds: Set<string>
  limits?: ResolvedPenParseLimits
  nodeCount: number
}

function requirePenRecord(value: unknown, path: string): PenRecord {
  if (!isPlainPenRecord(value)) {
    throw new TypeError(`Invalid .pen document: ${path} must be a plain object`)
  }
  return value
}

function validatePenNode(
  value: unknown,
  path: string,
  state: PenValidationState,
  includeIdentity = true,
  depth = 1
): void {
  const node = requirePenRecord(value, path)
  if (includeIdentity) {
    state.nodeCount += 1
    if (state.limits && state.nodeCount > state.limits.maxNodes) {
      throw new RangeError(
        `Untrusted .pen document exceeds the authored nodes limit (${state.limits.maxNodes})`
      )
    }
    if (state.limits && depth > state.limits.maxDepth) {
      throw new RangeError(
        `Untrusted .pen document exceeds the authored node depth limit (${state.limits.maxDepth})`
      )
    }
    if (typeof node.id !== 'string' || node.id.length === 0) {
      throw new TypeError(`Invalid .pen document: ${path}.id must be a non-empty string`)
    }
    if (node.id.includes('/')) {
      throw new TypeError(`Invalid .pen document: ${path}.id must not contain "/"`)
    }
    if (state.seenIds.has(node.id)) {
      throw new TypeError(`Invalid .pen document: duplicate node id "${node.id}"`)
    }
    state.seenIds.add(node.id)
    if (typeof node.type !== 'string' || node.type.length === 0) {
      throw new TypeError(`Invalid .pen document: ${path}.type must be a non-empty string`)
    }
  }

  if (node.children !== undefined) {
    if (!Array.isArray(node.children)) {
      throw new TypeError(`Invalid .pen document: ${path}.children must be an array`)
    }
    if (state.limits && node.children.length > state.limits.maxChildrenPerNode) {
      throw new RangeError(
        `Untrusted .pen document exceeds the children per node limit (${state.limits.maxChildrenPerNode})`
      )
    }
    node.children.forEach((child, index) =>
      validatePenNode(child, `${path}.children[${index}]`, state, true, depth + 1)
    )
  }

  if (node.descendants !== undefined) {
    const descendants = requirePenRecord(node.descendants, `${path}.descendants`)
    for (const [descendantPath, override] of Object.entries(descendants)) {
      const overridePath = `${path}.descendants[${JSON.stringify(descendantPath)}]`
      const overrideRecord = requirePenRecord(override, overridePath)
      const isReplacement = Object.hasOwn(overrideRecord, 'type')
      validatePenNode(overrideRecord, overridePath, state, isReplacement, depth + 1)
    }
  }
}

function validatePenDocument(
  value: unknown,
  limits?: ResolvedPenParseLimits
): asserts value is PenDocument {
  const document = requirePenRecord(value, 'document')
  if (typeof document.version !== 'string' || document.version.length === 0) {
    throw new TypeError('Invalid .pen document: document.version must be a non-empty string')
  }
  if (!Array.isArray(document.children)) {
    throw new TypeError('Invalid .pen document: document.children must be an array')
  }
  if (limits && document.children.length > limits.maxChildrenPerNode) {
    throw new RangeError(
      `Untrusted .pen document exceeds the document children limit (${limits.maxChildrenPerNode})`
    )
  }
  const state: PenValidationState = { seenIds: new Set(), limits, nodeCount: 0 }
  document.children.forEach((child, index) =>
    validatePenNode(child, `document.children[${index}]`, state)
  )
}

export function parsePenDocument(json: string, limits?: PenParseLimits): PenDocument {
  const resolvedLimits = limits ? resolvePenParseLimits(limits) : undefined
  if (resolvedLimits) assertPenSourceByteLimit(json, resolvedLimits)
  const value: unknown = JSON.parse(json)
  if (resolvedLimits) assertPenValueQuotas(value, resolvedLimits)
  validatePenDocument(value, resolvedLimits)
  return value
}
