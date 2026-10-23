import * as v from 'valibot'

export const CHECKPOINT_LIMITS = {
  maxBytes: 128 * 1024 * 1024,
  maxSnapshotBytes: 32 * 1024 * 1024,
  maxCount: 100,
  maxPerDocument: 20,
  maxNameLength: 80,
  maxDifferences: 200
} as const

export const CheckpointMetadataSchema = v.object({
  id: v.pipe(v.string(), v.minLength(1), v.maxLength(128)),
  scope: v.pipe(v.string(), v.minLength(1), v.maxLength(4096)),
  name: v.pipe(v.string(), v.minLength(1), v.maxLength(CHECKPOINT_LIMITS.maxNameLength)),
  documentName: v.pipe(v.string(), v.maxLength(256)),
  createdAt: v.pipe(v.string(), v.isoTimestamp()),
  byteLength: v.pipe(
    v.number(),
    v.integer(),
    v.minValue(1),
    v.maxValue(CHECKPOINT_LIMITS.maxSnapshotBytes)
  ),
  kind: v.picklist(['named', 'before-restore']),
  formatVersion: v.literal(1)
})

export type CheckpointMetadata = v.InferOutput<typeof CheckpointMetadataSchema>
export interface DocumentCheckpoint extends CheckpointMetadata {
  figBytes: Uint8Array
}
export type CheckpointInput = Pick<
  CheckpointMetadata,
  'scope' | 'name' | 'documentName' | 'kind'
> & {
  figBytes: Uint8Array
}
export interface CheckpointStore {
  list(): Promise<CheckpointMetadata[]>
  read(id: string): Promise<DocumentCheckpoint | null>
  write(input: CheckpointInput): Promise<CheckpointMetadata>
  remove(id: string): Promise<void>
}

export class CheckpointError extends Error {
  constructor(readonly code: 'invalid' | 'limit' | 'missing' | 'changed' | 'unavailable') {
    super(`Document checkpoint: ${code}`)
    this.name = 'CheckpointError'
  }
}

export function assertCheckpointCapacity(rows: CheckpointMetadata[], next: CheckpointMetadata) {
  if (
    rows.length >= CHECKPOINT_LIMITS.maxCount ||
    rows.filter((row) => row.scope === next.scope).length >= CHECKPOINT_LIMITS.maxPerDocument ||
    rows.reduce((size, row) => size + row.byteLength, next.byteLength) > CHECKPOINT_LIMITS.maxBytes
  )
    throw new CheckpointError('limit')
}
