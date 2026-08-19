/// <reference lib="webworker" />

import { installMiniProgramSourceCompilerWorkerBootstrap } from './bootstrap'

installMiniProgramSourceCompilerWorkerBootstrap(globalThis, {
  loadRuntime: () => import('./worker-runtime')
})
