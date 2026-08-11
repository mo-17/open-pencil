export const VUE_SOURCE_COMPILER_WORKER_LIMITS = Object.freeze({
  maxSnapshotBytes: 32 * 1024 * 1024,
  maxNodes: 25_000,
  maxImages: 4_096,
  maxTraversedValues: 4_000_000,
  maxOutputBytes: 64 * 1024 * 1024,
  maxOutputFiles: 4_096,
  maxWarnings: 4_096,
  timeoutMs: 60_000
})
