/// <reference lib="webworker" />
/* oxlint-disable unicorn/require-post-message-target-origin -- DedicatedWorkerGlobalScope postMessage has no target origin. */

import { createPluginRuntimeWorkerRequestHandler } from './worker-handler'

const handleRequest = createPluginRuntimeWorkerRequestHandler((response) => {
  globalThis.postMessage(response)
})

globalThis.addEventListener('message', (event: MessageEvent<unknown>) => {
  void handleRequest(event.data).then((handled) => {
    if (handled) globalThis.close()
    return undefined
  })
})
