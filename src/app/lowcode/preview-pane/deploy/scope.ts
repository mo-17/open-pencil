import type { EditorStore } from '@/app/editor/session'
import { DEFAULT_STORAGE_PROFILE_ID } from '@/app/integrations/storage/types'

import { deployDocumentScope } from './history'

const transientIds = new WeakMap<EditorStore, string>()
let nextTransientId = 0

function transientIdForStore(store: EditorStore): string {
  const existing = transientIds.get(store)
  if (existing) return existing
  const id = `unsaved-store-${++nextTransientId}`
  transientIds.set(store, id)
  return id
}

/** Resolve the active document's deploy-metadata scope. Remote bindings win
 * over local paths; unsaved documents use a per-store, process-local scope. */
export function deployScopeForStore(store: EditorStore): string | undefined {
  const binding = store.getStorageBinding()
  if (binding) {
    return deployDocumentScope({
      kind: 'storage',
      providerId: binding.providerId,
      ...(binding.profileId === DEFAULT_STORAGE_PROFILE_ID && !binding.authority
        ? {}
        : {
            profileId: binding.profileId,
            ...(binding.authority ? { accountId: binding.authority.accountId } : {})
          }),
      documentId: binding.documentId
    })
  }
  const path = store.getSourceIdentity().path ?? store.getDocumentPath()
  if (path) return deployDocumentScope({ kind: 'path', path })
  return deployDocumentScope({ kind: 'transient', id: transientIdForStore(store) })
}
