import { afterEach, describe, expect, test } from 'bun:test'

import {
  MotionExportCancelledError,
  planMotionFrames,
  type MotionAnimationEncoder,
  type MotionGraphExportPlan
} from '@open-pencil/core/io/motion-export'
import { SceneGraph } from '@open-pencil/scene-graph'

import { probeWebCodecsWebmMotionEncoder } from '@/app/document/export/motion/webcodecs-webm'
import {
  createMotionWebmCapabilityPreflight,
  getMotionWebmExportCapabilities,
  type MotionWebmCapabilityPreflightInput,
  type MotionWebmCapabilityState
} from '@/app/document/export/motion/webm-capability'

const GLOBAL_NAMES = ['VideoEncoder', 'VideoFrame', 'createImageBitmap'] as const
const originalGlobals = new Map(
  GLOBAL_NAMES.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)])
)

afterEach(() => {
  for (const name of GLOBAL_NAMES) {
    const descriptor = originalGlobals.get(name)
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else Reflect.deleteProperty(globalThis, name)
  }
})

function installWebCodecsProbe(
  probe: (config: VideoEncoderConfig) => Promise<VideoEncoderSupport>
): void {
  Object.defineProperty(globalThis, 'VideoEncoder', {
    configurable: true,
    value: { isConfigSupported: probe }
  })
  Object.defineProperty(globalThis, 'VideoFrame', { configurable: true, value: globalThis.Object })
  Object.defineProperty(globalThis, 'createImageBitmap', {
    configurable: true,
    value: async () => undefined
  })
}

function exactPlan(pixelWidth: number, pixelHeight: number, fps: number): MotionGraphExportPlan {
  const plan = planMotionFrames({
    durationMs: 100,
    fps,
    width: pixelWidth,
    height: pixelHeight
  })
  return {
    plan,
    bounds: { minX: 0, minY: 0, maxX: pixelWidth, maxY: pixelHeight },
    nodeIds: ['1:2'],
    issues: [],
    reducedMotion: 'allow'
  }
}

function preflightInput(pageId = '1:1'): MotionWebmCapabilityPreflightInput {
  const graph = new SceneGraph()
  return {
    graph,
    pageId,
    source: { kind: 'nodes', nodeIds: ['1:2'] },
    fps: 47,
    loops: 1,
    reducedMotion: 'allow'
  }
}

function testEncoder(name: string): MotionAnimationEncoder {
  return {
    format: 'webm',
    mimeType: 'video/webm',
    extension: 'webm',
    capability: name,
    async encode() {
      return new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])
    }
  }
}

async function waitForState(
  states: MotionWebmCapabilityState[],
  status: MotionWebmCapabilityState['status']
): Promise<MotionWebmCapabilityState> {
  const deadline = Date.now() + 1_000
  while (Date.now() < deadline) {
    const state = states.at(-1)
    if (state?.status === status) return state
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 1)
    })
  }
  throw new Error(`Timed out waiting for WebM capability state ${status}`)
}

describe('WebCodecs WebM exact capability probe', () => {
  test('passes the final export width, height, and fps to isConfigSupported', async () => {
    let received: VideoEncoderConfig | undefined
    installWebCodecsProbe(async (config) => {
      received = config
      return { supported: true, config }
    })

    const result = await probeWebCodecsWebmMotionEncoder({
      pixelWidth: 321,
      pixelHeight: 123,
      fps: 47
    })

    expect(received).toMatchObject({
      codec: 'vp8',
      width: 321,
      height: 123,
      displayWidth: 321,
      displayHeight: 123,
      framerate: 47
    })
    expect(result.supported).toBe(true)
  })

  test('fails closed with the rejected exact configuration in the reason', async () => {
    installWebCodecsProbe(async (config) => ({ supported: false, config }))

    const result = await probeWebCodecsWebmMotionEncoder({
      pixelWidth: 8_191,
      pixelHeight: 4_095,
      fps: 120
    })

    expect(result).toEqual({
      supported: false,
      reason: 'WebCodecs VP8 does not support 8191×4095 at 120 fps'
    })
  })

  test('discards a support result after cancellation', async () => {
    let finish: (() => void) | undefined
    installWebCodecsProbe(
      (config) =>
        new Promise((resolve) => {
          finish = () => resolve({ supported: true, config })
        })
    )
    const controller = new AbortController()
    const probing = probeWebCodecsWebmMotionEncoder(
      { pixelWidth: 320, pixelHeight: 180, fps: 30 },
      controller.signal
    )
    controller.abort()
    finish?.()

    await expect(probing).rejects.toBeInstanceOf(MotionExportCancelledError)
  })
})

describe('WebM capability preflight scheduler', () => {
  test('debounces, probes exact planned dimensions, and caches identical configs', async () => {
    const states: MotionWebmCapabilityState[] = []
    const configs: Array<{ pixelWidth: number; pixelHeight: number; fps: number }> = []
    let plans = 0
    const runner = createMotionWebmCapabilityPreflight({
      debounceMs: 1,
      onState: (state) => states.push(state),
      async plan() {
        plans++
        return exactPlan(321, 123, 47)
      },
      async probe(config) {
        configs.push(config)
        return { supported: true, encoder: testEncoder('exact config') }
      }
    })

    runner.schedule(preflightInput('first'))
    runner.schedule(preflightInput('debounced'))
    await waitForState(states, 'available')
    runner.schedule(preflightInput('same-config-after-graph-change'))
    await waitForState(states, 'available')

    expect(plans).toBe(2)
    expect(configs).toEqual([{ pixelWidth: 321, pixelHeight: 123, fps: 47 }])
    expect(
      getMotionWebmExportCapabilities({ status: 'loading' }).find(({ format }) => format === 'webm')
    ).toMatchObject({ available: false, mode: 'unavailable' })
    runner.dispose()
  })

  test('aborts and ignores a stale plan when source changes', async () => {
    const states: MotionWebmCapabilityState[] = []
    let firstSignal: AbortSignal | undefined
    let finishFirst: ((plan: MotionGraphExportPlan) => void) | undefined
    const runner = createMotionWebmCapabilityPreflight({
      debounceMs: 1,
      onState: (state) => states.push(state),
      plan(input) {
        if (input.pageId === 'first') {
          firstSignal = input.signal
          return new Promise((resolve) => {
            finishFirst = resolve
          })
        }
        return Promise.resolve(exactPlan(640, 360, 60))
      },
      async probe(config) {
        return { supported: true, encoder: testEncoder(`${config.pixelWidth}`) }
      }
    })

    runner.schedule(preflightInput('first'))
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 5)
    })
    runner.schedule(preflightInput('second'))
    const available = await waitForState(states, 'available')
    finishFirst?.(exactPlan(10, 10, 10))
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 5)
    })

    expect(firstSignal?.aborted).toBe(true)
    expect(available.status === 'available' && available.exportPlan.plan).toMatchObject({
      pixelWidth: 640,
      pixelHeight: 360,
      fps: 60
    })
    expect(states.at(-1)).toEqual(available)
    runner.dispose()
  })
})
