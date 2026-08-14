export interface PenParseLimits {
  /** Maximum UTF-8 source bytes before JSON parsing. */
  maxBytes?: number
  /** Maximum authored nodes, including replacement descendants. */
  maxNodes?: number
  /** Maximum nodes after component instances have cloned their source subtrees. */
  maxExpandedNodes?: number
  /** Maximum parent/child depth after component instances expand. */
  maxExpandedDepth?: number
  /** Maximum authored node nesting depth. */
  maxDepth?: number
  /** Maximum direct children on the document or one node. */
  maxChildrenPerNode?: number
  /** Maximum UTF-8 bytes in one JSON string, including property names. */
  maxStringBytes?: number
  /** Maximum combined UTF-8 bytes across JSON strings and property names. */
  maxTotalStringBytes?: number
  /** Maximum nesting depth of any JSON array or object. */
  maxValueDepth?: number
  /** Maximum number of items in any JSON array. */
  maxArrayItems?: number
  /** Maximum own properties in any JSON object. */
  maxObjectProperties?: number
  /** Maximum total JSON values visited after parsing. */
  maxTotalValues?: number
}

export type ResolvedPenParseLimits = Readonly<Required<PenParseLimits>>

/** Fail-closed quotas for remote or otherwise untrusted `.pen` documents. */
export const REMOTE_PEN_PARSE_LIMITS: ResolvedPenParseLimits = Object.freeze({
  maxBytes: 16 * 1024 * 1024,
  maxNodes: 20_000,
  maxExpandedNodes: 50_000,
  maxExpandedDepth: 256,
  maxDepth: 64,
  maxChildrenPerNode: 2_048,
  maxStringBytes: 1024 * 1024,
  maxTotalStringBytes: 8 * 1024 * 1024,
  maxValueDepth: 128,
  maxArrayItems: 65_536,
  maxObjectProperties: 4_096,
  maxTotalValues: 500_000
})

const PEN_PARSE_LIMIT_KEYS = new Set<keyof PenParseLimits>([
  'maxBytes',
  'maxNodes',
  'maxExpandedNodes',
  'maxExpandedDepth',
  'maxDepth',
  'maxChildrenPerNode',
  'maxStringBytes',
  'maxTotalStringBytes',
  'maxValueDepth',
  'maxArrayItems',
  'maxObjectProperties',
  'maxTotalValues'
])

export function resolvePenParseLimits(
  limits: PenParseLimits = REMOTE_PEN_PARSE_LIMITS
): ResolvedPenParseLimits {
  if (!isPlainObject(limits)) throw new TypeError('.pen parse limits must be a plain object')
  for (const key of Object.keys(limits)) {
    if (!PEN_PARSE_LIMIT_KEYS.has(key as keyof PenParseLimits)) {
      throw new TypeError(`Unknown .pen parse limit: ${key}`)
    }
  }

  const resolved = {
    ...REMOTE_PEN_PARSE_LIMITS,
    ...limits
  }
  for (const [key, value] of Object.entries(resolved)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new RangeError(`.pen parse limit ${key} must be a positive safe integer`)
    }
  }
  return Object.freeze(resolved)
}

export function assertPenSourceByteLimit(source: string, limits: ResolvedPenParseLimits): void {
  if (utf8ByteLengthExceeds(source, limits.maxBytes)) {
    throw quotaError('source bytes', limits.maxBytes)
  }
}

export function assertPenByteLength(byteLength: number, limits: ResolvedPenParseLimits): void {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
    throw new RangeError('.pen byte length must be a non-negative safe integer')
  }
  if (byteLength > limits.maxBytes) throw quotaError('source bytes', limits.maxBytes)
}

export function assertPenValueQuotas(value: unknown, limits: ResolvedPenParseLimits): void {
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }]
  let totalValues = 0
  let totalStringBytes = 0

  const accountString = (text: string): void => {
    const bytes = utf8ByteLength(text, limits.maxStringBytes)
    if (bytes > limits.maxStringBytes) throw quotaError('string bytes', limits.maxStringBytes)
    totalStringBytes += bytes
    if (totalStringBytes > limits.maxTotalStringBytes) {
      throw quotaError('total string bytes', limits.maxTotalStringBytes)
    }
  }

  while (pending.length > 0) {
    const current = pending.pop()
    if (!current) break
    totalValues += 1
    if (totalValues > limits.maxTotalValues) {
      throw quotaError('JSON values', limits.maxTotalValues)
    }
    if (current.depth > limits.maxValueDepth) {
      throw quotaError('JSON nesting depth', limits.maxValueDepth)
    }

    if (typeof current.value === 'string') {
      accountString(current.value)
      continue
    }
    if (Array.isArray(current.value)) {
      if (current.value.length > limits.maxArrayItems) {
        throw quotaError('JSON array items', limits.maxArrayItems)
      }
      for (const child of current.value) {
        pending.push({ value: child, depth: current.depth + 1 })
      }
      continue
    }
    if (!isPlainObject(current.value)) continue

    const entries = Object.entries(current.value)
    if (entries.length > limits.maxObjectProperties) {
      throw quotaError('JSON object properties', limits.maxObjectProperties)
    }
    for (const [key, child] of entries) {
      accountString(key)
      pending.push({ value: child, depth: current.depth + 1 })
    }
  }
}

function utf8ByteLengthExceeds(value: string, maxBytes: number): boolean {
  return utf8ByteLength(value, maxBytes) > maxBytes
}

function utf8ByteLength(value: string, stopAfter: number): number {
  let bytes = 0
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit < 0x80) bytes += 1
    else if (codeUnit < 0x800) bytes += 2
    else if (
      codeUnit >= 0xd800 &&
      codeUnit <= 0xdbff &&
      index + 1 < value.length &&
      value.charCodeAt(index + 1) >= 0xdc00 &&
      value.charCodeAt(index + 1) <= 0xdfff
    ) {
      bytes += 4
      index += 1
    } else {
      bytes += 3
    }
    if (bytes > stopAfter) return bytes
  }
  return bytes
}

function quotaError(resource: string, limit: number): RangeError {
  return new RangeError(`Untrusted .pen document exceeds the ${resource} limit (${limit})`)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
