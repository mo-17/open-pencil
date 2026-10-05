/** In-process transport for reader recovery tests; event handling is a real EventTarget. */
export class TestFigWorker extends EventTarget implements Worker {
  onerror: Worker['onerror'] = null
  onmessage: Worker['onmessage'] = null
  onmessageerror: Worker['onmessageerror'] = null

  postMessage(_message: unknown, _options?: Transferable[] | StructuredSerializeOptions): void {
    return undefined
  }
  terminate(): void {
    return undefined
  }
}
