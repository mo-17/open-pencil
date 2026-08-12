import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  MotionExportCancelledError,
  muxMotionWebm,
  type MotionAnimationEncoder,
  type MotionAnimationEncoderInput,
  type MotionFramePlan,
  type MotionWebmVideoCodec,
  type MotionWebmVideoFrame
} from '@open-pencil/core/io/motion-export'

const PROBE_TIMEOUT_MS = 5_000
const TERMINATION_GRACE_MS = 750
const STDERR_LIMIT = 64 * 1_024

export interface FfmpegMotionEncoderDiscoveryOptions {
  /** Executed directly without a shell. Defaults to OPENPENCIL_FFMPEG_PATH or `ffmpeg`. */
  executable?: string
  timeoutMs?: number
  /** Graceful SIGTERM window before SIGKILL. Primarily configurable for hosts and tests. */
  terminationGraceMs?: number
}

export interface FfmpegMotionEncoderDiscovery {
  readonly executable: string
  readonly available: boolean
  readonly version?: string
  readonly encoders: readonly MotionAnimationEncoder[]
  readonly reason?: string
}

interface FfmpegProbe {
  executable: string
  version: string
  encoderNames: Set<string>
}

interface ChildCompletion {
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
  readonly error?: Error
}

function executableFromOptions(options: FfmpegMotionEncoderDiscoveryOptions): string {
  const configured = options.executable?.trim() || process.env.OPENPENCIL_FFMPEG_PATH?.trim()
  return configured || 'ffmpeg'
}

function cancellationError(signal?: AbortSignal): MotionExportCancelledError | null {
  return signal?.aborted ? new MotionExportCancelledError() : null
}

function appendBounded(current: string, chunk: Uint8Array | string): string {
  const next = current + String(chunk)
  return next.length <= STDERR_LIMIT ? next : next.slice(next.length - STDERR_LIMIT)
}

function observeChild(child: ChildProcess): Promise<ChildCompletion> {
  return new Promise((resolve) => {
    let spawnError: Error | undefined
    const onError = (error: Error): void => {
      spawnError = error
    }
    const onClose = (code: number | null, signal: NodeJS.Signals | null): void => {
      child.removeListener('error', onError)
      resolve({ code, signal, ...(spawnError ? { error: spawnError } : {}) })
    }
    child.on('error', onError)
    child.once('close', onClose)
  })
}

async function terminateChild(
  child: ChildProcess,
  completion: Promise<ChildCompletion>,
  graceMs: number
): Promise<ChildCompletion> {
  child.stdin?.destroy()
  child.kill('SIGTERM')
  let timer: ReturnType<typeof setTimeout> | undefined
  const graceElapsed = new Promise<true>((resolve) => {
    timer = setTimeout(() => resolve(true), Math.max(1, graceMs))
  })
  const timedOut = await Promise.race([completion.then(() => false as const), graceElapsed])
  if (timer) clearTimeout(timer)
  if (timedOut) child.kill('SIGKILL')
  return completion
}

async function runProbe(
  executable: string,
  args: readonly string[],
  timeoutMs: number,
  terminationGraceMs: number
): Promise<string> {
  const child = spawn(executable, [...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  })
  const completion = observeChild(child)
  let output = ''
  const appendOutput = (chunk: Uint8Array): void => {
    output = appendBounded(output, chunk)
  }
  child.stdout.on('data', appendOutput)
  child.stderr.on('data', appendOutput)
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = Symbol('probe-timeout')
  try {
    const outcome = await Promise.race([
      completion,
      new Promise<typeof timedOut>((resolve) => {
        timer = setTimeout(() => resolve(timedOut), Math.max(1, timeoutMs))
      })
    ])
    if (outcome === timedOut) {
      await terminateChild(child, completion, terminationGraceMs)
      throw new Error(`FFmpeg capability probe timed out after ${timeoutMs} ms`)
    }
    if (outcome.error) throw outcome.error
    if (outcome.code === 0) return output
    throw new Error(output.trim() || `FFmpeg exited with code ${outcome.code ?? 'unknown'}`)
  } finally {
    if (timer) clearTimeout(timer)
    child.stdout.removeListener('data', appendOutput)
    child.stderr.removeListener('data', appendOutput)
  }
}

