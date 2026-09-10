import { strict as assert } from 'node:assert'
import { randomUUID } from 'node:crypto'

import { sanitizeDiagnosticMessage } from '#tests/helpers/collab/diagnostics'
import { startRelay } from '#tests/helpers/collab/test-relay'

type PeerName = 'alice' | 'bob'
type NativePeer = WebdriverIO.Browser
type NativeMultiremoteBrowser = WebdriverIO.Browser &
  Pick<WebdriverIO.MultiRemoteBrowser, 'getInstance'>

type FrontendErrorCapture = {
  errors: string[]
  onError: (event: ErrorEvent) => void
  onUnhandledRejection: (event: PromiseRejectionEvent) => void
  originalConsoleError: typeof console.error
}

type FrontendErrorCaptureWindow = Window & {
  __OPENPENCIL_NATIVE_COLLAB_ERRORS__?: FrontendErrorCapture
}

type PeerDiagnostic = {
  role: PeerName
  storeReady: boolean
  route: string
  connection: string | null
  remotePeerCount: number
  seesExpectedPeer: boolean
  visibleLayerCount: number
  expectedLayer: 'initial' | 'alice' | 'bob' | 'none'
  frontendErrorKinds: string[]
}

const SELECTORS = {
  homeNewDocument: '[data-test-id="home-new-document"]',
  shareButton: '[data-test-id="collab-share-button"]',
  popover: '[data-test-id="collab-popover"]',
  nameInput: '[data-test-id="collab-name-input"]',
  shareFile: '[data-test-id="collab-share-file"]',
  roomLink: '[data-test-id="collab-room-link"]',
  joinInput: '[data-test-id="collab-join-input"]',
  joinRoom: '[data-test-id="collab-join-room-button"]',
  peerRow: '[data-test-id="collab-peer-row"]',
  disconnect: '[data-test-id="collab-disconnect"]'
} as const

const INITIAL_LAYER_NAME = 'Native shared rectangle'
const ALICE_LAYER_NAME = 'Edited by Alice'
const BOB_LAYER_NAME = 'Edited by Bob'

function getPeer(name: PeerName): NativePeer {
  return (browser as NativeMultiremoteBrowser).getInstance(name)
}

async function waitForEditor(peer: NativePeer, label: string): Promise<void> {
  await peer.waitUntil(
    async () =>
      peer.execute(() => {
        const home = document.querySelector('[data-test-id="home-new-document"]')
        const homeVisible = home instanceof HTMLElement && home.getClientRects().length > 0
        return Boolean(window.openPencil?.getStore?.()) || homeVisible
      }),
    { timeout: 30_000, timeoutMsg: `${label} did not reach Home or initialize an editor` }
  )

  const startsOnHome = await peer.execute(() => {
    const home = document.querySelector('[data-test-id="home-new-document"]')
    return home instanceof HTMLElement && home.getClientRects().length > 0
  })
  if (startsOnHome) {
    await peer.$(SELECTORS.homeNewDocument).click()
  }

  await peer.waitUntil(async () => peer.execute(() => Boolean(window.openPencil?.getStore?.())), {
    timeout: 30_000,
    timeoutMsg: `${label} editor did not initialize`
  })
}

async function configureTestTransport(peer: NativePeer, relayURL: string): Promise<void> {
  const configured = await peer.execute((url) => {
    const query = `test&collabTransport=test&collabRelay=${encodeURIComponent(url)}`
    history.replaceState(history.state, '', `${location.pathname}?${query}${location.hash}`)
    const params = new URLSearchParams(location.search)
    return {
      test: params.has('test'),
      transport: params.get('collabTransport'),
      relay: params.get('collabRelay')
    }
  }, relayURL)
  assert.deepEqual(configured, { test: true, transport: 'test', relay: relayURL })
}

