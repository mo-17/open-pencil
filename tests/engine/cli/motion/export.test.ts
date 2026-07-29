import { afterAll, beforeAll, expect, setDefaultTimeout, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { BUILTIN_IO_FORMATS, IORegistry } from '@open-pencil/core/io'
import { discoverFfmpegMotionEncoders } from '@open-pencil/mcp/motion-export'
import { SceneGraph } from '@open-pencil/scene-graph'

import { cliSourcePath } from '#tests/helpers/paths'
import { heavy } from '#tests/helpers/test-utils'

setDefaultTimeout(30_000)

const CLI = cliSourcePath('index.ts')
const io = new IORegistry(BUILTIN_IO_FORMATS)

async function run(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const process = Bun.spawn(['bun', CLI, ...args], { stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited
  ])
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode }
}

async function probeAnimation(path: string): Promise<{
  streams: Array<{ width?: number; height?: number; nb_read_frames?: string; codec_name?: string }>
  format: { duration?: string }
}> {
  const process = Bun.spawn(
    [
      'ffprobe',
      '-v',
      'error',
      '-count_frames',
      '-show_entries',
      'stream=codec_name,width,height,nb_read_frames:format=duration',
      '-of',
      'json',
      path
    ],
    { stdout: 'pipe', stderr: 'pipe' }
  )
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited
  ])
  if (exitCode !== 0) throw new Error(stderr)
  return JSON.parse(stdout)
}

heavy('motion export CLI', () => {
  const dir = join(tmpdir(), `op-motion-export-${randomUUID()}`)
  const fixture = join(dir, 'motion.fig')
  const output = join(dir, 'frames')
  let nodeId = ''

  beforeAll(async () => {
    await mkdir(dir, { recursive: true })
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const node = graph.createNode('RECTANGLE', page.id, {
      name: 'Animated card',
      width: 40,
      height: 30,
      fills: [
        {
          type: 'SOLID',
          color: { r: 1, g: 0, b: 0, a: 1 },
          opacity: 1,
          visible: true
        }
      ],
      motion: {
        version: 1,
        tracks: [
          {
            id: 'move',
            trigger: 'mount',
            keyframes: [
              { offset: 0, x: 0 },
              { offset: 1, x: 20 }
            ],
            timing: { durationMs: 100, easing: 'linear' }
          }
        ]
      }
    })
    const encoded = await io.writeDocument('fig', graph)
    await Bun.write(fixture, encoded.data as Uint8Array)
    const found = await run(['find', fixture, '--name', node.name, '--json'])
    nodeId = (JSON.parse(found.stdout) as Array<{ id: string }>)[0]?.id ?? ''
    if (!nodeId) throw new Error('Motion export fixture node was not imported')
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test('writes an atomic PNG sequence and machine-readable manifest', async () => {
    const result = await run([
      'motion',
      'export',
      fixture,
      '--node',
      nodeId,
      '--fps',
      '20',
      '--padding',
      '30',
      '--json',
      '-o',
      output
    ])

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    const report = JSON.parse(result.stdout) as {
      format: string
      output: { output: string }
      manifest: { fps: number; frameCount: number }
    }
    expect(report).toMatchObject({
      format: 'png-sequence',
      output: { output },
      manifest: { fps: 20, frameCount: 2 }
    })
    expect(await readdir(output)).toEqual(['frame-0000.png', 'frame-0001.png', 'manifest.json'])
    expect([
      ...new Uint8Array(await readFile(join(output, 'frame-0000.png'))).subarray(0, 8)
    ]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

    const second = await run(['motion', 'export', fixture, '--node', nodeId, '-o', output])
    expect(second.exitCode).toBe(1)
    expect(second.stderr).toContain('Output already exists')
    expect(await readdir(output)).toContain('manifest.json')
  })

  test('writes a real built-in GIF without FFmpeg', async () => {
    const destination = join(dir, 'animation.gif')
    const result = await run([
      'motion',
      'export',
      fixture,
      '--node',
      nodeId,
      '--format',
      'gif',
      '--fps',
      '20',
      '--ffmpeg',
      join(dir, 'missing-ffmpeg'),
      '-o',
      destination
    ])

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect((await readFile(destination)).subarray(0, 6).toString('ascii')).toBe('GIF89a')
    const inspected = await probeAnimation(destination)
    expect(inspected.streams[0]).toMatchObject({
      codec_name: 'gif',
      width: 50,
      height: 30,
      nb_read_frames: '2'
    })
    expect(Number(inspected.format.duration)).toBeCloseTo(0.1, 3)
  })

  test('publishes exactly one complete encoded file when CLI writers race', async () => {
    const destination = join(dir, 'race.gif')
    const args = [
      'motion',
      'export',
      fixture,
      '--node',
      nodeId,
      '--format',
      'gif',
      '--fps',
      '20',
      '-o',
      destination
    ]

    const results = await Promise.all([run(args), run(args)])

    expect(results.filter(({ exitCode }) => exitCode === 0)).toHaveLength(1)
    expect(results.filter(({ exitCode }) => exitCode === 1)).toHaveLength(1)
    expect(results.find(({ exitCode }) => exitCode === 1)?.stderr).toContain('already exists')
    expect((await readFile(destination)).subarray(0, 6).toString('ascii')).toBe('GIF89a')
    expect((await readdir(dir)).filter((name) => name.includes('.race.gif.tmp-'))).toEqual([])
  })

  test('writes real FFmpeg WebM and MP4 files when their codecs are available', async () => {
    const discovered = await discoverFfmpegMotionEncoders()
    if (!discovered.available) return
    for (const format of ['webm', 'mp4'] as const) {
      if (!discovered.encoders.some((encoder) => encoder.format === format)) continue
      const destination = join(dir, `animation.${format}`)
      const result = await run([
        'motion',
        'export',
        fixture,
        '--node',
        nodeId,
        '--format',
        format,
        '--fps',
        '20',
        '--json',
        '-o',
        destination
      ])

      expect(result.exitCode).toBe(0)
      expect(result.stderr).toBe('')
      const report = JSON.parse(result.stdout) as {
        format: string
        encoded: { alpha: string; plan: { frameCount: number } }
        capabilities: Array<{ format: string; available: boolean; alpha?: string }>
      }
      expect(report.format).toBe(format)
      expect(report.encoded).toMatchObject({ alpha: 'opaque-only', plan: { frameCount: 2 } })
      expect(report.capabilities.find((capability) => capability.format === format)).toMatchObject({
        available: true,
        alpha: 'opaque-only'
      })
      const bytes = await readFile(destination)
      if (format === 'webm') expect([...bytes.subarray(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3])
      else expect(bytes.subarray(4, 8).toString('ascii')).toBe('ftyp')
      const inspected = await probeAnimation(destination)
      expect(inspected.streams[0]?.width).toBe(50)
      expect(inspected.streams[0]?.height).toBe(30)
      expect(inspected.streams[0]?.nb_read_frames).toBe('2')
      expect(Number(inspected.format.duration)).toBeCloseTo(0.1, 2)
    }
  })

  test('fails closed when the requested WebM encoder executable is unavailable', async () => {
    const result = await run([
      'motion',
      'export',
      fixture,
      '--node',
      nodeId,
      '--format',
      'webm',
      '--ffmpeg',
      join(dir, 'missing-ffmpeg'),
      '-o',
      join(dir, 'unavailable.webm')
    ])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('no WebM encoder is registered')
  })
})
