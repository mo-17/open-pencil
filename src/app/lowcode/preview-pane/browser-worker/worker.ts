/// <reference lib="webworker" />

import { installBrowserPreviewWorkerBootstrap } from './bootstrap'

installBrowserPreviewWorkerBootstrap(globalThis, {
  loadRuntime: () => import('./worker-runtime')
})