async function installFrontendErrorCapture(peer: NativePeer): Promise<void> {
  await peer.execute(() => {
    const target = window as FrontendErrorCaptureWindow
    const previous = target.__OPENPENCIL_NATIVE_COLLAB_ERRORS__
    if (previous) {
      window.removeEventListener('error', previous.onError)
      window.removeEventListener('unhandledrejection', previous.onUnhandledRejection)
      console.error = previous.originalConsoleError
    }

    const errors: string[] = []
    const classify = (value: unknown): string => {
      if (value instanceof Error) return value.name
      if (value === null) return 'null'
      if (typeof value !== 'object') return typeof value
      return Object.prototype.toString.call(value).slice(8, -1)
    }
    const record = (kind: string, value: unknown) => {
      errors.push(`${kind}: ${classify(value)}`)
      if (errors.length > 20) errors.shift()
    }
    const onError = (event: ErrorEvent) => record('error', event.error ?? event.message)
    const onUnhandledRejection = (event: PromiseRejectionEvent) =>
      record('unhandledrejection', event.reason)
    const originalConsoleError = console.error
    console.error = (...args: unknown[]) => {
      record('console.error', args[0])
      originalConsoleError.apply(console, args)
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onUnhandledRejection)
    target.__OPENPENCIL_NATIVE_COLLAB_ERRORS__ = {
      errors,
      onError,
      onUnhandledRejection,
      originalConsoleError
    }
  })
}

async function removeFrontendErrorCapture(peer: NativePeer): Promise<void> {
  await peer.execute(() => {
    const target = window as FrontendErrorCaptureWindow
    const capture = target.__OPENPENCIL_NATIVE_COLLAB_ERRORS__
    if (!capture) return
    window.removeEventListener('error', capture.onError)
    window.removeEventListener('unhandledrejection', capture.onUnhandledRejection)
    console.error = capture.originalConsoleError
    delete target.__OPENPENCIL_NATIVE_COLLAB_ERRORS__
  })
}

async function ensureCollabPopover(peer: NativePeer): Promise<void> {
  const open = await peer.execute(() => {
    const popover = document.querySelector('[data-test-id="collab-popover"]')
    return popover instanceof HTMLElement && popover.getClientRects().length > 0
  })
  if (!open) await peer.$(SELECTORS.shareButton).click()
  await peer.waitUntil(
    async () =>
      peer.execute(() => {
        const popover = document.querySelector('[data-test-id="collab-popover"]')
        return popover instanceof HTMLElement && popover.getClientRects().length > 0
      }),
    { timeoutMsg: 'Collaboration popover did not open' }
  )
}

async function closeCollabPopover(peer: NativePeer): Promise<void> {
  const open = await peer.execute(() => {
    const popover = document.querySelector('[data-test-id="collab-popover"]')
    return popover instanceof HTMLElement && popover.getClientRects().length > 0
  })
  if (!open) return
  await peer.$(SELECTORS.shareButton).click()
  await peer.waitUntil(
    async () =>
      peer.execute(() => {
        const popover = document.querySelector('[data-test-id="collab-popover"]')
        return !(popover instanceof HTMLElement) || popover.getClientRects().length === 0
      }),
    { timeoutMsg: 'Collaboration popover did not close' }
  )
}

async function waitForConnection(peer: NativePeer, expected: 'connected' | 'idle'): Promise<void> {
  await peer.waitUntil(
    async () =>
      peer.execute(
        (state) =>
          document.querySelector<HTMLElement>('[data-test-id="collab-share-button"]')?.dataset
            .connection === state,
        expected
      ),
    { timeout: 30_000, timeoutMsg: `Collaboration did not become ${expected}` }
  )
}

async function waitForPeerName(peer: NativePeer, expectedName: string): Promise<void> {
  await peer.waitUntil(
    async () =>
      peer.execute((name) => {
        return [...document.querySelectorAll('[data-test-id="collab-peer-row"]')].some(
          (row) =>
            row instanceof HTMLElement &&
            row.getClientRects().length > 0 &&
            row.textContent?.includes(name)
        )
      }, expectedName),
    { timeout: 30_000, timeoutMsg: `Peer roster did not show ${expectedName}` }
  )
}

