import {
  MotionExportCancelledError,
  muxVp8Webm,
  type MotionAnimationEncoder,
  type MotionAnimationEncoderInput,
  type MotionWebmVideoFrame
} from '@open-pencil/core/io/motion-export'

export interface WebCodecsWebmCapabilityInput {
  readonly pixelWidth: number
  readonly pixelHeight: number
  readonly fps: number
}

export type WebCodecsWebmCapabilityResult =
  | { readonly supported: true; readonly encoder: MotionAnimationEncoder }
  | { readonly supported: false; readonly reason: string }

function webCodecsAvailable(): boolean {
  return (
    typeof VideoEncoder !== 'undefined' &&
    typeof VideoFrame !== 'undefined' &&
    typeof createImageBitmap === 'function'
  )
}

function encoderConfig(width: number, height: number, fps: number): VideoEncoderConfig {
  return {
    codec: 'vp8',
    width,
    height,
    displayWidth: width,
    displayHeight: height,
    framerate: fps,
    bitrate: Math.min(50_000_000, Math.max(250_000, width * height * fps * 2)),
    bitrateMode: 'variable',
    latencyMode: 'quality',
    hardwareAcceleration: 'no-preference',
    alpha: 'discard'
  }
}

async function supportedConfig(
  width: number,
  height: number,
  fps: number
): Promise<VideoEncoderConfig | null> {
  if (!webCodecsAvailable()) return null
  try {
    const support = await VideoEncoder.isConfigSupported(encoderConfig(width, height, fps))
    return support.supported && support.config ? support.config : null
  } catch {
    return null
  }
}

async function flushWithSignal(encoder: VideoEncoder, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    await encoder.flush()
    return
  }
  if (signal.aborted) throw new MotionExportCancelledError()
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      callback()
    }
    const onAbort = () => finish(() => reject(new MotionExportCancelledError()))
    signal.addEventListener('abort', onAbort, { once: true })
    void encoder
      .flush()
      .then(() => finish(resolve))
      .catch((cause: unknown) =>
        finish(() => reject(cause instanceof Error ? cause : new Error(String(cause))))
      )
  })
}

async function encodeWebm(input: MotionAnimationEncoderInput): Promise<Uint8Array> {
  const config = await supportedConfig(
    input.plan.pixelWidth,
    input.plan.pixelHeight,
    input.plan.fps
  )
  if (!config) throw new Error('WebCodecs VP8 is unavailable for these export dimensions')
  if (input.signal?.aborted) throw new MotionExportCancelledError()

  const chunks: MotionWebmVideoFrame[] = []
  const encoderErrors: DOMException[] = []
  const encoder = new VideoEncoder({
    output(chunk) {
      const bytes = new Uint8Array(chunk.byteLength)
      chunk.copyTo(bytes)
      const planned = input.plan.frames.find((frame) => frame.timestampUs === chunk.timestamp)
      if (!planned) {
        encoderErrors.push(
          new DOMException(
            `WebCodecs returned an unexpected timestamp ${chunk.timestamp}`,
            'EncodingError'
          )
        )
        return
      }
      chunks.push({
        timestampUs: chunk.timestamp,
        durationUs: chunk.duration ?? planned.durationUs,
        keyFrame: chunk.type === 'key',
        bytes
      })
    },
    error(error) {
      encoderErrors.push(error)
    }
  })
  encoder.configure(config)
  try {
    for (let index = 0; index < input.frames.length; index++) {
      if (input.signal?.aborted) throw new MotionExportCancelledError()
      const planned = input.plan.frames[index]
      const blobBytes = Uint8Array.from(input.frames[index].bytes)
      const bitmap = await createImageBitmap(new Blob([blobBytes], { type: 'image/png' }))
      try {
        if (bitmap.width !== input.plan.pixelWidth || bitmap.height !== input.plan.pixelHeight) {
          throw new Error(
            `WebM frame size ${bitmap.width}x${bitmap.height} does not match ${input.plan.pixelWidth}x${input.plan.pixelHeight}`
          )
        }
        const frame = new VideoFrame(bitmap, {
          timestamp: planned.timestampUs,
          duration: planned.durationUs,
          alpha: 'discard'
        })
        try {
          encoder.encode(frame, { keyFrame: index === 0 || index % (input.plan.fps * 2) === 0 })
        } finally {
          frame.close()
        }
      } finally {
        bitmap.close()
      }
      if (encoder.encodeQueueSize >= 32) {
        await flushWithSignal(encoder, input.signal)
      }
      input.onProgress?.({
        phase: 'encode',
        completed: index + 1,
        total: input.frames.length,
        frameIndex: index
      })
    }
    await flushWithSignal(encoder, input.signal)
    if (encoderErrors.length > 0) {
      throw new Error(encoderErrors[0].message, { cause: encoderErrors[0] })
    }
  } catch (error) {
    if (encoder.state === 'configured') encoder.reset()
    throw input.signal?.aborted ? new MotionExportCancelledError() : error
  } finally {
    if (encoder.state !== 'closed') encoder.close()
  }
  return muxVp8Webm(input.plan, chunks)
}

function webCodecsEncoder(): MotionAnimationEncoder {
  return {
    format: 'webm',
    mimeType: 'video/webm',
    extension: 'webm',
    capability: 'WebCodecs VP8 + OpenPencil WebM muxer (fixed µs timebase; opaque-only)',
    alpha: 'opaque-only',
    determinism: 'timeline-exact',
    encode: encodeWebm
  }
}

/** Probe the exact fixed canvas that Motion export will render. */
export async function probeWebCodecsWebmMotionEncoder(
  input: WebCodecsWebmCapabilityInput,
  signal?: AbortSignal
): Promise<WebCodecsWebmCapabilityResult> {
  if (signal?.aborted) throw new MotionExportCancelledError()
  if (!webCodecsAvailable()) {
    return { supported: false, reason: 'WebCodecs VP8 is unavailable in this runtime' }
  }
  const config = await supportedConfig(input.pixelWidth, input.pixelHeight, input.fps)
  if (signal?.aborted) throw new MotionExportCancelledError()
  if (!config) {
    return {
      supported: false,
      reason: `WebCodecs VP8 does not support ${input.pixelWidth}×${input.pixelHeight} at ${input.fps} fps`
    }
  }
  return { supported: true, encoder: webCodecsEncoder() }
}
