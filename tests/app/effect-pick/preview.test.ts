import { describe, expect, spyOn, test } from 'bun:test'

import { createEffectPickConfig, type EffectPickConfigV1 } from '@open-pencil/core/plugins'

import { createEffectPickPreview } from '@/app/effect-pick/preview'
import { EFFECT_PICK_PREVIEW_PROTOCOL } from '@/app/effect-pick/protocol'

const IDS = [
  '2c1f2099-bcf0-445d-a432-29d4c154cf50',
  '2c1f2099-bcf0-445d-a432-29d4c154cf51',
  '2c1f2099-bcf0-445d-a432-29d4c154cf52'
] as const

class ListenerProbe {
  readonly listeners = new Map<string, Set<EventListener>>()

  addEventListener(type: string, listener: EventListener) {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }
  removeEventListener(type: string, listener: EventListener) {
    this.listeners.get(type)?.delete(listener)
  }
  dispatch(type: string, details: object = {}) {
    const event = Object.assign(new Event(type), details)
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
  count(type: string) {
    return this.listeners.get(type)?.size ?? 0
  }
}

class PortInbox {
  private readonly messages: unknown[] = []
  private readonly waiters: ((value: unknown) => void)[] = []

  constructor(readonly port: MessagePort) {
    port.onmessage = (event: MessageEvent<unknown>) => {
      const next = this.waiters.shift()
      if (next) next(event.data)
      else this.messages.push(event.data)
    }
    port.start()
  }
  next(): Promise<unknown> {
    if (this.messages.length) return Promise.resolve(this.messages.shift())
    return new Promise((resolve) => {
      this.waiters.push(resolve)
    })
  }
  send(instanceId: string, type: string, extra: Record<string, unknown> = {}) {
    // MessagePort delivers on its private channel and has no targetOrigin argument.
    // eslint-disable-next-line unicorn/require-post-message-target-origin
    this.port.postMessage({ protocol: EFFECT_PICK_PREVIEW_PROTOCOL, instanceId, type, ...extra })
  }
  close() {
    this.port.onmessage = null
    this.port.close()
  }
}

function fixture(initialConfig: EffectPickConfigV1) {
  const parent = Object.assign(new ListenerProbe(), { location: { origin: 'https://editor.test' } })
  const ownerWindow: Pick<Window, 'location' | 'addEventListener' | 'removeEventListener'> = {
    location: parent.location as Location,
    addEventListener: parent.addEventListener.bind(parent) as Window['addEventListener'],
    removeEventListener: parent.removeEventListener.bind(parent) as Window['removeEventListener']
  }
  const document = Object.assign(new ListenerProbe(), {
    defaultView: ownerWindow as NonNullable<Document['defaultView']>,
    hidden: false
  })
  const connections: { message: unknown; origin: string; inbox: PortInbox }[] = []
  const target = {
    postMessage(message: unknown, origin: string, transfer: Transferable[]) {
      const port = transfer[0]
      if (!(port instanceof MessagePort)) throw new TypeError('Expected one transferred port')
      connections.push({ message, origin, inbox: new PortInbox(port) })
    }
  }
  const targetWindow: Pick<Window, 'postMessage'> = {
    postMessage: target.postMessage.bind(target) as Window['postMessage']
  }
  const attributes = new Map<string, string>()
  const removals: string[] = []
  const frame = Object.assign(new ListenerProbe(), {
    ownerDocument: document,
    contentWindow: targetWindow as Window,
    srcdoc: '',
    setAttribute(name: string, value: string) {
      attributes.set(name, value)
    },
    removeAttribute(name: string) {
      removals.push(name)
      attributes.delete(name)
      if (name === 'srcdoc') frame.srcdoc = ''
    }
  })
  const frameDocument: Pick<
    Document,
    'defaultView' | 'hidden' | 'addEventListener' | 'removeEventListener'
  > = {
    defaultView: document.defaultView,
    get hidden() {
      return document.hidden
    },
    addEventListener: document.addEventListener.bind(document) as Document['addEventListener'],
    removeEventListener: document.removeEventListener.bind(
      document
    ) as Document['removeEventListener']
  }
  const previewFrame: Pick<
    HTMLIFrameElement,
    | 'ownerDocument'
    | 'contentWindow'
    | 'srcdoc'
    | 'setAttribute'
    | 'removeAttribute'
    | 'addEventListener'
    | 'removeEventListener'
  > = {
    ownerDocument: frameDocument as Document,
    contentWindow: frame.contentWindow,
    get srcdoc() {
      return frame.srcdoc
    },
    set srcdoc(value) {
      frame.srcdoc = value
    },
    setAttribute: frame.setAttribute.bind(frame),
    removeAttribute: frame.removeAttribute.bind(frame),
    addEventListener: frame.addEventListener.bind(frame) as HTMLIFrameElement['addEventListener'],
    removeEventListener: frame.removeEventListener.bind(
      frame
    ) as HTMLIFrameElement['removeEventListener']
  }
  let visible = (_value: boolean): void => undefined
  let observationStopped = false
  let clicks = 0
  const errors: string[] = []
  const controller = createEffectPickPreview(previewFrame as HTMLIFrameElement, initialConfig, {
    onClick: () => clicks++,
    onError: (message) => errors.push(message),
    observeVisibility(observed, onVisible) {
      if (observed !== previewFrame) throw new TypeError('Unexpected observed frame')
      visible = onVisible
      return () => {
        observationStopped = true
      }
    }
  })
  return {
    controller,
    parent,
    document,
    frame,
    frameElement: previewFrame as HTMLIFrameElement,
    attributes,
    removals,
    connections,
    errors,
    clicks: () => clicks,
    observationStopped: () => observationStopped,
    visible: (value: boolean) => visible(value),
    ready(instanceId: string, extra: object = {}, origin = 'null', source: object = targetWindow) {
      parent.dispatch('message', {
        origin,
        source,
        data: { protocol: EFFECT_PICK_PREVIEW_PROTOCOL, instanceId, type: 'ready', ...extra }
      })
    },
    connection(index = 0) {
      const connection = connections.at(index)
      if (!connection) throw new Error('Expected an established private port')
      return connection.inbox
    },
    dispose() {
      controller.destroy()
      for (const connection of connections) connection.inbox.close()
    }
  }
}

async function withFixture(
  run: (probe: ReturnType<typeof fixture>) => Promise<void>,
  effectId = 'diagonal-fill'
) {
  let sequence = 0
  const uuid = spyOn(crypto, 'randomUUID').mockImplementation(() => {
    const id = IDS.at(sequence++)
    if (!id) throw new Error('Unexpected additional preview session')
    return id
  })
  let probe: ReturnType<typeof fixture> | undefined
  try {
    probe = fixture(createEffectPickConfig(effectId))
    await run(probe)
  } finally {
    probe?.dispose()
    uuid.mockRestore()
  }
}

async function mounted(inbox: PortInbox, instanceId: string) {
  inbox.send(instanceId, 'mounted')
  const acknowledgement = await inbox.next()
  expect(acknowledgement).toMatchObject({ type: 'config', instanceId })
  return acknowledgement
}

describe('EffectPick preview host lifecycle', () => {
  test('binds the one-use private port to the exact opaque frame and protocol', async () => {
    await withFixture(async (probe) => {
      probe.ready(IDS[0], {}, 'https://attacker.test')
      probe.ready(IDS[0], {}, 'null', {})
      probe.ready(IDS[1])
      probe.ready(IDS[0], { payload: { action: 'setState' } })
      probe.ready(IDS[0], { protocol: 'op-lowcode-preview' })
      expect(probe.connections).toHaveLength(0)
      probe.ready(IDS[0])
      probe.ready(IDS[0])
      expect(probe.connections).toHaveLength(1)
      expect(probe.connections[0]?.origin).toBe('*')
      expect(probe.attributes.get('sandbox')).toBe('allow-scripts')
      expect(probe.attributes.get('referrerpolicy')).toBe('no-referrer')
      expect(await probe.connection().next()).toMatchObject({ type: 'mount', instanceId: IDS[0] })
    })
  })

  test('mounts the latest config and policy after delayed readiness, tolerating earlier blank loads', async () => {
    await withFixture(async (probe) => {
      const config = createEffectPickConfig('diagonal-fill', { text: 'Newest draft', speed: 2 })
      probe.controller.setConfig(config)
      probe.controller.pause()
      probe.controller.setReducedMotion(true)
      probe.frame.dispatch('load')
      probe.frame.dispatch('load')
      expect(probe.errors).toEqual([])
      probe.ready(IDS[0])
      const inbox = probe.connection()
      expect(await inbox.next()).toMatchObject({
        type: 'mount',
        config,
        playing: false,
        reducedMotion: true
      })
      expect(await mounted(inbox, IDS[0])).toMatchObject({ config })
      const source = probe.frame.srcdoc
      expect(() => probe.controller.setConfig({ ...config, artifactDigest: 'unknown' })).toThrow()
      expect(probe.frame.srcdoc).toBe(source)
      expect(probe.errors).toEqual([])
    })
  })

  test('rejects stale artifact readiness and callbacks while switching before mounted acknowledgement', async () => {
    await withFixture(async (probe) => {
      const gradient = createEffectPickConfig('animated-gradient')
      probe.controller.setConfig(gradient)
      probe.ready(IDS[0])
      expect(probe.connections).toHaveLength(0)
      probe.ready(IDS[1])
      const inbox = probe.connection()
      expect(await inbox.next()).toMatchObject({
        type: 'mount',
        instanceId: IDS[1],
        config: gradient
      })
      inbox.send(IDS[0], 'click')
      inbox.send(IDS[1], 'click')
      await mounted(inbox, IDS[1])
      inbox.send(IDS[1], 'click')
      await mounted(inbox, IDS[1])
      expect(probe.clicks()).toBe(0)
      const diagonal = createEffectPickConfig('diagonal-fill', { text: 'Return' })
      probe.controller.setConfig(diagonal)
      probe.ready(IDS[0])
      probe.ready(IDS[1])
      expect(probe.connections).toHaveLength(1)
      inbox.send(IDS[1], 'mounted')
      inbox.send(IDS[1], 'click')
      inbox.send(IDS[1], 'error', { message: 'Late obsolete iframe' })
      probe.ready(IDS[2])
      const newest = probe.connection(1)
      expect(await newest.next()).toMatchObject({
        type: 'mount',
        instanceId: IDS[2],
        config: diagonal
      })
      await mounted(newest, IDS[2])
      newest.send(IDS[2], 'click')
      newest.send(IDS[2], 'click', { action: 'setState' })
      await mounted(newest, IDS[2])
      expect(probe.clicks()).toBe(1)
      expect(probe.errors).toEqual([])
    })
  })

  test('keeps manual pause distinct from offscreen and document visibility', async () => {
    await withFixture(async (probe) => {
      probe.visible(false)
      probe.ready(IDS[0])
      const inbox = probe.connection()
      expect(await inbox.next()).toMatchObject({ type: 'mount', playing: false })
      await mounted(inbox, IDS[0])
      probe.visible(true)
      expect(await inbox.next()).toMatchObject({ type: 'play' })
      probe.controller.pause()
      expect(await inbox.next()).toMatchObject({ type: 'pause' })
      probe.visible(false)
      expect(await inbox.next()).toMatchObject({ type: 'pause' })
      probe.visible(true)
      expect(await inbox.next()).toMatchObject({ type: 'pause' })
      probe.document.hidden = true
      probe.document.dispatch('visibilitychange')
      expect(await inbox.next()).toMatchObject({ type: 'pause' })
      probe.controller.play()
      expect(await inbox.next()).toMatchObject({ type: 'pause' })
      probe.document.hidden = false
      probe.document.dispatch('visibilitychange')
      expect(await inbox.next()).toMatchObject({ type: 'play' })
      probe.visible(false)
      expect(await inbox.next()).toMatchObject({ type: 'pause' })
      probe.controller.replay()
      expect(await inbox.next()).toMatchObject({ type: 'replay' })
      expect(await inbox.next()).toMatchObject({ type: 'pause' })
      probe.controller.setReducedMotion(true)
      expect(await inbox.next()).toMatchObject({ type: 'reducedMotion', value: true })
    })
  })

  test('keeps a mounted artifact paused while its editable parameters change', async () => {
    await withFixture(async (probe) => {
      probe.ready(IDS[0])
      const inbox = probe.connection()
      await inbox.next()
      await mounted(inbox, IDS[0])
      probe.controller.pause()
      expect(await inbox.next()).toMatchObject({ type: 'pause', instanceId: IDS[0] })
      const document = probe.frame.srcdoc
      for (const config of [
        createEffectPickConfig('diagonal-fill', { text: 'Updated text' }),
        createEffectPickConfig('diagonal-fill', {
          text: 'Updated text',
          color: '#38bdf8',
          speed: 2
        })
      ]) {
        probe.controller.setConfig(config)
        expect(await inbox.next()).toMatchObject({ type: 'config', instanceId: IDS[0], config })
        probe.visible(false)
        expect(await inbox.next()).toMatchObject({ type: 'pause', instanceId: IDS[0] })
        probe.visible(true)
        expect(await inbox.next()).toMatchObject({ type: 'pause', instanceId: IDS[0] })
      }
      expect(probe.connections).toHaveLength(1)
      expect(probe.frame.srcdoc).toBe(document)
      expect(probe.removals).toEqual([])
      expect(probe.errors).toEqual([])
    })
  })

  test('rejects navigation after reviewed document load and destroys every owned resource once', async () => {
    await withFixture(async (probe) => {
      probe.frame.dispatch('load')
      probe.ready(IDS[0])
      const inbox = probe.connection()
      await inbox.next()
      inbox.send(IDS[0], 'loaded')
      await mounted(inbox, IDS[0])
      probe.frame.dispatch('load')
      expect(probe.errors).toEqual([
        'Effect preview cannot navigate away from its reviewed document'
      ])
      expect(probe.parent.count('message')).toBe(0)
      expect(probe.document.count('visibilitychange')).toBe(0)
      expect(probe.frame.count('load')).toBe(0)
      expect(probe.observationStopped()).toBe(true)
      expect(probe.frame.srcdoc).toBe('')
      expect(probe.removals).toEqual(['srcdoc', 'src'])
      probe.controller.destroy()
      probe.controller.play()
      probe.controller.setConfig(createEffectPickConfig('animated-gradient'))
      probe.ready(IDS[1])
      probe.visible(true)
      expect(probe.connections).toHaveLength(1)
      expect(probe.removals).toEqual(['srcdoc', 'src'])
    })
  })

  test('keeps two frame configs, event authority and destruction independent', async () => {
    await withFixture(async (first) => {
      const second = fixture(createEffectPickConfig('diagonal-fill', { text: 'Second instance' }))
      try {
        first.ready(IDS[0])
        second.ready(IDS[1], {}, 'null', first.frame.contentWindow)
        expect(second.connections).toHaveLength(0)
        second.ready(IDS[1])
        const firstInbox = first.connection()
        const secondInbox = second.connection()
        expect(await firstInbox.next()).toMatchObject({ type: 'mount', instanceId: IDS[0] })
        expect(await secondInbox.next()).toMatchObject({
          type: 'mount',
          instanceId: IDS[1],
          config: { text: 'Second instance' }
        })
        await mounted(firstInbox, IDS[0])
        await mounted(secondInbox, IDS[1])
        firstInbox.send(IDS[0], 'click')
        firstInbox.send(IDS[1], 'click')
        await mounted(firstInbox, IDS[0])
        expect(first.clicks()).toBe(1)
        expect(second.clicks()).toBe(0)
        first.controller.setConfig(
          createEffectPickConfig('diagonal-fill', { text: 'First updated' })
        )
        expect(await firstInbox.next()).toMatchObject({
          type: 'config',
          config: { text: 'First updated' }
        })
        first.controller.destroy()
        expect(first.observationStopped()).toBe(true)
        expect(second.observationStopped()).toBe(false)
        expect(second.parent.count('message')).toBe(1)
        secondInbox.send(IDS[1], 'click')
        await mounted(secondInbox, IDS[1])
        expect(second.clicks()).toBe(1)
        second.controller.play()
        expect(await secondInbox.next()).toMatchObject({ type: 'play', instanceId: IDS[1] })
        expect(second.errors).toEqual([])
      } finally {
        second.dispose()
      }
    })
  })

  test('recovers from runtime failure with a new artifact owner on the same iframe', async () => {
    await withFixture(async (probe) => {
      probe.ready(IDS[0])
      const inbox = probe.connection()
      await inbox.next()
      await mounted(inbox, IDS[0])
      inbox.send(IDS[0], 'click')
      await mounted(inbox, IDS[0])
      expect(probe.clicks()).toBe(1)
      probe.controller.pause()
      expect(await inbox.next()).toMatchObject({ type: 'pause' })
      inbox.send(IDS[0], 'error', { message: 'Configuration rejected' })
      expect(await inbox.next()).toMatchObject({ type: 'destroy', instanceId: IDS[0] })
      expect(probe.errors).toEqual(['Configuration rejected'])
      expect(probe.parent.count('message')).toBe(0)
      expect(probe.document.count('visibilitychange')).toBe(0)
      expect(probe.observationStopped()).toBe(true)
      probe.controller.destroy()
      probe.ready(IDS[0])
      expect(probe.connections).toHaveLength(1)
      expect(probe.removals).toEqual(['srcdoc', 'src'])
      const config = createEffectPickConfig('animated-gradient', { text: 'Recovered artifact' })
      const errors: string[] = []
      let clicks = 0
      let stopped = false
      const replacement = createEffectPickPreview(probe.frameElement, config, {
        onClick: () => clicks++,
        onError: (message) => errors.push(message),
        observeVisibility: () => () => {
          stopped = true
        }
      })
      try {
        inbox.send(IDS[0], 'click')
        inbox.send(IDS[0], 'error', { message: 'Late failed owner' })
        probe.ready(IDS[0])
        expect(probe.connections).toHaveLength(1)
        probe.ready(IDS[1])
        const recovered = probe.connection(1)
        expect(await recovered.next()).toMatchObject({
          type: 'mount',
          instanceId: IDS[1],
          config,
          playing: true
        })
        await mounted(recovered, IDS[1])
        recovered.send(IDS[1], 'click')
        await mounted(recovered, IDS[1])
        expect(clicks).toBe(0)
        expect(probe.clicks()).toBe(1)
        expect(errors).toEqual([])
        expect(probe.errors).toEqual(['Configuration rejected'])
        expect(probe.parent.count('message')).toBe(1)
        expect(probe.document.count('visibilitychange')).toBe(1)
        expect(stopped).toBe(false)
      } finally {
        replacement.destroy()
      }
      expect(stopped).toBe(true)
      expect(probe.parent.count('message')).toBe(0)
      expect(probe.document.count('visibilitychange')).toBe(0)
      expect(probe.removals).toEqual(['srcdoc', 'src', 'srcdoc', 'src'])
    })
  })

  test('supersedes a frame owner once while invalid replacements and stale destruction preserve the current session', async () => {
    await withFixture(async (probe) => {
      probe.ready(IDS[0])
      const originalInbox = probe.connection()
      await originalInbox.next()
      await mounted(originalInbox, IDS[0])
      const originalDocument = probe.frame.srcdoc
      expect(() =>
        createEffectPickPreview(probe.frameElement, {
          ...createEffectPickConfig('diagonal-fill'),
          artifactDigest: 'invalid replacement'
        })
      ).toThrow()
      expect(probe.observationStopped()).toBe(false)
      expect(probe.frame.srcdoc).toBe(originalDocument)
      expect(probe.removals).toEqual([])
      probe.controller.pause()
      expect(await originalInbox.next()).toMatchObject({ type: 'pause', instanceId: IDS[0] })
      let replacementStopped = false
      const replacement = createEffectPickPreview(
        probe.frameElement,
        createEffectPickConfig('animated-gradient', { text: 'Replacement owner' }),
        {
          observeVisibility: () => () => {
            replacementStopped = true
          }
        }
      )
      try {
        expect(await originalInbox.next()).toMatchObject({ type: 'destroy', instanceId: IDS[0] })
        expect(probe.observationStopped()).toBe(true)
        expect(probe.parent.count('message')).toBe(1)
        expect(probe.document.count('visibilitychange')).toBe(1)
        expect(probe.frame.count('load')).toBe(1)
        expect(probe.removals).toEqual(['srcdoc', 'src'])
        const replacementDocument = probe.frame.srcdoc
        expect(replacementDocument).not.toBe(originalDocument)
        probe.controller.destroy()
        probe.controller.setConfig(createEffectPickConfig('water-text'))
        probe.controller.play()
        expect(probe.frame.srcdoc).toBe(replacementDocument)
        expect(probe.removals).toEqual(['srcdoc', 'src'])
        probe.ready(IDS[0])
        expect(probe.connections).toHaveLength(1)
        probe.ready(IDS[1])
        const newest = probe.connection(1)
        expect(await newest.next()).toMatchObject({
          type: 'mount',
          instanceId: IDS[1],
          config: { effectId: 'animated-gradient', text: 'Replacement owner' }
        })
        await mounted(newest, IDS[1])
        replacement.play()
        expect(await newest.next()).toMatchObject({ type: 'play', instanceId: IDS[1] })
        expect(replacementStopped).toBe(false)
      } finally {
        replacement.destroy()
      }
      expect(replacementStopped).toBe(true)
      expect(probe.parent.count('message')).toBe(0)
      expect(probe.document.count('visibilitychange')).toBe(0)
      expect(probe.frame.count('load')).toBe(0)
      expect(probe.removals).toEqual(['srcdoc', 'src', 'srcdoc', 'src'])
    })
  })
})
