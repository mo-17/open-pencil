import { afterAll, beforeAll, expect, setDefaultTimeout, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { BUILTIN_IO_FORMATS, IORegistry } from '@open-pencil/core/io'
import { SceneGraph } from '@open-pencil/scene-graph'

import { cliSourcePath } from '#tests/helpers/paths'
import { heavy } from '#tests/helpers/test-utils'

setDefaultTimeout(30_000)

const CLI = cliSourcePath('index.ts')
const io = new IORegistry(BUILTIN_IO_FORMATS)

async function run(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(['bun', CLI, ...args], {
    stdout: 'pipe',
    stderr: 'pipe'
  })
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text()
  ])
  return {
    stdout: stdout.trim(),
    stderr: stderr.trim(),
    exitCode: await proc.exited
  }
}

heavy('Motion lint CLI', () => {
  const dir = join(tmpdir(), `op-motion-lint-${randomUUID()}`)
  const fixture = join(dir, 'motion.fig')

  beforeAll(async () => {
    await mkdir(dir, { recursive: true })
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.createNode('RECTANGLE', page.id, {
      name: 'Animated card',
      width: 160,
      height: 96,
      motion: {
        version: 1,
        tracks: [
          {
            id: 'entrance',
            trigger: 'mount',
            keyframes: [
              { offset: 0, opacity: 0 },
              { offset: 1, opacity: 1 }
            ],
            timing: { durationMs: 400 }
          }
        ]
      }
    })
    graph.createNode('BOOLEAN_OPERATION', page.id, {
      name: 'Unresolved Boolean motion',
      width: 80,
      height: 80,
      motion: {
        version: 1,
        reducedMotion: 'reduce',
        tracks: [
          {
            id: 'boolean-motion',
            trigger: 'mount',
            keyframes: [
              { offset: 0, opacity: 0 },
              { offset: 1, opacity: 1 }
            ],
            timing: { durationMs: 300 }
          }
        ]
      }
    })
    const result = await io.writeDocument('fig', graph)
    await Bun.write(fixture, result.data as Uint8Array)
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test('reports a Motion rule through the existing JSON lint command', async () => {
    const { stdout, stderr, exitCode } = await run([
      'lint',
      fixture,
      '--rule',
      'motion-reduced-motion',
      '--json'
    ])

    expect(exitCode).toBe(0)
    expect(stderr).toBe('')
    expect(JSON.parse(stdout)).toMatchObject({
      errorCount: 0,
      warningCount: 1,
      messages: [
        {
          ruleId: 'motion-reduced-motion',
          severity: 'warning',
          nodeName: 'Animated card'
        }
      ]
    })
  })

  test('accessibility preset promotes reduced-motion failures to an error exit', async () => {
    const { stdout, stderr, exitCode } = await run([
      'lint',
      fixture,
      '--preset',
      'accessibility',
      '--rule',
      'motion-reduced-motion',
      '--json'
    ])

    expect(exitCode).toBe(1)
    expect(stderr).toBe('')
    expect(JSON.parse(stdout)).toMatchObject({
      errorCount: 1,
      warningCount: 0,
      messages: [{ ruleId: 'motion-reduced-motion', severity: 'error' }]
    })
  })

  test('reports unresolved Boolean Motion targets through the CLI', async () => {
    const { stdout, stderr, exitCode } = await run([
      'lint',
      fixture,
      '--rule',
      'motion-target-capability',
      '--json'
    ])

    expect(exitCode).toBe(0)
    expect(stderr).toBe('')
    expect(JSON.parse(stdout)).toMatchObject({
      errorCount: 0,
      warningCount: 1,
      messages: [
        {
          ruleId: 'motion-target-capability',
          severity: 'warning',
          nodeName: 'Unresolved Boolean motion'
        }
      ]
    })
  })

  test('lists the complete Motion rule family', async () => {
    const { stdout, stderr, exitCode } = await run(['lint', fixture, '--list-rules'])

    expect(exitCode).toBe(0)
    expect(stderr).toBe('')
    for (const id of [
      'motion-reduced-motion',
      'motion-target-capability',
      'motion-loop-safety',
      'motion-flashing',
      'motion-transform-bounds',
      'motion-long-timing',
      'motion-complexity-budget'
    ]) {
      expect(stdout).toContain(id)
    }
  })
})
