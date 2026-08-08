export function createPluginExportAbortError(): Error {
  const error = new Error('Plugin export cancelled')
  error.name = 'AbortError'
  return error
}

export function throwIfPluginExportAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw createPluginExportAbortError()
}
