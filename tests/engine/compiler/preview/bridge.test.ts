// Fast source-contract coverage for the canvas↔preview bridge runtime. Real
// iframe/message/DOM behavior for both web targets is covered by the browser
// runtime suite next to this file.

import { describe, expect, test } from 'bun:test'

import { buildPreviewBridge } from '@open-pencil/compiler/adapters/react/preview-bridge'

const bridge = buildPreviewBridge()

describe('preview-bridge — channel sources (regression of Phase 0 §5.4)', () => {
  test('declares both message sources', () => {
    expect(bridge).toContain("const INBOUND_SOURCE = 'op-lowcode-editor'")
    expect(bridge).toContain("const OUTBOUND_SOURCE = 'op-lowcode-preview'")
  })

  test('boots from an exact iframe.name capability context', () => {
    expect(bridge).toContain("const CHANNEL_PROTOCOL = 'open-pencil-preview-v2'")
    expect(bridge).toContain('const candidate: unknown = JSON.parse(window.name)')
    expect(bridge).toContain(
      "hasExactKeys(candidate, ['protocol', 'channel', 'parentOrigin', 'transport'])"
    )
    expect(bridge).toContain('candidate.channel.length < 16')
    expect(bridge).toContain(
      "const canonicalTauriOrigin = candidate.parentOrigin === 'tauri://localhost'"
    )
    expect(bridge).toContain('!canonicalTauriOrigin &&')
    expect(bridge).toContain('parsed.origin !== candidate.parentOrigin')
  })

  test('authenticates source window, origin, channel, and exact payload shape', () => {
    expect(bridge).toContain('if (event.source !== window.parent) return')
    expect(bridge).toContain('if (event.origin !== frameContext.parentOrigin) return')
    expect(bridge).toContain('value.channel !== channel')
    expect(bridge).toContain("hasExactKeys(value, ['source', 'channel', 'type', 'id'])")
    expect(bridge).toContain("hasExactKeys(value, ['source', 'channel', 'type', 'route'])")
  })

  test('adds the channel to every outbound message and avoids wildcard targets', () => {
    expect(bridge).toContain(
      '{ ...payload, source: OUTBOUND_SOURCE, channel: frameContext.channel }'
    )
    expect(bridge).toContain('frameContext.parentOrigin')
    expect(bridge).not.toContain(
      "postMessage({ source: OUTBOUND_SOURCE, type: 'select', id }, '*')"
    )
    expect(bridge).toContain("frameContext.transport === 'message-port'")
    expect(bridge).toContain('window.__openPencilPreviewPort?.postMessage')
  })

  test('still mounts at most once per window via the __openPencilPreviewBridge guard', () => {
    expect(bridge).toContain('window.__openPencilPreviewBridge')
    expect(bridge).toContain('!window.__openPencilPreviewBridge')
  })
})

describe('preview-bridge — select channel (regression)', () => {
  test('inbound select still drives the overlay', () => {
    expect(bridge).toContain("type: 'select'")
    expect(bridge).toContain('updateOverlay()')
  })

  test('selection overlay chrome stays independent from generated app theme tokens', () => {
    expect(bridge).toContain('const PREVIEW_SELECTION_OVERLAY_BORDER =')
    expect(bridge).toContain('const PREVIEW_SELECTION_OVERLAY_BACKGROUND =')
    expect(bridge).toContain('overlay.style.border = PREVIEW_SELECTION_OVERLAY_BORDER')
    expect(bridge).toContain('overlay.style.background = PREVIEW_SELECTION_OVERLAY_BACKGROUND')
    expect(bridge).toContain('independent from generated app theme tokens')
  })

  test('Alt/Option-click still posts outbound select', () => {
    expect(bridge).toContain('event.altKey')
    expect(bridge).toContain("type: 'select', id")
  })
})

describe('preview-bridge — navigate channel (Phase 2 §7)', () => {
  test('inbound message type is widened to a select | navigate union', () => {
    expect(bridge).toContain('interface InboundSelect')
    expect(bridge).toContain('interface InboundNavigate')
    expect(bridge).toMatch(/type Inbound =\s*\| InboundSelect\s*\| InboundNavigate/)
  })

  test('inbound navigate replays into history.pushState + a synthetic popstate', () => {
    expect(bridge).toContain("if (data.type === 'navigate')")
    // The replay uses the aliased nativePushState so the patched pushState
    // does not re-enter itself.
    expect(bridge).toContain('nativePushState(null, ')
    expect(bridge).toContain("window.dispatchEvent(new PopStateEvent('popstate'))")
  })

  test('inbound navigate no-ops when iframe is already at the target route', () => {
    // Without this guard, initial-load navigate or duplicate watcher fires
    // would echo back outbound traffic on every reload.
    expect(bridge).toContain('location.pathname === route')
  })

  test('outbound navigate fires from a pushState monkeypatch', () => {
    // react-router-dom internal navigate() calls history.pushState without
    // dispatching popstate; the patch is the only way to observe it from
    // outside React.
    expect(bridge).toContain('const nativePushState = history.pushState.bind(history)')
    expect(bridge).toContain('history.pushState = function')
    expect(bridge).toContain('postOutboundNavigate(location.pathname)')
  })

  test('outbound navigate also fires on popstate (back/forward)', () => {
    expect(bridge).toContain("window.addEventListener('popstate'")
  })

  test('outbound navigate posts the contract payload to the parent window', () => {
    expect(bridge).toContain("postToParent({ type: 'navigate', route })")
    expect(bridge).toContain('window.parent.postMessage')
  })

  test('echo loop is broken by a suppressOutbound flag wrapping the inbound replay', () => {
    expect(bridge).toContain('let suppressOutbound = false')
    expect(bridge).toContain('suppressOutbound = true')
    // The reset has to live in `finally` so a thrown PopStateEvent constructor
    // (or a misbehaving popstate listener) cannot wedge the flag on.
    expect(bridge).toContain('} finally {')
    expect(bridge).toContain('if (suppressOutbound) return')
  })
})