async function waitForVisibleLayerName(
  peer: NativePeer,
  nodeId: string,
  expectedName: string
): Promise<void> {
  await peer.waitUntil(
    async () =>
      peer.execute(
        (id, name) => {
          const owner = [...document.querySelectorAll<HTMLElement>('[data-node-id]')].find(
            (element) => element.dataset.nodeId === id
          )
          const label = owner?.querySelector('[data-test-id="layers-item"] [data-slot="label"]')
          return (
            label instanceof HTMLElement &&
            label.getClientRects().length > 0 &&
            label.textContent?.trim() === name
          )
        },
        nodeId,
        expectedName
      ),
    { timeout: 30_000, timeoutMsg: `Visible layer tree did not show "${expectedName}"` }
  )
}

async function renameVisibleLayer(
  peer: NativePeer,
  nodeId: string,
  nextName: string
): Promise<void> {
  const rowSelector = `[data-node-id="${nodeId}"] [data-test-id="layers-item"]`
  const inputSelector = '[data-test-id="layers-item-input"]'
  const row = await peer.$(rowSelector)
  await row.waitForDisplayed()
  await row.doubleClick()

  let webdriverDoubleClickOpenedEditor = false
  try {
    await peer.waitUntil(
      async () =>
        peer.execute((selector) => {
          const input = document.querySelector(selector)
          return input instanceof HTMLInputElement && input.getClientRects().length > 0
        }, inputSelector),
      { timeout: 2_000, interval: 100 }
    )
    webdriverDoubleClickOpenedEditor = true
  } catch {
    // WebKit's embedded WebDriver can omit the DOM dblclick synthesized by the action command.
    webdriverDoubleClickOpenedEditor = false
  }
  if (!webdriverDoubleClickOpenedEditor) {
    await peer.execute((selector) => {
      const target = document.querySelector(selector)
      if (!(target instanceof HTMLElement)) throw new Error('Visible layer row is unavailable')
      target.dispatchEvent(
        new MouseEvent('dblclick', { bubbles: true, cancelable: true, composed: true, detail: 2 })
      )
    }, rowSelector)
  }

  const input = await peer.$(inputSelector)
  await input.waitForDisplayed()
  await input.setValue(nextName)
  await peer.keys('Enter')
  await waitForVisibleLayerName(peer, nodeId, nextName)
}

async function disconnectWithUI(peer: NativePeer): Promise<void> {
  const connected = await peer.execute(
    () =>
      document.querySelector<HTMLElement>('[data-test-id="collab-share-button"]')?.dataset
        .connection === 'connected'
  )
  if (!connected) return
  await ensureCollabPopover(peer)
  const disconnect = await peer.$(SELECTORS.disconnect)
  await disconnect.waitForDisplayed()
  await disconnect.click()
  await waitForConnection(peer, 'idle')
}

async function cleanupPeer(peer: NativePeer, isolationKey: string): Promise<void> {
  const failures: unknown[] = []
  try {
    await disconnectWithUI(peer)
  } catch (error) {
    failures.push(error)
  }
  try {
    await peer.execute((key) => {
      // oxlint-disable-next-line open-pencil/no-direct-storage-access -- Isolation probe cleanup.
      localStorage.removeItem(key)
    }, isolationKey)
  } catch (error) {
    failures.push(error)
  }
  try {
    await removeFrontendErrorCapture(peer)
  } catch (error) {
    failures.push(error)
  }
  if (failures.length) throw new AggregateError(failures, 'Native peer cleanup failed')
}

