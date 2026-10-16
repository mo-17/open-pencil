interface PendingPreviewRequest {
  timer: ReturnType<typeof setTimeout>
  reject(error: Error): void
}

export function cancelPreviewRequests<Request extends PendingPreviewRequest>(
  pending: Map<string, Request>,
  message: string
): void {
  for (const item of pending.values()) {
    clearTimeout(item.timer)
    item.reject(new Error(message))
  }
  pending.clear()
}

export async function waitForPreviewProcessExit(
  exited: Promise<void>,
  timeoutMs: number
): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  await Promise.race([
    exited,
    new Promise<void>((resolve) => {
      timeout = setTimeout(resolve, timeoutMs)
    })
  ])
  clearTimeout(timeout)
}
