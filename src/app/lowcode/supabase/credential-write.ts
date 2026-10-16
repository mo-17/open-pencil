import type { Ref } from 'vue'

interface CredentialWriteState {
  readonly busy: Ref<boolean>
  readonly error: Ref<boolean>
  readonly setCredential: (value: string) => Promise<void>
  readonly refreshCredentialStatus: () => Promise<void>
}

/** Keep the replacement PAT local to the write and clear it on every exit. */
export function createSupabaseCredentialWriter(
  state: CredentialWriteState,
  refuseWhileBusy = false
) {
  return async (value: string): Promise<boolean> => {
    let personalAccessToken = value
    value = ''
    if (!personalAccessToken.trim() || (refuseWhileBusy && state.busy.value)) {
      personalAccessToken = ''
      state.error.value = true
      return false
    }
    state.busy.value = true
    state.error.value = false
    try {
      await state.setCredential(personalAccessToken)
      await state.refreshCredentialStatus()
      return true
    } catch {
      state.error.value = true
      return false
    } finally {
      personalAccessToken = ''
      state.busy.value = false
    }
  }
}
