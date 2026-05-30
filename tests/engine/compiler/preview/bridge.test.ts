// Phase 2 §7 — string-level coverage for the canvas↔preview bridge runtime.
// The bridge is a template literal that Vite compiles inside the iframe build,
// so we can't import + evaluate it here without spinning up jsdom (not in the
// compiler test rig). Coverage is therefore by `toContain` on the emitted
// source — enough to pin the protocol changes that wired §7's navigate channel
// and prevent silent regressions on the suppress-loop guard or the pushState
// monkeypatch.
//
// Behavioural verification (inbound navigate → pushState replay, outbound on
// router-internal nav, echo suppression) is covered by the §7.5 #4 Tauri user
// test — the bridge has to run in a real iframe with react-router-dom mounted.

import { describe, expect, test } from 'bun:test'

import { buildPreviewBridge } from '@open-pencil/compiler/adapters/react/preview-bridge'

const bridge = buildPreviewBridge()

describe('preview-bridge — channel sources (regression of Phase 0 §5.4)', () => {
  test('declares both message sources', () => {
    expect(bridge).toContain("const INBOUND_SOURCE = 'op-lowcode-editor'")
    expect(bridge).toContain("const OUTBOUND_SOURCE = 'op-lowcode-preview'")
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

  test('Alt/Option-click still posts outbound select', () => {
    expect(bridge).toContain('event.altKey')
    expect(bridge).toContain("type: 'select', id")
  })
})

describe('preview-bridge — navigate channel (Phase 2 §7)', () => {
  test('inbound message type is widened to a select | navigate union', () => {
    expect(bridge).toContain('interface InboundSelect')
    expect(bridge).toContain('interface InboundNavigate')
    expect(bridge).toContain('type Inbound = InboundSelect | InboundNavigate')
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
    // Single source of truth: postOutboundNavigate composes the message;
    // this regex tolerates whitespace + quoting variants.
    expect(bridge).toMatch(/source: OUTBOUND_SOURCE,\s*type: 'navigate',\s*route/)
    expect(bridge).toContain('window.parent?.postMessage')
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
    expect(bridge).toContain('type Inbound = InboundSelect | InboundNavigate | InboundDocState')
  })

  test('reads the zustand store from the window handle exposed by _lowcode_state', () => {
    expect(bridge).toContain('window.__opDocStore')
    // Both eval orders covered: wire now, or on the ready event.
    expect(bridge).toContain("'op-docstore-ready'")
  })

  test('outbound posts per-key changes via a store.subscribe diff', () => {
    expect(bridge).toContain('store.subscribe(')
    expect(bridge).toContain('if (state[name] !== prev[name])')
    expect(bridge).toMatch(/source: OUTBOUND_SOURCE,\s*type: 'docState',\s*name: name,\s*value:/)
  })

  test('inbound docState applies via setState', () => {
    expect(bridge).toContain("if (data.type === 'docState')")
    expect(bridge).toContain('store.setState({ [data.name]: data.value })')
  })

  test('echo loop is broken by a dedicated suppressDocStateOutbound flag', () => {
    expect(bridge).toContain('let suppressDocStateOutbound = false')
    expect(bridge).toContain('if (suppressDocStateOutbound) return')
    expect(bridge).toContain('suppressDocStateOutbound = true')
  })
})
