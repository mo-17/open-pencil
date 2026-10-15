import { expect, spyOn, test } from 'bun:test'

import { buildOpenPencilVueAudioPlayer } from '#compiler/adapters/vue/modules/audio-player'
import { buildOpenPencilVueLottie } from '#compiler/adapters/vue/modules/lottie'
import { buildOpenPencilVueQrBarcode } from '#compiler/adapters/vue/modules/qr-barcode'

import { MEDIA_ANIMATION, mediaConfigs } from '#tests/helpers/compiler/modules/vue-media/fixture'
import { mountMediaSfc } from '#tests/helpers/compiler/modules/vue-media/runtime'

test('Vue audio preview requires activation, revokes source consent and releases captured media', async () => {
  const config = mediaConfigs().audio,
    mounted = mountMediaSfc(buildOpenPencilVueAudioPlayer({ devMode: true }), config)
  try {
    await mounted.tick()
    expect(mounted.nodes('audio')).toHaveLength(0)
    const click = mounted.nodes('button')[0].props.onClick as () => void
    click()
    await mounted.tick()
    const audio = mounted.nodes('audio')[0]
    expect(audio.volume).toBe(0.35)
    expect(audio.playbackRate).toBe(1.25)
    mounted.state.value = { ...config, volume: 0.5, playbackRate: 1.5 }
    await mounted.tick()
    expect(audio.volume).toBe(0.5)
    expect(audio.playbackRate).toBe(1.5)
    mounted.rerender()
    await mounted.tick()
    expect(mounted.nodes('audio')[0]).toBe(audio)
    mounted.state.value = { ...config, src: '/media/replacement.wav' }
    await mounted.tick()
    expect(audio.pauses).toBe(1)
    expect(audio.loads).toBe(1)
    expect(audio.props.src).toBeUndefined()
    expect(mounted.nodes('audio')).toHaveLength(0)
    ;(mounted.nodes('button')[0].props.onClick as () => void)()
    await mounted.tick()
    const replacement = mounted.nodes('audio')[0]
    mounted.unmount()
    expect(replacement.pauses).toBe(1)
    expect(replacement.loads).toBe(1)
  } finally {
    mounted.unmount()
  }
})

test('Vue production audio starts with authored source and initializes volume on element creation', async () => {
  const config = mediaConfigs().audio,
    mounted = mountMediaSfc(buildOpenPencilVueAudioPlayer(), config)
  try {
    await mounted.tick()
    expect(mounted.nodes('button')).toHaveLength(0)
    const audio = mounted.nodes('audio')[0]
    expect(audio.props.src).toBe(config.src)
    expect(audio.volume).toBe(config.volume)
  } finally {
    mounted.unmount()
  }
})

test('Vue QR ignores obsolete async results and Code 128 config updates redraw trusted SVG', async () => {
  const config = mediaConfigs().qr,
    pending: ((value: string) => void)[] = [],
    drawings: string[] = []
  const mounted = mountMediaSfc(buildOpenPencilVueQrBarcode(), config, {
    qrcode: {
      toDataURL: () =>
        new Promise<string>((resolve) => {
          pending.push(resolve)
        })
    },
    jsbarcode: (_svg: unknown, value: string) => drawings.push(value)
  })
  try {
    await mounted.tick()
    mounted.state.value = { ...config, value: 'New QR' }
    await mounted.tick()
    pending[0]('data:image/png;base64,OLD')
    await mounted.tick()
    expect(mounted.nodes('img')).toHaveLength(0)
    pending[1]('data:image/png;base64,NEW')
    await mounted.tick()
    expect(mounted.nodes('img')[0].props.src).toEndWith('NEW')
    mounted.state.value = { ...config, format: 'code128', value: 'ABC-123' }
    await mounted.tick()
    expect(drawings).toEqual(['ABC-123'])
    const svg = mounted.nodes('svg')[0]
    mounted.state.value = { ...config, format: 'code128', value: 'UPDATED' }
    await mounted.tick()
    expect(drawings).toEqual(['ABC-123', 'UPDATED'])
    expect(mounted.nodes('svg')[0]).toBe(svg)
    mounted.state.value = { ...config, value: 'Pending at unmount' }
    await mounted.tick()
    mounted.unmount()
    pending[2]('data:image/png;base64,LATE')
    await mounted.tick()
    expect(mounted.root.children).toHaveLength(0)
  } finally {
    mounted.unmount()
  }
})

