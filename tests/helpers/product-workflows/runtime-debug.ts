/** Serializable native fixture matching the browser's real React action + bound input workflow. */
export function createNativeRuntimeDebugDocument() {
  const store = window.openPencil?.getStore?.()
  if (!store) throw new Error('Native runtime debug editor is unavailable')
  const page = store.graph.getNode(store.state.currentPageId)
  if (!page?.parentId) throw new Error('Native runtime debug page has no document root')
  store.graph.updateNode(page.parentId, {
    lowcodeDocumentState: [
      { id: 'debug-value', name: 'debugValue', type: 'string', defaultValue: 'initial' },
      { id: 'debug-result', name: 'debugResult', type: 'object', defaultValue: {} }
    ]
  })
  const button = store.graph.createNode('BUTTON', store.state.currentPageId, {
    name: 'Run trace',
    text: 'Run trace',
    x: 24,
    y: 24,
    width: 180,
    height: 40,
    interactiveProps: { text: 'Run trace' },
    events: {
      onClick: [
        {
          id: 'debug-write',
          kind: 'setVariable',
          targetName: 'debugValue',
          valueExpr: '"private-debug-value"'
        },
        // A deliberately refused localhost port exercises a real failed fetch;
        // no mock response, external server or relaxed CSP is involved.
        {
          id: 'debug-fetch',
          kind: 'apiCall',
          method: 'GET',
          url: 'http://127.0.0.1:1/result?token=private-url-value',
          targetName: 'debugResult'
        }
      ]
    }
  })
  const input = store.graph.createNode('INPUT', store.state.currentPageId, {
    name: 'Debug value',
    x: 24,
    y: 80,
    width: 200,
    height: 40,
    interactiveProps: { placeholder: 'Debug value' },
    bindings: { value: { kind: 'docState', docStateName: 'debugValue' } }
  })
  store.select([])
  return { buttonId: button.id, inputId: input.id }
}

export function nativeRuntimeDebugPreviewState() {
  const pane = document.querySelector('[data-test-id="lowcode-preview-pane"]')
  const frame = pane?.querySelector<HTMLIFrameElement>('iframe[aria-label="lowcode preview"]')
  let driverCanAccessFrame = false
  if (frame) {
    try {
      driverCanAccessFrame = Boolean(frame.contentDocument?.documentElement)
    } catch (error) {
      // Only the expected same-origin denial means this transport cannot enter the frame.
      if (!(error instanceof DOMException) || error.name !== 'SecurityError') throw error
    }
  }
  return {
    phase: pane?.getAttribute('data-preview-status') ?? null,
    host: pane?.getAttribute('data-preview-host') ?? null,
    driverCanAccessFrame,
    crossOriginFrame: Boolean(
      frame && new URL(frame.src, location.href).origin !== location.origin
    ),
    diagnostics:
      pane
        ?.querySelector('[data-test-id="lowcode-preview-diagnostics"]')
        ?.textContent?.slice(0, 512) ?? ''
  }
}

export function nativeRuntimeDebugObservation() {
  const panel = document.querySelector('[data-property="runtime-debug"]')
  return {
    text: panel?.textContent ?? '',
    entries: [...(panel?.querySelectorAll('ol > li') ?? [])].map((entry) => ({
      kind: entry.getAttribute('data-kind'),
      status: entry.getAttribute('data-status'),
      trace: entry.getAttribute('data-trace'),
      label: entry.querySelector('code')?.textContent ?? ''
    }))
  }
}
