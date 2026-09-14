import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

async function runProbe(mode: 'react' | 'vue' | 'parallel'): Promise<string> {
  const parent = join(process.cwd(), 'packages/compiler/.preview-root')
  mkdirSync(parent, { recursive: true })
  const directory = mkdtempSync(join(parent, 'close-test-'))
  // A child makes a shutdown regression a bounded failure with owned process
  // cleanup, rather than leaving the unit runner stuck in an afterEach hook.
  const child = Bun.spawn(
    [
      process.execPath,
      fileURLToPath(new URL('./close/helpers.ts', import.meta.url)),
      directory,
      mode
    ],
    { stdout: 'pipe', stderr: 'pipe' }
  )
  let timedOut = false
  const watchdog = setTimeout(() => {
    timedOut = true
    child.kill('SIGKILL')
  }, 20_000)
  try {
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text()
    ])
    if (timedOut || exitCode !== 0)
      throw new Error(
        `Preview shutdown failed (${exitCode}, timeout=${timedOut})\n${stdout}\n${stderr}`
      )
    // Vite may log a watched tsconfig change when the other target is first
    // created. Require one exact fixture completion marker, not silent logs.
    return stdout
      .split(/\r?\n/u)
      .filter((line) => line.startsWith(mode + ':'))
      .join('\n')
  } finally {
    clearTimeout(watchdog)
    if (child.exitCode === null) child.kill('SIGKILL')
    await child.exited
    rmSync(directory, { recursive: true, force: true })
  }
}

test.each(['react', 'vue'] as const)(
  '%s closes during a cold dependency crawl, releases its port and tolerates repeated close',
  async (target) => {
    expect(await runProbe(target)).toBe(
      target + ': cold entry served; closed; port rebound; repeated close complete'
    )
  },
  25_000
)

test('concurrent React and Vue previews preserve each other’s optimized modules and release both ports', async () => {
  expect(await runProbe('parallel')).toBe(
    'parallel: caches isolated; original modules retained; both ports released'
  )
}, 25_000)
