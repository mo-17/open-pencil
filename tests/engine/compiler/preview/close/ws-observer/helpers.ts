import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

// Only Node's native WebSocket enters this child, while the actual Vite server
// stays in Bun. Playwright's loader and compiler dependencies never enter it.
const source = `
const connection = new WebSocket(process.argv[1], 'vite-hmr');
const emit = (type) => process.stdout.write(JSON.stringify({type}) + '\\n');
connection.addEventListener('open', () => emit('observer-ready'));
connection.addEventListener('message', (event) => emit(JSON.parse(String(event.data)).type));
connection.addEventListener('error', () => emit('observer-error'));
connection.addEventListener('close', () => process.stdin.destroy());
process.stdin.on('end', () => connection.close());
process.stdin.resume();
`

async function deadline<T>(promise: Promise<T>, phase: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`HMR observer ${phase} timed out`)), 1500)
  })
  try {
    return await Promise.race([promise, timedOut])
  } finally {
    clearTimeout(timer)
  }
}

export async function observeHMR(url: string) {
  const child = spawn('node', ['--input-type=module', '-e', source, url.replace('http:', 'ws:')], {
    stdio: ['pipe', 'pipe', 'pipe']
  })
  const messages: string[] = []
  const reader = createInterface({ input: child.stdout })
  child.stderr.resume()
  let exited = false
  let closing = false
  let readyResolve: (() => void) | undefined
  let readyReject: ((error: Error) => void) | undefined
  const ready = new Promise<void>((resolve, reject) => {
    readyResolve = resolve
    readyReject = reject
  })
  child.on('error', (error) => readyReject?.(error))
  child.stdin.on('error', (error) => readyReject?.(error))
  const completed = new Promise<void>((resolve) => {
    child.once('close', () => {
      exited = true
      if (!closing) {
        messages.push('error')
        readyReject?.(new Error('HMR observer exited unexpectedly'))
      }
      resolve()
    })
  })
  reader.on('line', (line) => {
    const invalidFrame = (): void => {
      messages.push('error')
      readyReject?.(new Error('HMR observer sent an invalid frame'))
    }
    let frame: unknown
    try {
      frame = JSON.parse(line)
    } catch {
      invalidFrame()
      return
    }
    if (
      !frame ||
      typeof frame !== 'object' ||
      !('type' in frame) ||
      typeof frame.type !== 'string'
    ) {
      invalidFrame()
      return
    }
    if (frame.type === 'observer-ready') readyResolve?.()
    else if (frame.type === 'observer-error') {
      messages.push('error')
      readyReject?.(new Error('HMR observer socket error'))
    } else messages.push(frame.type)
  })
  const finishClose = async (): Promise<void> => {
    closing = true
    child.stdin.end()
    try {
      await deadline(completed, 'disconnect')
    } catch {
      if (!exited) child.kill('SIGTERM')
      try {
        await deadline(completed, 'terminate')
      } catch {
        if (!exited) child.kill('SIGKILL')
        await completed
      }
    } finally {
      reader.close()
    }
  }
  let closePromise: Promise<void> | undefined
  const close = (): Promise<void> => {
    closePromise ??= Promise.resolve().then(finishClose)
    return closePromise
  }
  try {
    await deadline(ready, 'startup')
    return { messages, close }
  } catch (error) {
    await close()
    throw error
  }
}
