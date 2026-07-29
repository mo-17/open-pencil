import { afterAll, beforeAll, expect, setDefaultTimeout, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { BUILTIN_IO_FORMATS, IORegistry } from '@open-pencil/core/io'
import { SceneGraph, type MotionSpec } from '@open-pencil/scene-graph'

import { cliSourcePath } from '#tests/helpers/paths'
import { heavy } from '#tests/helpers/test-utils'

setDefaultTimeout(30_000)

const CLI = cliSourcePath('index.ts')
const io = new IORegistry(BUILTIN_IO_FORMATS)
const ADAPTER_ENVELOPE_KEYS = ['version', 'source', 'target', 'safety', 'plan', 'script', 'output']
const supportedMotion: MotionSpec = {
  version: 1,
  tracks: [
    {
      id: 'entrance',
      trigger: 'mount',
      keyframes: [
        { offset: 0, opacity: 0, y: 12 },
        { offset: 1, opacity: 1, y: 0 }
      ],
      timing: { durationMs: 300 }
    }
  ]
}

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

heavy('motion figma-adapter CLI', () => {
  const dir = join(tmpdir(), `op-motion-figma-adapter-${randomUUID()}`)
  const fixture = join(dir, 'motion.fig')
  let supportedId = ''
  let unsupportedId = ''

  beforeAll(async () => {
    await mkdir(dir, { recursive: true })
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const supported = graph.createNode('RECTANGLE', page.id, {
      name: 'Supported Motion',
      opacity: 0.6,
      motion: supportedMotion
    })
    const unsupported = graph.createNode('RECTANGLE', page.id, {
      name: 'Hover Motion',
      motion: {
        ...supportedMotion,
        tracks: [{ ...supportedMotion.tracks[0], trigger: 'hover' }]
      }
    })
    const result = await io.writeDocument('fig', graph)
    await Bun.write(fixture, result.data as Uint8Array)

    const supportedFind = await run(['find', fixture, '--name', supported.name, '--json'])
    const unsupportedFind = await run(['find', fixture, '--name', unsupported.name, '--json'])
    supportedId = (JSON.parse(supportedFind.stdout) as Array<{ id: string }>)[0]?.id ?? ''
    unsupportedId = (JSON.parse(unsupportedFind.stdout) as Array<{ id: string }>)[0]?.id ?? ''
    if (!supportedId || !unsupportedId) throw new Error('Motion fixture nodes were not imported')
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test('generates a safe selection-based script without coupling the source node ID', async () => {
    const { stdout, stderr, exitCode } = await run([
      'motion',
      'figma-adapter',
      fixture,
      '--node',
      supportedId,
      '--json'
    ])

    expect(exitCode).toBe(0)
    expect(stderr).toBe('')
    const result = JSON.parse(stdout) as {
      version: number
      source: { node: { id: string } }
      target: { mode: string; nodeId?: string }
      safety: { conflictPolicy: string; allowTimelineGrowth: boolean; ownership: string }
      plan: {
        supported: boolean
        durationSeconds: number
        managedFields: Array<{ name: string }>
      }
      script: string
      output: string | null
    }
    expect(Object.keys(result)).toEqual(ADAPTER_ENVELOPE_KEYS)
    expect(result.version).toBe(1)
    expect(result.source.node.id).toBe(supportedId)
    expect(result.target).toEqual({ mode: 'selection' })
    expect(result.safety).toMatchObject({
      conflictPolicy: 'replace-owned',
      allowTimelineGrowth: false,
      ownership: 'openpencil/nativeMotionAdapterV1'
    })
    expect(result.plan.supported).toBe(true)
    expect(result.plan.durationSeconds).toBe(0.3)
    expect(result.plan.managedFields.map((field) => field.name)).toEqual([
      'OPACITY',
      'TRANSLATION_Y'
    ])
    expect(result.script).toContain('figma.currentPage.selection')
    expect(result.script).toContain('"conflictPolicy": "replace-owned"')
    expect(result.script).not.toContain(supportedId)
    expect(result.output).toBeNull()
  })

  test('prints only raw JavaScript when no output mode is selected', async () => {
    const { stdout, stderr, exitCode } = await run([
      'motion',
      'figma-adapter',
      fixture,
      '--node',
      supportedId
    ])

    expect(exitCode).toBe(0)
    expect(stderr).toBe('')
    expect(stdout).toStartWith(';(async () => {')
    expect(stdout).toEndWith('})()')
    expect(stdout).toContain('"conflictPolicy": "replace-owned"')
    expect(stdout).not.toContain('Script generated')
    expect(stdout).not.toContain('Supported Motion')
  })

  test('-o writes the explicit-target script and prints an agentfmt summary', async () => {
    const output = join(dir, 'adapter.js')
    const { stdout, stderr, exitCode } = await run([
      'motion',
      'figma-adapter',
      fixture,
      '--node',
      supportedId,
      '--target-node',
      '99:42',
      '--conflict-policy',
      'replace-all',
      '--allow-timeline-growth',
      '-o',
      output
    ])

    expect(exitCode).toBe(0)
    expect(stderr).toBe('')
    expect(stdout).toContain('[rectangle] "Supported Motion"')
    expect(stdout).toContain('conflicts: replace-all')
    expect(stdout).toContain('timeline: growth allowed')
    expect(stdout).toContain(`Wrote ${resolve(output)}`)
    expect(stdout).not.toStartWith(';(async () => {')
    const script = await Bun.file(output).text()
    expect(script).toContain('figma.getNodeByIdAsync("99:42")')
    expect(script).not.toContain('figma.currentPage.selection')
    expect(script).toContain('"conflictPolicy": "replace-all"')
    expect(script).toContain('"allowTimelineGrowth": true')
  })

  test('human output diagnoses unsupported Motion and leaves an output file untouched', async () => {
    const output = join(dir, 'unsupported.js')
    await Bun.write(output, 'sentinel')
    const { stdout, stderr, exitCode } = await run([
      'motion',
      'figma-adapter',
      fixture,
      '--node',
      unsupportedId,
      '-o',
      output
    ])

    expect(exitCode).toBe(1)
    expect(stderr).toBe('')
    expect(stdout).toContain('unsupported')
    expect(stdout).toContain('trigger')
    expect(stdout).not.toContain(`Wrote ${resolve(output)}`)
    expect(await Bun.file(output).text()).toBe('sentinel')
  })

  test('--json keeps the same envelope for unsupported Motion', async () => {
    const { stdout, stderr, exitCode } = await run([
      'motion',
      'figma-adapter',
      fixture,
      '--node',
      unsupportedId,
      '--json'
    ])

    expect(exitCode).toBe(1)
    expect(stderr).toBe('')
    const result = JSON.parse(stdout) as {
      version: number
      source: { node: { id: string } }
      target: { mode: string }
      safety: { conflictPolicy: string; allowTimelineGrowth: boolean }
      plan: { supported: boolean; issues: Array<{ code: string }> }
      script: string | null
      output: string | null
    }
    expect(Object.keys(result)).toEqual(ADAPTER_ENVELOPE_KEYS)
    expect(result).toMatchObject({
      version: 1,
      source: { node: { id: unsupportedId } },
      target: { mode: 'selection' },
      safety: { conflictPolicy: 'replace-owned', allowTimelineGrowth: false },
      plan: { supported: false },
      script: null,
      output: null
    })
    expect(result.plan.issues.map((issue) => issue.code)).toEqual(['trigger'])
  })

  test('rejects an unknown conflict policy before writing output', async () => {
    const output = join(dir, 'invalid-policy.js')
    const { stdout, stderr, exitCode } = await run([
      'motion',
      'figma-adapter',
      fixture,
      '--node',
      supportedId,
      '--conflict-policy',
      'overwrite',
      '-o',
      output
    ])

    expect(exitCode).toBe(1)
    expect(stdout).toBe('')
    expect(stderr).toContain('Unknown conflict policy')
    expect(await Bun.file(output).exists()).toBe(false)
  })
})
