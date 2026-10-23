/// <reference lib="webworker" />
import { installVueSourceCompilerWorkerBootstrap } from './bootstrap'

installVueSourceCompilerWorkerBootstrap(globalThis, {
  loadRuntime: () => import('./runtime')
})
