export const MINIPROGRAM_SOURCE_COMPILER_WORKER_PROTOCOL_VERSION = 2

export const MINIPROGRAM_SOURCE_COMPILER_WORKER_STAGES = [
  'worker-load',
  'validate',
  'restore',
  'compile',
  'audit'
] as const

export type MiniProgramSourceCompilerWorkerStage =
  (typeof MINIPROGRAM_SOURCE_COMPILER_WORKER_STAGES)[number]