describe('preview-bridge — runtime docState channel (Phase 3 §4.6)', () => {
  test('inbound union is widened with a docState member', () => {
    expect(bridge).toContain('interface InboundDocState')
    expect(bridge).toContain('interface InboundMotionDebug')
    expect(bridge).toMatch(
      /type Inbound =\s*\| InboundSelect\s*\| InboundNavigate\s*\| InboundDocState\s*\| InboundTheme\s*\| InboundMotionDebug/
    )
  })

  test('reads the zustand store from the window handle exposed by _lowcode_state', () => {
    expect(bridge).toContain('window.__opDocStore')
    // Both eval orders covered: wire now, or on the ready event.
    expect(bridge).toContain("'op-docstore-ready'")
  })

  test('outbound posts per-key changes via a store.subscribe diff', () => {
    expect(bridge).toContain('store.subscribe(')
    expect(bridge).toContain('if (state[name] !== prev[name])')
    expect(bridge).toContain("postToParent({ type: 'docState', name: name, value: state[name] })")
  })

  test('inbound docState applies via setState', () => {
    expect(bridge).toContain("if (data.type === 'docState')")
    expect(bridge).toContain('if (!Object.hasOwn(store.getState(), data.name)) return')
    expect(bridge).toContain('store.setState({ [data.name]: data.value })')
  })

  test('echo loop is broken by a dedicated suppressDocStateOutbound flag', () => {
    expect(bridge).toContain('let suppressDocStateOutbound = false')
    expect(bridge).toContain('if (suppressDocStateOutbound) return')
    expect(bridge).toContain('suppressDocStateOutbound = true')
  })
})

describe('preview-bridge — Theme channel', () => {
  test('validates and applies one explicit DOM theme contract', () => {
    expect(bridge).toContain('interface InboundTheme')
    expect(bridge).toContain("if (data.theme !== 'light' && data.theme !== 'dark') return")
    expect(bridge).toContain('root.dataset.theme = theme')
    expect(bridge).toContain("root.classList.toggle('light', theme === 'light')")
    expect(bridge).toContain("root.classList.toggle('dark', theme === 'dark')")
    expect(bridge).toContain('root.style.colorScheme = theme')
  })
})

describe('preview-bridge — Motion Debug channel', () => {
  test('calls the generated runtime inspect handle and posts structured snapshots', () => {
    expect(bridge).toContain("if (data.type === 'motionDebug')")
    expect(bridge).toContain("typeof runtime.inspect !== 'function'")
    expect(bridge).toContain('const snapshot = runtime.inspect()')
    expect(bridge).toContain('if (!validMotionDebugSnapshot(snapshot))')
    expect(bridge).toContain("postMotionDebug('ready', snapshot)")
    expect(bridge).toMatch(/type: 'motionDebug',\s*status,\s*snapshot,\s*error/)
  })

  test('bounds entry count, portable values, and inspect errors', () => {
    expect(bridge).toContain('const MAX_MOTION_DEBUG_ENTRIES = 256')
    expect(bridge).toContain('const MAX_PORTABLE_MESSAGE_BYTES = 256 * 1024')
    expect(bridge).toContain('if (bytes > MAX_PORTABLE_MESSAGE_BYTES) return false')
    expect(bridge).toContain('entries.length <= MAX_MOTION_DEBUG_ENTRIES')
    expect(bridge).toContain('validDocStateValue(value)')
    expect(bridge).toContain('Motion diagnostics exceed the preview safety limit.')
    expect(bridge).toContain('message.slice(0, MAX_DOC_STATE_STRING_LENGTH)')
  })

  test('polls only while enabled and stops immediately when disabled', () => {
    expect(bridge).toContain('motionDebugTimer = setInterval(inspectMotion, 250)')
    expect(bridge).toContain('clearInterval(motionDebugTimer)')
    expect(bridge).toContain('if (!enabled) return')
  })

  test('reports missing runtimes and inspect errors without throwing into the preview', () => {
    expect(bridge).toContain("postMotionDebug('unavailable')")
    expect(bridge).toContain("postMotionDebug('error'")
  })
})
