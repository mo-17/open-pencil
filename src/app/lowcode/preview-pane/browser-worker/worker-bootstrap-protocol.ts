export const BROWSER_PREVIEW_WORKER_PROTOCOL_VERSION = 3

export const BROWSER_PREVIEW_WORKER_STAGES = [
  'worker-load',
  'restore',
  'fonts',
  'compile',
  'bundle-validate',
  'bundle-load',
  'bundle-initialize',
  'bundle-javascript',
  'bundle-css',
  'bundle-html'
] as const

export type BrowserPreviewWorkerStage = (typeof BROWSER_PREVIEW_WORKER_STAGES)[number]
