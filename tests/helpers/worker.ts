/** A structural Worker double for ownership tests that never starts a thread. */
export function createOwnershipWorker(terminate: () => void): Worker {
  return Object.assign(new EventTarget(), {
    onerror: null,
    onmessage: null,
    onmessageerror: null,
    postMessage: () => undefined,
    terminate
  })
}
