export const MINIPROGRAM_SOURCE_COMPILER_WORKER_LIMITS = Object.freeze({
  maxSnapshotBytes: 32 * 1024 * 1024,
  maxNodes: 25_000,
  maxImages: 4_096,
  maxPageIds: 512,
  maxOutputBytes: 32 * 1024 * 1024,
  maxOutputFiles: 2_048,
  maxWarnings: 2_048,
  /** Maximum silence between validated Worker stage messages. */
  timeoutMs: 60_000,
  /** Hard ceiling even when the Worker keeps reporting valid progress. */
  totalTimeoutMs: 180_000
})