async function probeFfmpeg(
  options: FfmpegMotionEncoderDiscoveryOptions = {}
): Promise<FfmpegProbe> {
  const executable = executableFromOptions(options)
  const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS
  const terminationGraceMs = options.terminationGraceMs ?? TERMINATION_GRACE_MS
  const probes = await Promise.allSettled([
    runProbe(executable, ['-hide_banner', '-version'], timeoutMs, terminationGraceMs),
    runProbe(executable, ['-hide_banner', '-encoders'], timeoutMs, terminationGraceMs)
  ])
  const failed = probes.find((probe): probe is PromiseRejectedResult => probe.status === 'rejected')
  if (failed) throw failed.reason
  const [versionOutput, encoderOutput] = probes.map(
    (probe) => (probe as PromiseFulfilledResult<string>).value
  )
  const version = versionOutput.split(/\r?\n/, 1)[0].trim()
  if (!version.toLowerCase().startsWith('ffmpeg version ')) {
    throw new Error('Configured executable did not identify itself as FFmpeg')
  }
  const encoderNames = new Set<string>()
  for (const line of encoderOutput.split(/\r?\n/)) {
    const match = /^\s*[A-Z.]{6}\s+(\S+)/.exec(line)
    if (match) encoderNames.add(match[1])
  }
  return { executable, version, encoderNames }
}

function firstAvailable(names: Set<string>, candidates: readonly string[]): string | undefined {
  return candidates.find((candidate) => names.has(candidate))
}

function ffmpegOutputArgs(
  format: 'webm' | 'mp4',
  codec: string,
  fps: number,
  width: number,
  height: number
): string[] {
  if (format === 'webm') {
    const codecOptions = codec.startsWith('libvpx')
      ? ['-deadline', 'good', '-cpu-used', '4', '-row-mt', '0']
      : []
    return [
      '-an',
      '-c:v',
      codec,
      ...codecOptions,
      '-pix_fmt',
      'yuv420p',
      '-fps_mode',
      'passthrough',
      '-g',
      String(Math.max(1, fps * 2)),
      '-f',
      'ivf'
    ]
  }
  const pixelFormat =
    codec === 'libx264' && (width % 2 !== 0 || height % 2 !== 0) ? 'yuv444p' : 'yuv420p'
  return [
    '-an',
    '-c:v',
    codec,
    '-pix_fmt',
    pixelFormat,
    '-fps_mode',
    'cfr',
    '-r',
    String(fps),
    '-movflags',
    '+faststart',
    '-f',
    'mp4'
  ]
}

function childClosedBeforeInput(outcome: ChildCompletion): Error {
  if (outcome.error) return outcome.error
  return new Error(
    `FFmpeg closed its input before all Motion frames were written (code ${outcome.code ?? 'unknown'}${outcome.signal ? `, signal ${outcome.signal}` : ''})`
  )
}

async function waitForDrain(
  stream: NodeJS.WritableStream,
  completion: Promise<ChildCompletion>,
  signal?: AbortSignal
): Promise<void> {
  const cancelled = cancellationError(signal)
  if (cancelled) throw cancelled
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const cleanup = (): void => {
      stream.removeListener('drain', onDrain)
      stream.removeListener('error', onError)
      signal?.removeEventListener('abort', onAbort)
    }
    const finish = (callback: () => void): void => {
      if (settled) return
      settled = true
      cleanup()
      callback()
    }
    const onDrain = (): void => {
      finish(resolve)
    }
    const onError = (error: Error): void => {
      finish(() => reject(error))
    }
    const onAbort = (): void => {
      finish(() => reject(new MotionExportCancelledError()))
    }
    stream.once('drain', onDrain)
    stream.once('error', onError)
    signal?.addEventListener('abort', onAbort, { once: true })
    void completion.then((outcome) => {
      finish(() => reject(childClosedBeforeInput(outcome)))
      return undefined
    })
  })
}

async function feedPNGFrames(
  input: MotionAnimationEncoderInput,
  stdin: NodeJS.WritableStream,
  completion: Promise<ChildCompletion>
): Promise<void> {
  for (const frame of input.frames) {
    const cancelled = cancellationError(input.signal)
    if (cancelled) throw cancelled
    const accepted = stdin.write(frame.bytes)
    if (!accepted) await waitForDrain(stdin, completion, input.signal)
  }
  stdin.end()
}

interface IvfVideo {
  readonly codec: MotionWebmVideoCodec
  readonly frames: readonly MotionWebmVideoFrame[]
}

function readIvfTimestamp(view: DataView, offset: number): bigint {
  return BigInt(view.getUint32(offset, true)) | (BigInt(view.getUint32(offset + 4, true)) << 32n)
}

