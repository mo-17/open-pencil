import type { GoogleDriveNativeBridge } from '@/app/tauri/google-drive'

export function waitForGoogleDriveOAuth<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return pending
  signal.throwIfAborted()
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    const onAbort = () => {
      cleanup()
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new DOMException('The operation was aborted', 'AbortError')
      )
    }
    signal.addEventListener('abort', onAbort, { once: true })
    void pending.then(
      (value) => {
        cleanup()
        resolve(value)
        return undefined
      },
      (error) => {
        cleanup()
        reject(error instanceof Error ? error : new Error('Google Drive OAuth operation failed'))
        return undefined
      }
    )
  })
}

export async function bestEffortGoogleDriveRevoke(
  native: GoogleDriveNativeBridge,
  token: string
): Promise<boolean> {
  try {
    await native.revoke({ token, timeoutMs: 15_000 })
    return true
  } catch {
    return false
  }
}
