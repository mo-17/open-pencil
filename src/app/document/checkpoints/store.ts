import type { DBSchema } from 'idb'
import * as v from 'valibot'

import { createCanvasId } from '@/app/storage/id'
import {
  APP_DATABASE_NAMES,
  binaryStorage,
  connectAppDatabase,
  defineAppDatabase,
  readStoredBinary,
  type StoredBinary
} from '@/app/storage/idb'

import {
  assertCheckpointCapacity,
  CheckpointError,
  CheckpointMetadataSchema,
  type CheckpointStore,
  type CheckpointMetadata
} from './types'

interface CheckpointDatabase extends DBSchema {
  meta: { key: string; value: CheckpointMetadata }
  fig: { key: string; value: StoredBinary }
}

const definition = defineAppDatabase<CheckpointDatabase>({
  name: APP_DATABASE_NAMES.checkpoints,
  version: 1,
  callbacks: {
    upgrade(database) {
      database.createObjectStore('meta', { keyPath: 'id' })
      database.createObjectStore('fig')
    }
  }
})

function metadata(value: unknown): CheckpointMetadata {
  const parsed = v.safeParse(CheckpointMetadataSchema, value)
  if (!parsed.success) throw new CheckpointError('invalid')
  return parsed.output
}

/** No memory fallback: a named version must never claim durable local storage after a failure. */
export function createCheckpointStore(): CheckpointStore {
  const database = connectAppDatabase(definition)
  return {
    async list() {
      const rows = await (await database.open()).getAll('meta')
      return rows.map(metadata).toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))
    },
    async read(id) {
      const db = await database.open()
      const transaction = db.transaction(['meta', 'fig'])
      const [row, binary] = await Promise.all([
        transaction.objectStore('meta').get(id),
        transaction.objectStore('fig').get(id)
      ])
      await transaction.done
      if (!row) return null
      const meta = metadata(row)
      const figBytes = await readStoredBinary(binary)
      if (!figBytes || figBytes.byteLength !== meta.byteLength) throw new CheckpointError('invalid')
      return { ...meta, figBytes: figBytes.slice() }
    },
    async write(input) {
      const next = metadata({
        id: createCanvasId(),
        scope: input.scope,
        name: input.name.trim(),
        documentName: input.documentName,
        createdAt: new Date().toISOString(),
        byteLength: input.figBytes.byteLength,
        kind: input.kind,
        formatVersion: 1
      })
      const storeBinary = await binaryStorage()
      const bytes = storeBinary(input.figBytes.slice())
      const db = await database.open()
      // Capacity checks and both rows share one transaction, including writes from other tabs.
      const transaction = db.transaction(['meta', 'fig'], 'readwrite')
      try {
        const rows = await transaction.objectStore('meta').getAll()
        assertCheckpointCapacity(rows.map(metadata), next)
        await Promise.all([
          transaction.objectStore('meta').add(next),
          transaction.objectStore('fig').add(bytes, next.id)
        ])
        await transaction.done
        return next
      } catch (error) {
        try {
          transaction.abort()
          // oxlint-disable-next-line open-pencil/no-silent-catch -- Aborting an already finished transaction cannot replace the original write or capacity error below.
        } catch {
          // The original failure remains authoritative when the transaction is already finished.
        }
        // Drain the transaction rejection after abort; rethrow the original failure rather than
        // replacing a useful quota/capacity/request error with the resulting AbortError.
        await transaction.done.catch(() => undefined)
        throw error
      }
    },
    async remove(id) {
      const transaction = (await database.open()).transaction(['meta', 'fig'], 'readwrite')
      await Promise.all([
        transaction.objectStore('meta').delete(id),
        transaction.objectStore('fig').delete(id),
        transaction.done
      ])
    }
  }
}
