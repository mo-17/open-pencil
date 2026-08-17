export const BROWSER_PREVIEW_WORKER_LIMITS = Object.freeze({
  maxSnapshotBytes: 32 * 1024 * 1024,
  maxNodes: 25_000,
  maxImages: 4_096,
  maxPageIds: 256,
  maxPageIdLength: 256,
  maxDiagnostics: 4_096,
  maxDiagnosticTextLength: 2_048,
  maxHtmlBytes: 32 * 1024 * 1024,
  /** Maximum silence inside one observable Worker stage. */
  timeoutMs: 60_000,
  /** Hard ceiling even when a Worker keeps reporting valid stage progress. */
  totalTimeoutMs: 180_000
})
