import * as v from 'valibot'

import { validateSourceMigrationLedger } from '@open-pencil/lowcode/backend'
import {
  parseRemoteComponentLibraryDescriptor,
  type LibraryManifest
} from '@open-pencil/scene-graph'

export function parseCLILibraryManifest(value: unknown): LibraryManifest {
  const envelope = v.parse(
    v.looseObject({
      source: v.optional(v.object({ kind: v.picklist(['file', 'url']), ref: v.string() }))
    }),
    value
  )
  return {
    ...parseRemoteComponentLibraryDescriptor(value, 'manifest', { allowExtraKeys: true }),
    ...(envelope.source ? { source: envelope.source } : {})
  }
}

export function parseCLISourceMigrationLedger(value: unknown) {
  const parsed = validateSourceMigrationLedger(value)
  if (!parsed.ok) throw new Error('Expected a valid CLI source migration ledger')
  return parsed.value
}
