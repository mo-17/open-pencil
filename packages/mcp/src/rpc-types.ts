export type RPCSendOptions = Partial<Pick<AbortController, 'signal'>> & {
  onProgress?: (progress: unknown) => void
}

export type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
  onProgress?: (progress: unknown) => void
}