function ivfCodec(fourcc: string): MotionWebmVideoCodec {
  if (fourcc === 'VP80') return 'vp8'
  if (fourcc === 'VP90') return 'vp9'
  throw new Error(`FFmpeg produced unsupported IVF codec ${JSON.stringify(fourcc)}`)
}

function parseIvfVideo(bytes: Uint8Array, plan: MotionFramePlan): IvfVideo {
  if (bytes.length < 32 || new TextDecoder().decode(bytes.subarray(0, 4)) !== 'DKIF') {
    throw new Error('FFmpeg did not produce a valid IVF video')
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const version = view.getUint16(4, true)
  const headerLength = view.getUint16(6, true)
  if (version !== 0 || headerLength < 32 || headerLength > bytes.length) {
    throw new Error('FFmpeg produced an unsupported IVF header')
  }
  const fourcc = new TextDecoder().decode(bytes.subarray(8, 12))
  const codec = ivfCodec(fourcc)
  if (
    view.getUint16(12, true) !== plan.pixelWidth ||
    view.getUint16(14, true) !== plan.pixelHeight
  ) {
    throw new Error('FFmpeg IVF dimensions do not match the fixed Motion export canvas')
  }
  const declaredFrameCount = view.getUint32(24, true)
  if (declaredFrameCount !== 0 && declaredFrameCount !== plan.frameCount) {
    throw new Error(
      `FFmpeg IVF declared ${declaredFrameCount} frames for a ${plan.frameCount}-frame Motion plan`
    )
  }

  const payloads: Uint8Array[] = []
  let offset = headerLength
  let previousTimestamp = -1n
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new Error('FFmpeg produced a truncated IVF frame header')
    const byteLength = view.getUint32(offset, true)
    const timestamp = readIvfTimestamp(view, offset + 4)
    const start = offset + 12
    const end = start + byteLength
    if (byteLength === 0 || end > bytes.length) {
      throw new Error('FFmpeg produced a truncated or empty IVF frame')
    }
    if (timestamp <= previousTimestamp) {
      throw new Error('FFmpeg produced non-monotonic IVF frame timestamps')
    }
    previousTimestamp = timestamp
    payloads.push(bytes.slice(start, end))
    offset = end
  }
  if (payloads.length !== plan.frameCount) {
    throw new Error(
      `FFmpeg produced ${payloads.length} IVF frames for a ${plan.frameCount}-frame Motion plan`
    )
  }
  return {
    codec,
    frames: payloads.map((payload, index) => ({
      timestampUs: plan.frames[index].timestampUs,
      durationUs: plan.frames[index].durationUs,
      keyFrame: index === 0,
      bytes: payload
    }))
  }
}

function hasPartialFinalFrame(plan: MotionFramePlan): boolean {
  return (plan.totalDurationUs * plan.fps) % 1_000_000 !== 0
}

