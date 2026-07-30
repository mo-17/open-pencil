import { afterEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { getEventListeners } from 'node:events'
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import {
  createMotionPngSequenceManifest,
  MotionExportCancelledError,
  planMotionFrames,
  type MotionRenderedFrame
} from '@open-pencil/core/io/motion-export'
import {
  discoverFfmpegMotionEncoders,
  encodeMotionPngSequenceToolResult
} from '@open-pencil/mcp/motion-export'

import { writeToolOutput } from '#mcp/tool/output'
import { registerTools, type ToolRequestExtra } from '#mcp/tool/registration'

const root = join(tmpdir(), `open-pencil-mcp-motion-encode-${randomUUID()}`)
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
  'base64'
)

function pngSequenceResult(): Record<string, unknown> {
  const { plan, frames } = renderedPngSequence()
  return {
    format: 'png-sequence',
    manifest: createMotionPngSequenceManifest(plan, frames),
    frames: frames.map((frame) => ({
      file: frame.fileName,
      base64: PNG.toString('base64'),
      byteLength: PNG.length
    })),
    issues: []
  }
}

function renderedPngSequence(
  durationMs = 100,
  fps = 20
): {
  plan: ReturnType<typeof planMotionFrames>
  frames: MotionRenderedFrame[]
} {
  const plan = planMotionFrames({ durationMs, fps, width: 1, height: 1 })
  const frames: MotionRenderedFrame[] = plan.frames.map((frame) => ({
    ...frame,
    mimeType: 'image/png',
    bytes: new Uint8Array(PNG),
    byteLength: PNG.length
  }))
  return { plan, frames }
}