async function collectDiagnostic(
  peer: NativePeer,
  role: PeerName,
  expectedPeer: string
): Promise<PeerDiagnostic> {
  return peer.execute(
    (peerName, peerRole, layerNames) => {
      const rows = [...document.querySelectorAll('[data-test-id="collab-peer-row"]')].filter(
        (row) => row instanceof HTMLElement && row.getClientRects().length > 0
      )
      const labels = [
        ...document.querySelectorAll('[data-test-id="layers-item"] [data-slot="label"]')
      ]
        .filter((label) => label instanceof HTMLElement && label.getClientRects().length > 0)
        .map((label) => label.textContent?.trim() ?? '')
      const capture = (window as FrontendErrorCaptureWindow).__OPENPENCIL_NATIVE_COLLAB_ERRORS__
      let route = '[other]'
      if (location.pathname.startsWith('/share/')) route = '/share/[room]'
      else if (location.pathname === '/') route = '/'
      let expectedLayer: PeerDiagnostic['expectedLayer'] = 'none'
      if (labels.includes(layerNames.bob)) expectedLayer = 'bob'
      else if (labels.includes(layerNames.alice)) expectedLayer = 'alice'
      else if (labels.includes(layerNames.initial)) expectedLayer = 'initial'
      return {
        role: peerRole,
        storeReady: Boolean(window.openPencil?.getStore?.()),
        route,
        connection:
          document.querySelector<HTMLElement>('[data-test-id="collab-share-button"]')?.dataset
            .connection ?? null,
        remotePeerCount: rows.length,
        seesExpectedPeer: rows.some((row) => row.textContent?.includes(peerName)),
        visibleLayerCount: labels.length,
        expectedLayer,
        frontendErrorKinds: capture?.errors.slice(-10) ?? []
      }
    },
    expectedPeer,
    role,
    { initial: INITIAL_LAYER_NAME, alice: ALICE_LAYER_NAME, bob: BOB_LAYER_NAME }
  ) as Promise<PeerDiagnostic>
}