test('Vue embedded Lottie validates data before rendering and destroys animation on change/unmount', async () => {
  const config = mediaConfigs().lottie,
    events: string[] = [],
    lottie = {
      loadAnimation: () => {
        events.push('load')
        return {
          destroy: () => events.push('destroy'),
          setDirection: (value: number) => events.push('direction:' + value),
          setSpeed: (value: number) => events.push('speed:' + value),
          goToAndStop: () => events.push('stop')
        }
      }
    }
  const mounted = mountMediaSfc(buildOpenPencilVueLottie(), config, {
    'lottie-web/build/player/lottie_light': lottie
  })
  try {
    await mounted.tick()
    expect(events).toEqual(['load', 'direction:1', 'speed:1'])
    expect(mounted.nodes('div')[0].props['data-lottie-status']).toBe('ready')
    mounted.rerender()
    await mounted.tick()
    expect(events.filter((event) => event === 'load')).toHaveLength(1)
    mounted.state.value = { ...config, data: { ...config.data, layers: [{ ty: 6 }] } }
    await mounted.tick()
    expect(events.at(-1)).toBe('destroy')
    expect(mounted.nodes('div')[0].props['data-lottie-status']).toBe('error')
    mounted.state.value = { ...config, direction: 'reverse', speed: 1.5 }
    await mounted.tick()
    expect(events.slice(-3)).toEqual(['load', 'direction:-1', 'speed:1.5'])
    mounted.unmount()
    expect(events.at(-1)).toBe('destroy')
  } finally {
    mounted.unmount()
  }
})

test('Vue Lottie reduced motion disables autoplay and stops at the initial frame', async () => {
  const events: unknown[] = [],
    config = mediaConfigs().lottie
  const mounted = mountMediaSfc(buildOpenPencilVueLottie(), config, {
    reducedMotion: true,
    'lottie-web/build/player/lottie_light': {
      loadAnimation: (options: { autoplay: boolean }) => {
        events.push(options.autoplay)
        return {
          destroy: () => undefined,
          setDirection: () => undefined,
          setSpeed: () => undefined,
          goToAndStop: (frame: number, isFrame: boolean) => events.push([frame, isFrame])
        }
      }
    }
  })
  try {
    await mounted.tick()
    expect(events).toEqual([false, [0, true]])
  } finally {
    mounted.unmount()
  }
})

test('Vue remote Lottie waits for consent, aborts obsolete fetches and ignores their completed data', async () => {
  const pending: {
      resolve: (value: Response) => void
      signal: AbortSignal | null | undefined
      url: string
    }[] = [],
    loads: string[] = []
  const fetcher = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
        new Promise<Response>((resolve) => {
          pending.push({ resolve, signal: init?.signal, url: String(input) })
        }),
      { preconnect: globalThis.fetch.preconnect }
    )
  )
  const config = mediaConfigs().remote,
    mounted = mountMediaSfc(buildOpenPencilVueLottie(), config, {
      'lottie-web/build/player/lottie_light': {
        loadAnimation: () => {
          loads.push('load')
          return {
            destroy: () => loads.push('destroy'),
            setDirection: () => undefined,
            setSpeed: () => undefined,
            goToAndStop: () => undefined
          }
        }
      }
    })
  const finish = (index: number) => {
    const response = new Response(JSON.stringify(MEDIA_ANIMATION), {
      headers: { 'content-type': 'application/json' }
    })
    Object.defineProperty(response, 'url', { value: pending[index].url })
    pending[index].resolve(response)
  }
  try {
    await mounted.tick()
    expect(pending).toHaveLength(0)
    ;(mounted.nodes('button')[0].props.onClick as () => void)()
    await mounted.tick()
    expect(pending).toHaveLength(1)
    mounted.state.value = { ...config, url: 'https://animations.example.com/replacement.json' }
    await mounted.tick()
    expect(pending[0].signal?.aborted).toBe(true)
    expect(pending).toHaveLength(1)
    finish(0)
    await mounted.tick()
    await mounted.tick()
    expect(loads).toEqual([])
    ;(mounted.nodes('button')[0].props.onClick as () => void)()
    await mounted.tick()
    finish(1)
    for (let i = 0; i < 4; i++) await mounted.tick()
    expect(loads).toEqual(['load'])
    mounted.state.value = { ...config, url: 'https://animations.example.com/last.json' }
    await mounted.tick()
    expect(loads).toEqual(['load', 'destroy'])
    ;(mounted.nodes('button')[0].props.onClick as () => void)()
    await mounted.tick()
    mounted.unmount()
    expect(pending[2].signal?.aborted).toBe(true)
    finish(2)
    await mounted.tick()
    expect(loads).toEqual(['load', 'destroy'])
  } finally {
    mounted.unmount()
    fetcher.mockRestore()
  }
})
