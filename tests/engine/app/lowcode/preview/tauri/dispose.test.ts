import { expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { once } from 'node:events'

test('native local preview disconnect kills before a pending update ACK completes', async () => {
  const child = spawn(
    process.execPath,
    ['tests/engine/app/lowcode/preview/tauri/dispose/helpers.ts'],
    {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )
  let output = ''
  let errors = ''
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    output += chunk
  })
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    errors += chunk
  })
  const timeout = setTimeout(() => child.kill('SIGKILL'), 10_000)
  try {
    const [code] = await once(child, 'exit')
    expect(errors).toBe('')
    expect(code).toBe(0)
    expect(output).toBe('immediate-disconnect-passed\n')
  } finally {
    clearTimeout(timeout)
    if (child.exitCode === null) child.kill('SIGKILL')
  }
}, 15_000)