describe('native collaboration', () => {
  it('synchronizes Alice and Bob through the real collaboration and layer UI', async () => {
    const alice = getPeer('alice')
    const bob = getPeer('bob')
    const isolationKey = `open-pencil-native-collab-${randomUUID()}`
    const isolationValue = `alice-${randomUUID()}`
    let failure: unknown
    let diagnostics: PeerDiagnostic[] = []
    const cleanupFailures: string[] = []
    const relay = await startRelay()

    try {
      await Promise.all([installFrontendErrorCapture(alice), installFrontendErrorCapture(bob)])
      await Promise.all([waitForEditor(alice, 'Alice'), waitForEditor(bob, 'Bob')])
      await Promise.all([
        configureTestTransport(alice, relay.url),
        configureTestTransport(bob, relay.url)
      ])

      await alice.execute(
        (key, value) => {
          // oxlint-disable-next-line open-pencil/no-direct-storage-access -- Explicit cross-WebView isolation probe.
          localStorage.setItem(key, value)
        },
        isolationKey,
        isolationValue
      )
      const aliceIsolationValue = await alice.execute((key) => {
        // oxlint-disable-next-line open-pencil/no-direct-storage-access -- Explicit cross-WebView isolation probe.
        return localStorage.getItem(key)
      }, isolationKey)
      assert.equal(aliceIsolationValue, isolationValue)
      assert.equal(
        await bob.execute((key) => {
          // oxlint-disable-next-line open-pencil/no-direct-storage-access -- Explicit cross-WebView isolation probe.
          return localStorage.getItem(key)
        }, isolationKey),
        null,
        'Alice and Bob share localStorage; refusing to continue in a non-isolated environment'
      )

      await ensureCollabPopover(alice)
      const aliceName = await alice.$(SELECTORS.nameInput)
      await aliceName.setValue('Alice')
      await alice.$(SELECTORS.shareFile).click()
      await waitForConnection(alice, 'connected')
      await ensureCollabPopover(alice)
      const roomLink = await alice.$(SELECTORS.roomLink)
      await roomLink.waitForDisplayed()
      const inviteLink = await roomLink.getValue()
      assert.ok(
        /\/share\/[^#?]+#k=/.test(inviteLink),
        'Alice did not produce a complete invite link'
      )

      await ensureCollabPopover(bob)
      await bob.$(SELECTORS.nameInput).setValue('Bob')
      await bob.$(SELECTORS.joinInput).setValue(inviteLink)
      await bob.$(SELECTORS.joinRoom).click()
      await waitForConnection(bob, 'connected')
      await Promise.all([ensureCollabPopover(alice), ensureCollabPopover(bob)])
      await Promise.all([waitForPeerName(alice, 'Bob'), waitForPeerName(bob, 'Alice')])
      await Promise.all([closeCollabPopover(alice), closeCollabPopover(bob)])

      relay.pause()
      const nodeId = await alice.execute(() => {
        const store = window.openPencil?.getStore?.()
        if (!store) throw new Error('Alice editor is not ready')
        const node = store.graph.createNode('RECTANGLE', store.state.currentPageId, {
          name: 'Native shared rectangle',
          x: 160,
          y: 140,
          width: 120,
          height: 80
        })
        store.requestRender()
        return node.id
      })
      await alice.waitUntil(async () => relay.queuedCount() > 0, {
        timeout: 10_000,
        timeoutMsg: 'Native collaboration traffic did not reach the loopback relay'
      })
      relay.resume()

      await Promise.all([
        waitForVisibleLayerName(alice, nodeId, INITIAL_LAYER_NAME),
        waitForVisibleLayerName(bob, nodeId, INITIAL_LAYER_NAME)
      ])
      await renameVisibleLayer(alice, nodeId, ALICE_LAYER_NAME)
      await waitForVisibleLayerName(bob, nodeId, ALICE_LAYER_NAME)
      await renameVisibleLayer(bob, nodeId, BOB_LAYER_NAME)
      await waitForVisibleLayerName(alice, nodeId, BOB_LAYER_NAME)

      await ensureCollabPopover(bob)
      await bob.$(SELECTORS.disconnect).click()
      await waitForConnection(bob, 'idle')
      await ensureCollabPopover(alice)
      await alice.waitUntil(
        async () =>
          alice.execute(() => {
            const peers = [...document.querySelectorAll('[data-test-id="collab-peer-row"]')].filter(
              (row) => row instanceof HTMLElement && row.getClientRects().length > 0
            )
            const popover = document.querySelector('[data-test-id="collab-popover"]')
            return peers.length === 0 && popover?.textContent?.includes('1 person in this room')
          }),
        { timeout: 30_000, timeoutMsg: 'Alice peer roster did not return to one person' }
      )
    } catch (error) {
      failure = error
      const snapshots = await Promise.allSettled([
        collectDiagnostic(alice, 'alice', 'Bob'),
        collectDiagnostic(bob, 'bob', 'Alice')
      ])
      diagnostics = snapshots.flatMap((snapshot) =>
        snapshot.status === 'fulfilled' ? [snapshot.value] : []
      )
      for (const snapshot of snapshots) {
        if (snapshot.status === 'rejected') {
          cleanupFailures.push(`diagnostic: ${sanitizeDiagnosticMessage(snapshot.reason)}`)
        }
      }
    } finally {
      const peerCleanup = await Promise.allSettled([
        cleanupPeer(alice, isolationKey),
        cleanupPeer(bob, isolationKey)
      ])
      for (const cleanup of peerCleanup) {
        if (cleanup.status === 'rejected') {
          cleanupFailures.push(`peer cleanup: ${sanitizeDiagnosticMessage(cleanup.reason)}`)
        }
      }
      try {
        await relay.close()
      } catch (error) {
        cleanupFailures.push(`relay cleanup: ${sanitizeDiagnosticMessage(error)}`)
      }
    }

    if (failure) {
      const state = sanitizeDiagnosticMessage(JSON.stringify(diagnostics))
      const cleanup = cleanupFailures.length ? `\nCleanup: ${cleanupFailures.join(' | ')}` : ''
      throw new Error(
        `Native collaboration smoke failed: ${sanitizeDiagnosticMessage(failure)}\nPeer state: ${state}${cleanup}`
      )
    }
    assert.deepEqual(cleanupFailures, [], cleanupFailures.join(' | '))
  })
})
