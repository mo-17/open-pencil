import { watch, type Ref } from 'vue'

import type { ManagedBackendPresetDraft } from '../presets'
import { useManagedBackendCAPaths } from './ca-paths'

export function useManagedBackendCAPath(
  draft: Ref<ManagedBackendPresetDraft>,
  getIssuer: () => string,
  preferences = useManagedBackendCAPaths()
): void {
  let issuer = getIssuer()
  let jwksURL = draft.value.jwksURL.trim()
  if (!draft.value.caFile) draft.value.caFile = preferences.read(issuer, jwksURL)

  watch(
    [getIssuer, () => draft.value.jwksURL.trim(), () => draft.value.caFile],
    ([nextIssuer, nextJWKS, caFile]) => {
      if (issuer !== nextIssuer || jwksURL !== nextJWKS) {
        const enteredBeforeJWKS = issuer === nextIssuer && !jwksURL ? caFile : ''
        issuer = nextIssuer
        jwksURL = nextJWKS
        draft.value.caFile = enteredBeforeJWKS || preferences.read(issuer, jwksURL)
        if (enteredBeforeJWKS) preferences.write(issuer, jwksURL, enteredBeforeJWKS)
        return
      }
      preferences.write(issuer, jwksURL, caFile)
    },
    { flush: 'sync' }
  )
}
