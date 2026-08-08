export interface AppPluginExporterExecutionResult<TWarning = unknown> {
  fileName: string
  fileCount: number
  warnings: readonly TWarning[]
  saved: boolean
}
