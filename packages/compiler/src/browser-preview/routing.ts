import { failBrowserPreview } from './error'
import type { BrowserPreviewDiagnostic } from './types'

function occurrences(source: string, token: string): number {
  return source.split(token).length - 1
}

function instrumentPreviewBridge(source: string): string {
  const outboundMarker = "const OUTBOUND_SOURCE = 'op-lowcode-preview'"
  const protocolMarker = "const CHANNEL_PROTOCOL = 'open-pencil-preview-v2'"
  const frameContextMarker =
    "const frameContext = typeof window === 'undefined' ? null : readFrameContext()"
  const pushMarker = "nativePushState(null, '', route)"
  if (
    occurrences(source, outboundMarker) !== 1 ||
    occurrences(source, protocolMarker) !== 1 ||
    occurrences(source, frameContextMarker) !== 1 ||
    !source.includes('parseInbound(event.data, frameContext.channel)') ||
    !source.includes('event.origin !== frameContext.parentOrigin') ||
    occurrences(source, pushMarker) !== 1
  ) {
    failBrowserPreview(
      'browser-preview-bridge-contract-unsupported',
      'Browser preview cannot safely instrument this generated preview bridge.',
      'src/__preview-bridge.ts'
    )
  }
  const routeHelper = `
function currentPreviewRoute(): string {
  const value = location.hash.startsWith('#') ? location.hash.slice(1) : '/'
  return value.startsWith('/') ? value : '/'
}`
  let output = source.replace(frameContextMarker, `${routeHelper}\n\n${frameContextMarker}`)
  output = output.replaceAll('location.pathname', 'currentPreviewRoute()')
  output = output.replace(pushMarker, "nativePushState(null, '', `#${route}`)")
  if (
    !output.includes('currentPreviewRoute()') ||
    !output.includes(`channel: frameContext.channel`)
  ) {
    failBrowserPreview(
      'browser-preview-bridge-contract-unsupported',
      'Browser preview failed to apply the isolated bridge channel.',
      'src/__preview-bridge.ts'
    )
  }
  return output
}

export function prepareBrowserPreviewReactFiles(
  input: ReadonlyMap<string, string | Uint8Array>,
  _channel: string
): { files: Map<string, string | Uint8Array>; diagnostics: BrowserPreviewDiagnostic[] } {
  const files = new Map(input)
  const appPath = 'src/App.tsx'
  const app = files.get(appPath)
  if (typeof app !== 'string') {
    failBrowserPreview(
      'browser-preview-entry-missing',
      'Browser preview requires the generated React App module.',
      appPath
    )
  }
  const importToken = "import { BrowserRouter, Route, Routes } from 'react-router-dom'"
  if (app.includes('BrowserRouter')) {
    if (
      occurrences(app, importToken) !== 1 ||
      occurrences(app, '<BrowserRouter>') !== 1 ||
      occurrences(app, '</BrowserRouter>') !== 1
    ) {
      failBrowserPreview(
        'browser-preview-routing-contract-unsupported',
        'Browser preview cannot safely adapt this generated router to Blob URL routing.',
        appPath
      )
    }
    files.set(
      appPath,
      app
        .replace(importToken, "import { HashRouter, Route, Routes } from 'react-router-dom'")
        .replace('<BrowserRouter>', '<HashRouter>')
        .replace('</BrowserRouter>', '</HashRouter>')
    )
  }
  const bridgePath = 'src/__preview-bridge.ts'
  const bridge = files.get(bridgePath)
  if (typeof bridge !== 'string') {
    failBrowserPreview(
      'browser-preview-bridge-missing',
      'Browser preview requires a dev-mode compiler preview bridge.',
      bridgePath
    )
  }
  files.set(bridgePath, instrumentPreviewBridge(bridge))
  return { files, diagnostics: [] }
}