async function fakeFfmpeg(name: string, source: string): Promise<string> {
  await mkdir(root, { recursive: true })
  const executable = join(root, name)
  await writeFile(executable, `#!/usr/bin/env bun\n${source}\n`, 'utf8')
  await chmod(executable, 0o755)
  return executable
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('MCP platform Motion encoding', () => {
  test('fails closed when the configured FFmpeg executable cannot be probed', async () => {
    const discovery = await discoverFfmpegMotionEncoders({ executable: join(root, 'missing') })
    expect(discovery.available).toBe(false)
    expect(discovery.encoders).toEqual([])
    expect(discovery.reason).toBeTruthy()
  })

  test('escalates a probe that ignores SIGTERM and awaits child close', async () => {
    if (process.platform === 'win32') return
    const pidFile = join(root, 'probe-pids.txt')
    const executable = await fakeFfmpeg(
      'ffmpeg-probe-hang',
      `import { appendFileSync } from 'node:fs'
appendFileSync(${JSON.stringify(pidFile)}, String(process.pid) + '\\n')
process.on('SIGTERM', () => undefined)
setInterval(() => undefined, 1_000)`
    )
    const started = Date.now()
    const discovery = await discoverFfmpegMotionEncoders({
      executable,
      timeoutMs: 25,
      terminationGraceMs: 25
    })

    expect(discovery.available).toBe(false)
    expect(discovery.reason).toContain('timed out')
    expect(Date.now() - started).toBeLessThan(2_000)
    const pids = (await readFile(pidFile, 'utf8')).trim().split(/\s+/).map(Number)
    expect(pids.length).toBe(2)
    expect(pids.every((pid) => !processIsAlive(pid))).toBe(true)
  })

  test('SIGKILLs an encoder that ignores SIGTERM without leaking abort listeners', async () => {
    if (process.platform === 'win32') return
    const pidFile = join(root, 'encoder-pid.txt')
    const executable = await fakeFfmpeg(
      'ffmpeg-encode-hang',
      `import { appendFileSync } from 'node:fs'
const args = process.argv.slice(2)
if (args.includes('-version')) {
  console.log('ffmpeg version openpencil-test')
  process.exit(0)
}
if (args.includes('-encoders')) {
  console.log(' V..... libvpx Fake VP8 encoder')
  process.exit(0)
}
appendFileSync(${JSON.stringify(pidFile)}, String(process.pid) + '\\n')
process.on('SIGTERM', () => undefined)
process.stdin.resume()
process.stderr.write('frame=1\\n')
setInterval(() => undefined, 1_000)`
    )
    const discovery = await discoverFfmpegMotionEncoders({
      executable,
      timeoutMs: 500,
      terminationGraceMs: 25
    })
    const encoder = discovery.encoders.find((candidate) => candidate.format === 'webm')
    expect(encoder).toBeDefined()
    const controller = new AbortController()
    const started = Date.now()
    const abort = setTimeout(() => controller.abort(), 25)
    try {
      await expect(
        encoder?.encode({ ...renderedPngSequence(), signal: controller.signal })
      ).rejects.toBeInstanceOf(MotionExportCancelledError)
    } finally {
      clearTimeout(abort)
    }

    expect(Date.now() - started).toBeLessThan(2_000)
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0)
    const pid = Number((await readFile(pidFile, 'utf8')).trim())
    expect(processIsAlive(pid)).toBe(false)
  })

  test('does not hang if the probed FFmpeg executable disappears before encode', async () => {
    const executable = await fakeFfmpeg(
      'ffmpeg-disappears',
      `const args = process.argv.slice(2)
if (args.includes('-version')) {
  console.log('ffmpeg version openpencil-test')
  process.exit(0)
}
if (args.includes('-encoders')) {
  console.log(' V..... libvpx Fake VP8 encoder')
  process.exit(0)
}
process.exit(1)`
    )
    const discovery = await discoverFfmpegMotionEncoders({ executable, timeoutMs: 500 })
    const encoder = discovery.encoders.find((candidate) => candidate.format === 'webm')
    expect(encoder).toBeDefined()
    await rm(executable)

    const timeout = Symbol('encode-timeout')
    let timer: ReturnType<typeof setTimeout> | undefined
    const result = await Promise.race([
      encoder?.encode(renderedPngSequence()).then(
        () => null,
        (error: unknown) => error
      ),
      new Promise<typeof timeout>((resolve) => {
        timer = setTimeout(() => resolve(timeout), 1_000)
      })
    ])
    if (timer) clearTimeout(timer)
    expect(result).not.toBe(timeout)
    expect(result).toBeInstanceOf(Error)
  })

  test('validates the reconstructed fixed timebase before invoking an encoder', async () => {
    const discovery = await discoverFfmpegMotionEncoders()
    const encoder = discovery.encoders.find((candidate) => candidate.format === 'webm')
    if (!encoder) return
    const malformed = pngSequenceResult()
    ;(malformed.manifest as { totalDurationUs: number }).totalDurationUs++
    await expect(encodeMotionPngSequenceToolResult(malformed, encoder)).rejects.toThrow(
      'timing does not match'
    )
  })

  test('honors cancellation before spawning the platform encoder', async () => {
    const discovery = await discoverFfmpegMotionEncoders()
    const encoder = discovery.encoders.find((candidate) => candidate.format === 'webm')
    if (!encoder) return
    const controller = new AbortController()
    controller.abort()
    await expect(
      encodeMotionPngSequenceToolResult(pngSequenceResult(), encoder, controller.signal)
    ).rejects.toBeInstanceOf(MotionExportCancelledError)
  })

  test('terminates an active FFmpeg encoder when cancellation arrives', async () => {
    const discovery = await discoverFfmpegMotionEncoders()
    const encoder = discovery.encoders.find((candidate) => candidate.format === 'webm')
    if (!encoder) return
    const { plan, frames } = renderedPngSequence()
    const controller = new AbortController()
    let reported = false
    await expect(
      encoder.encode({
        plan,
        frames,
        signal: controller.signal,
        onProgress(progress) {
          if (progress.completed > 0) {
            reported = true
            controller.abort()
          }
        }
      })
    ).rejects.toBeInstanceOf(MotionExportCancelledError)
    expect(reported).toBe(true)
  })

  test('encodes and atomically writes a real WebM under the MCP root', async () => {
    const discovery = await discoverFfmpegMotionEncoders()
    const encoder = discovery.encoders.find((candidate) => candidate.format === 'webm')
    if (!encoder) return
    await mkdir(root, { recursive: true })
    const encoded = await encodeMotionPngSequenceToolResult(pngSequenceResult(), encoder)
    const result = await writeToolOutput('export_motion_animation', encoded, 'animation.webm', root)

    expect(result?.isError).toBeUndefined()
    const bytes = await readFile(join(root, 'animation.webm'))
    expect([...bytes.subarray(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3])
    const probe = Bun.spawn(
      [
        'ffprobe',
        '-v',
        'error',
        '-count_frames',
        '-show_entries',
        'stream=width,height,nb_read_frames:format=duration',
        '-of',
        'json',
        join(root, 'animation.webm')
      ],
      { stdout: 'pipe', stderr: 'pipe' }
    )
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(probe.stdout).text(),
      new Response(probe.stderr).text(),
      probe.exited
    ])
    expect(stderr).toBe('')
    expect(exitCode).toBe(0)
    expect(JSON.parse(stdout)).toMatchObject({
      streams: [{ width: 1, height: 1, nb_read_frames: '2' }],
      format: { duration: '0.100000' }
    })
  })

  test('preserves a partial final frame as an exact WebM duration', async () => {
    const discovery = await discoverFfmpegMotionEncoders()
    const encoder = discovery.encoders.find((candidate) => candidate.format === 'webm')
    if (!encoder) return
    const { plan, frames } = renderedPngSequence(110, 20)
    const bytes = await encoder.encode({ plan, frames })
    await mkdir(root, { recursive: true })
    const output = join(root, 'partial-frame.webm')
    await writeFile(output, bytes)

    const probe = Bun.spawn(
      [
        'ffprobe',
        '-v',
        'error',
        '-count_frames',
        '-show_entries',
        'stream=width,height,nb_read_frames:format=duration',
        '-of',
        'json',
        output
      ],
      { stdout: 'pipe', stderr: 'pipe' }
    )
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(probe.stdout).text(),
      new Response(probe.stderr).text(),
      probe.exited
    ])
    expect(stderr).toBe('')
    expect(exitCode).toBe(0)
    expect(JSON.parse(stdout)).toMatchObject({
      streams: [{ width: 1, height: 1, nb_read_frames: '3' }],
      format: { duration: '0.110000' }
    })
  })

  test('rejects partial-final-frame MP4 plans instead of extending their duration', async () => {
    const discovery = await discoverFfmpegMotionEncoders()
    const encoder = discovery.encoders.find((candidate) => candidate.format === 'mp4')
    if (!encoder) return
    const { plan, frames } = renderedPngSequence(110, 20)
    await expect(encoder.encode({ plan, frames })).rejects.toThrow(
      'requires a duration aligned to a whole frame'
    )
  })

  test('preserves odd Motion dimensions with a capable MP4 encoder', async () => {
    const discovery = await discoverFfmpegMotionEncoders()
    const encoder = discovery.encoders.find(
      (candidate) => candidate.format === 'mp4' && candidate.capability.includes('libx264')
    )
    if (!encoder) return
    const { plan, frames } = renderedPngSequence()
    const bytes = await encoder.encode({ plan, frames })
    await mkdir(root, { recursive: true })
    const output = join(root, 'odd.mp4')
    await writeFile(output, bytes)

    expect(new TextDecoder().decode(bytes.subarray(4, 8))).toBe('ftyp')
    const probe = Bun.spawn(
      [
        'ffprobe',
        '-v',
        'error',
        '-count_frames',
        '-show_entries',
        'stream=width,height,nb_read_frames:format=duration',
        '-of',
        'json',
        output
      ],
      { stdout: 'pipe', stderr: 'pipe' }
    )
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(probe.stdout).text(),
      new Response(probe.stderr).text(),
      probe.exited
    ])
    expect(stderr).toBe('')
    expect(exitCode).toBe(0)
    expect(JSON.parse(stdout)).toMatchObject({
      streams: [{ width: 1, height: 1, nb_read_frames: '2' }],
      format: { duration: '0.100000' }
    })
  })

  test('routes an encoded MCP request through app PNG rendering and Node encoding', async () => {
    const discovery = await discoverFfmpegMotionEncoders()
    if (!discovery.encoders.some((candidate) => candidate.format === 'webm')) return
    await mkdir(root, { recursive: true })
    const handlers = new Map<
      string,
      (args: Record<string, unknown>, extra?: { signal?: AbortSignal }) => Promise<unknown>
    >()
    const server = Object.create(McpServer.prototype) as McpServer
    Object.defineProperty(server, 'registerTool', {
      value(
        name: string,
        _definition: unknown,
        handler: (
          args: Record<string, unknown>,
          extra?: { signal?: AbortSignal }
        ) => Promise<unknown>
      ) {
        handlers.set(name, handler)
      }
    })
    let rpcArgs: Record<string, unknown> | undefined
    registerTools(server, {
      enableEval: false,
      mcpRoot: root,
      async sendRpc(body: Record<string, unknown>) {
        rpcArgs = body
        return { ok: true, result: pngSequenceResult() }
      }
    })
    const handler = handlers.get('export_motion_animation')
    expect(handler).toBeDefined()
    const response = await handler?.({
      ids: ['1:2'],
      format: 'webm',
      path: 'from-tool.webm',
      fps: 20
    })

    expect(rpcArgs).toMatchObject({
      command: 'tool',
      args: {
        name: 'export_motion_animation',
        args: { ids: ['1:2'], format: 'png-sequence', path: 'from-tool.webm', fps: 20 }
      }
    })
    expect(response).toMatchObject({ content: [{ type: 'text' }] })
    expect([
      ...new Uint8Array(await readFile(join(root, 'from-tool.webm'))).subarray(0, 4)
    ]).toEqual([0x1a, 0x45, 0xdf, 0xa3])
  })

  test('propagates MCP cancellation and progress through the app RPC render', async () => {
    await mkdir(root, { recursive: true })
    const handlers = new Map<
      string,
      (args: Record<string, unknown>, extra?: ToolRequestExtra) => Promise<unknown>
    >()
    const server = Object.create(McpServer.prototype) as McpServer
    Object.defineProperty(server, 'registerTool', {
      value(
        name: string,
        _definition: unknown,
        handler: (args: Record<string, unknown>, extra?: ToolRequestExtra) => Promise<unknown>
      ) {
        handlers.set(name, handler)
      }
    })
    const controller = new AbortController()
    let rpcSignal: AbortSignal | undefined
    const notifications: Record<string, unknown>[] = []
    registerTools(server, {
      enableEval: false,
      mcpRoot: root,
      async sendRpc(_body, options) {
        rpcSignal = options?.signal
        options?.onProgress?.({ phase: 'render', completed: 1, total: 2, frameIndex: 0 })
        return { ok: true, result: pngSequenceResult() }
      }
    })

    await handlers.get('export_motion_animation')?.(
      {
        ids: ['1:2'],
        format: 'png-sequence',
        path: 'progress-frames',
        fps: 20
      },
      {
        signal: controller.signal,
        _meta: { progressToken: 'motion-progress' },
        async sendNotification(notification) {
          notifications.push(notification)
        }
      }
    )

    expect(rpcSignal).toBe(controller.signal)
    expect(notifications).toContainEqual({
      method: 'notifications/progress',
      params: {
        progressToken: 'motion-progress',
        progress: 1,
        total: 2,
        message: 'Motion export render'
      }
    })
  })

  test('preserves AbortError from app RPC instead of converting cancellation to a tool result', async () => {
    const handlers = new Map<
      string,
      (args: Record<string, unknown>, extra?: ToolRequestExtra) => Promise<unknown>
    >()
    const server = Object.create(McpServer.prototype) as McpServer
    Object.defineProperty(server, 'registerTool', {
      value(
        name: string,
        _definition: unknown,
        handler: (args: Record<string, unknown>, extra?: ToolRequestExtra) => Promise<unknown>
      ) {
        handlers.set(name, handler)
      }
    })
    const controller = new AbortController()
    controller.abort()
    const cancellation = new Error('cancelled')
    cancellation.name = 'AbortError'
    let forwardedSignal: AbortSignal | undefined
    registerTools(server, {
      enableEval: false,
      async sendRpc(_body, options) {
        forwardedSignal = options?.signal
        throw cancellation
      }
    })

    const handler = handlers.get('get_selection')
    expect(handler).toBeDefined()
    await expect(handler?.({}, { signal: controller.signal })).rejects.toBe(cancellation)
    expect(forwardedSignal).toBe(controller.signal)
  })
})
