import * as v from 'valibot'

export const RUNTIME_DEBUG_LIMIT = 200
const integer = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(Number.MAX_SAFE_INTEGER))
const RuntimeDebugEntrySchema = v.strictObject({
  sequence: v.pipe(integer, v.minValue(1)),
  trace: v.pipe(integer, v.minValue(1)),
  nodeId: v.nullable(v.pipe(v.string(), v.minLength(1), v.maxLength(512))),
  kind: v.picklist(['event', 'action', 'expression', 'request', 'state', 'error']),
  label: v.pipe(v.string(), v.minLength(1), v.maxLength(128)),
  status: v.picklist(['start', 'success', 'error', 'changed']),
  durationMs: v.nullable(v.pipe(v.number(), v.minValue(0), v.maxValue(Number.MAX_SAFE_INTEGER)))
})
const RuntimeDebugBatchSchema = v.strictObject({
  entries: v.pipe(v.array(RuntimeDebugEntrySchema), v.maxLength(32)),
  dropped: integer
})
export type RuntimeDebugEntry = v.InferOutput<typeof RuntimeDebugEntrySchema>
export type RuntimeDebugBatch = v.InferOutput<typeof RuntimeDebugBatchSchema>

export function parseRuntimeDebugBatch(value: unknown): RuntimeDebugBatch | null {
  const result = v.safeParse(RuntimeDebugBatchSchema, value)
  if (!result.success) return null
  return result.output.entries.every(
    (entry, index, entries) => index === 0 || entry.sequence > entries[index - 1].sequence
  )
    ? result.output
    : null
}

export function appendRuntimeDebugEntries(
  previous: readonly RuntimeDebugEntry[],
  incoming: readonly RuntimeDebugEntry[]
): RuntimeDebugEntry[] {
  const last = previous.at(-1)?.sequence ?? -1
  return [...previous, ...incoming.filter((entry) => entry.sequence > last)].slice(
    -RUNTIME_DEBUG_LIMIT
  )
}
