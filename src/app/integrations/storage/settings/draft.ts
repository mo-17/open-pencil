import { appCredentialServices } from '@/app/settings/credentials/app'

import { readActiveStorageProfileID } from '../preferences'
import { storageProviderRegistry } from '../providers'
import { requireStorageProfileID } from '../types'
import type { StorageProviderID } from '../types'

/** Test a snapshot without changing saved preferences or exposing saved secrets to the form. */
export function testStorageDraft(
  providerID: StorageProviderID,
  preferences: Record<string, string>,
  credentials: Record<string, string>,
  cleared: string[],
  options: { profileId?: string; signal?: AbortSignal } = {}
) {
  const profileId = requireStorageProfileID(
    options.profileId ?? readActiveStorageProfileID(providerID)
  )
  const preferenceSnapshot = { ...preferences }
  const credentialSnapshot = { ...credentials }
  const removals = new Set(cleared)
  options.signal?.throwIfAborted()
  const provider = storageProviderRegistry.get(providerID)
  const fields = new Set(provider.credentialFields.map((field) => field.id))
  const adapter = storageProviderRegistry.createAdapter(providerID, {
    preferences: preferenceSnapshot,
    profileId,
    credentialManager: appCredentialServices.manager,
    credentials: {
      async resolve(reference) {
        options.signal?.throwIfAborted()
        if (
          reference.integrationId !== providerID ||
          reference.profileId !== profileId ||
          !fields.has(reference.field)
        ) {
          throw new Error('Unexpected storage credential reference')
        }
        if (removals.has(reference.field)) return null
        const replacement = credentialSnapshot[reference.field]?.trim()
        if (replacement) return replacement
        const saved = await appCredentialServices.resolver.resolve(reference)
        options.signal?.throwIfAborted()
        return saved
      }
    }
  })
  return adapter.testConnection({ signal: options.signal })
}