async function encodeWithFfmpeg(
  input: MotionAnimationEncoderInput,
  executable: string,
  format: 'webm' | 'mp4',
  codec: string,
  terminationGraceMs: number
): Promise<Uint8Array> {
  const cancelled = cancellationError(input.signal)
  if (cancelled) throw cancelled
  if (format === 'mp4' && hasPartialFinalFrame(input.plan)) {
    throw new Error(
      'FFmpeg MP4 export requires a duration aligned to a whole frame; choose WebM or adjust duration/fps'
    )
  }
  const temporary = await mkdtemp(join(tmpdir(), 'open-pencil-motion-ffmpeg-'))
  const output = join(temporary, format === 'webm' ? 'animation.ivf' : 'animation.mp4')
  try {
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-f',
      'image2pipe',
      '-framerate',
      String(input.plan.fps),
      '-vcodec',
      'png',
      '-i',
      'pipe:0',
      '-frames:v',
      String(input.plan.frameCount),
      ...ffmpegOutputArgs(
        format,
        codec,
        input.plan.fps,
        input.plan.pixelWidth,
        input.plan.pixelHeight
      ),
      '-progress',
      'pipe:2',
      '-y',
      output
    ]
    const child = spawn(executable, args, { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true })
    const completion = observeChild(child)
    let stderr = ''
    let progressBuffer = ''
    let stopping: Promise<ChildCompletion> | undefined
    const stop = (): Promise<ChildCompletion> => {
      stopping ??= terminateChild(child, completion, terminationGraceMs)
      return stopping
    }
    const abort = (): void => {
      void stop()
    }
    input.signal?.addEventListener('abort', abort, { once: true })
    if (input.signal?.aborted) abort()
    const onStderr = (chunk: Uint8Array): void => {
      const text = String(chunk)
      stderr = appendBounded(stderr, text)
      progressBuffer = appendBounded(progressBuffer, text)
      let newline = progressBuffer.indexOf('\n')
      while (newline !== -1) {
        const line = progressBuffer.slice(0, newline).trim()
        progressBuffer = progressBuffer.slice(newline + 1)
        const frameMatch = /^frame=(\d+)$/.exec(line)
        if (frameMatch) {
          input.onProgress?.({
            phase: 'encode',
            completed: Math.min(Number(frameMatch[1]), input.plan.frameCount),
            total: input.plan.frameCount
          })
        }
        newline = progressBuffer.indexOf('\n')
      }
    }
    const ignoreStdinError = (): void => undefined
    child.stderr.on('data', onStderr)
    child.stdin.on('error', ignoreStdinError)

    try {
      await feedPNGFrames(input, child.stdin, completion)
      const outcome = await completion
      const aborted = cancellationError(input.signal)
      if (aborted) throw aborted
      if (outcome.error) throw outcome.error
      if (outcome.code !== 0) {
        throw new Error(
          `FFmpeg ${format} encoder exited with code ${outcome.code ?? 'unknown'}${stderr.trim() ? `: ${stderr.trim()}` : ''}`
        )
      }
    } catch (error) {
      await stop()
      const aborted = cancellationError(input.signal)
      if (aborted) throw aborted
      throw error
    } finally {
      input.signal?.removeEventListener('abort', abort)
      child.stderr.removeListener('data', onStderr)
      child.stdin.removeListener('error', ignoreStdinError)
    }
    const bytes = new Uint8Array(await readFile(output))
    if (bytes.length === 0) throw new Error(`FFmpeg produced an empty ${format} file`)
    const aborted = cancellationError(input.signal)
    if (aborted) throw aborted
    if (format === 'mp4') return bytes
    const video = parseIvfVideo(bytes, input.plan)
    return muxMotionWebm(input.plan, video.frames, video.codec)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

function createEncoder(
  probe: FfmpegProbe,
  format: 'webm' | 'mp4',
  codec: string,
  terminationGraceMs: number
): MotionAnimationEncoder {
  const shortVersion = probe.version.replace(/^ffmpeg version\s+/i, '').split(/\s+/, 1)[0]
  return {
    format,
    mimeType: format === 'webm' ? 'video/webm' : 'video/mp4',
    extension: format,
    capability:
      format === 'webm'
        ? `FFmpeg ${shortVersion} ${codec} + OpenPencil WebM muxer (fixed µs timebase; opaque-only)`
        : `FFmpeg ${shortVersion} ${codec} (frame-aligned MP4 timebase; opaque-only)`,
    alpha: 'opaque-only',
    determinism: 'timeline-exact',
    encode: (input) => encodeWithFfmpeg(input, probe.executable, format, codec, terminationGraceMs)
  }
}

/** Probe a real FFmpeg binary and expose only formats backed by listed video encoders. */
export async function discoverFfmpegMotionEncoders(
  options: FfmpegMotionEncoderDiscoveryOptions = {}
): Promise<FfmpegMotionEncoderDiscovery> {
  const executable = executableFromOptions(options)
  try {
    const probe = await probeFfmpeg(options)
    const encoders: MotionAnimationEncoder[] = []
    const terminationGraceMs = options.terminationGraceMs ?? TERMINATION_GRACE_MS
    const webmCodec = firstAvailable(probe.encoderNames, ['libvpx-vp9', 'libvpx', 'vp9', 'vp8'])
    if (webmCodec) encoders.push(createEncoder(probe, 'webm', webmCodec, terminationGraceMs))
    const mp4Codec = firstAvailable(probe.encoderNames, [
      'libx264',
      'h264_videotoolbox',
      'h264_nvenc',
      'h264_qsv',
      'libopenh264',
      'mpeg4'
    ])
    if (mp4Codec) encoders.push(createEncoder(probe, 'mp4', mp4Codec, terminationGraceMs))
    return {
      executable,
      available: true,
      version: probe.version,
      encoders,
      ...(encoders.length === 0
        ? { reason: 'FFmpeg is installed but no supported WebM or MP4 video encoder is listed' }
        : {})
    }
  } catch (error) {
    return {
      executable,
      available: false,
      encoders: [],
      reason: error instanceof Error ? error.message : String(error)
    }
  }
}
