import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

import type { ManagedPreviewDirectory } from './directory'
import type { ManagedPreviewConfig } from './protocol'

export type ManagedWorkerAction =
  | 'install'
  | 'build'
  | 'setup'
  | 'apply'
  | 'verify'
  | 'api'
  | 'stop'
export interface ManagedChild {
  readonly child: ChildProcessWithoutNullStreams
  readonly completed: Promise<{ code: number | null; output: string }>
  stop(): Promise<void>
}
function environment(config: ManagedPreviewConfig): NodeJS.ProcessEnv {
  const allowed = [
    'PATH',
    'HOME',
    'TMPDIR',
    'TEMP',
    'LANG',
    'LC_ALL',
    'SystemRoot',
    'DOCKER_HOST',
    'DOCKER_CONTEXT',
    'DOCKER_CONFIG'
  ]
  const result: NodeJS.ProcessEnv = {}
  for (const key of allowed) if (process.env[key] !== undefined) result[key] = process.env[key]
  if (config.caFile) result.NODE_EXTRA_CA_CERTS = config.caFile
  return result
}
export function spawnManagedWorker(
  directory: ManagedPreviewDirectory,
  generation: string,
  config: ManagedPreviewConfig,
  action: ManagedWorkerAction,
  planId = ''
): ManagedChild {
  const path = directory.path(`generations/${generation}/scripts/managed/worker.mjs`)
  const child = spawn('node', [path, action, planId], {
    cwd: directory.root,
    env: environment(config),
    detached: true,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  let output = ''
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    output += chunk
    if (output.length > 65536) output = output.slice(-65536)
  })
  child.stderr.resume()
  const completed = new Promise<{ code: number | null; output: string }>((resolve) => {
    child.once('error', () => resolve({ code: 1, output: '' }))
    child.once('exit', (code) => resolve({ code, output }))
  })
  return {
    child,
    completed,
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return
      // Only this process group created by this companion is signalled; saved PIDs are never killed.
      child.stdin.end()
      if (child.pid) {
        try {
          process.kill(-child.pid, 'SIGTERM')
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH')
            throw new Error('Managed process group could not be stopped.')
        }
      }
      const forced = setTimeout(() => {
        if (child.pid) {
          try {
            process.kill(-child.pid, 'SIGKILL')
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ESRCH')
              console.warn('Managed process group stop could not be confirmed.')
          }
        }
      }, 2000)
      await completed
      clearTimeout(forced)
    }
  }
}
export async function runManagedWorker(
  directory: ManagedPreviewDirectory,
  generation: string,
  config: ManagedPreviewConfig,
  action: ManagedWorkerAction,
  signal: AbortSignal,
  planId = ''
): Promise<unknown> {
  signal.throwIfAborted()
  const process = spawnManagedWorker(directory, generation, config, action, planId)
  const abort = () => {
    void process.stop()
  }
  signal.addEventListener('abort', abort, { once: true })
  try {
    const result = await process.completed
    signal.throwIfAborted()
    if (result.code !== 0)
      throw new Error(
        'Managed preview ' +
          action +
          ' failed. Check Node, npm, Docker, ports and trusted identity settings; raw process output was withheld.'
      )
    const line = result.output
      .split('\n')
      .findLast((entry) => entry.startsWith('OPENPENCIL_MANAGED_RESULT '))
    if (!line) throw new Error('Managed worker completed without a valid result.')
    try {
      return JSON.parse(line.slice('OPENPENCIL_MANAGED_RESULT '.length))
    } catch {
      throw new Error('Managed worker result could not be parsed.')
    }
  } finally {
    signal.removeEventListener('abort', abort)
  }
}
