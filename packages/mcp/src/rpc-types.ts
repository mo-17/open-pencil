export interface RpcSendOptions {
  onProgress?: (progress: unknown) => void
  signal?: AbortSignal
}

export type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
  onProgress?: (progress: unknown) => void
}
