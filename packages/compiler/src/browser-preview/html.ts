import { failBrowserPreview } from './error'
import { BROWSER_PREVIEW_LIMITS } from './limits'

const encoder = new TextEncoder()

function scriptText(value: string): string {
  return value.replace(/<\/script/gi, '<\\/script')
}

function styleText(value: string): string {
  return value.replace(/<\/style/gi, '<\\/style')
}

export function buildBrowserPreviewHTML(input: {
  channel: string
  javascript: string
  css: string
  imports: Readonly<Record<string, string>>
  reviewedDataURLBytes: number
}): string {
  const importMap = JSON.stringify({ imports: input.imports }).replaceAll('<', '\\u003c')
  const channel = JSON.stringify(input.channel).replaceAll('<', '\\u003c')
  const bootstrap = `
const __opChannel = ${channel}
const __opParentOrigin = (() => {
  try {
    const context = JSON.parse(window.name)
    if (
      !context ||
      typeof context !== 'object' ||
      Array.isArray(context) ||
      Object.keys(context).length !== 4 ||
      context.protocol !== 'open-pencil-preview-v2' ||
      context.channel !== __opChannel ||
      typeof context.parentOrigin !== 'string' ||
      (context.transport !== 'window' && context.transport !== 'message-port')
    ) return null
    const parsed = new URL(context.parentOrigin)
    const canonicalTauriOrigin = context.parentOrigin === 'tauri://localhost'
    if (
      !canonicalTauriOrigin &&
      (parsed.origin !== context.parentOrigin || parsed.username || parsed.password)
    ) return null
    return { parentOrigin: context.parentOrigin, transport: context.transport }
  } catch {
    return null
  }
})()
const __opMessageChannel =
  __opParentOrigin?.transport === 'message-port' ? new MessageChannel() : null
window.__openPencilPreviewPort = __opMessageChannel?.port1 ?? null
let __opPortTransferred = false
const __opPostWindow = (type, payload = {}, transfer = []) => {
  if (!__opParentOrigin) return
  window.parent.postMessage(
    { ...payload, source: 'op-lowcode-preview', channel: __opChannel, type },
    __opParentOrigin.parentOrigin,
    transfer
  )
}
const __opPost = (type, payload = {}) => {
  if (__opPortTransferred && __opMessageChannel) {
    __opMessageChannel.port1.postMessage({
      ...payload,
      source: 'op-lowcode-preview',
      channel: __opChannel,
      type
    })
    return
  }
  __opPostWindow(type, payload)
}
const __opClearFrameBootContext = () => {
  window.name = ''
}
let __opRuntimeComplete = false
window.addEventListener('pagehide', __opClearFrameBootContext, { once: true })
window.addEventListener('load', () => {
  if (!__opRuntimeComplete) return
  if (__opMessageChannel) {
    __opPostWindow('ready', {}, [__opMessageChannel.port2])
    __opPortTransferred = true
  } else {
    __opPostWindow('ready')
  }
}, { once: true })
window.addEventListener('error', (event) => {
  __opPost('runtimeError', {
    message: String(event.message || 'Preview runtime error').slice(0, 500)
  })
})
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason
  __opPost('runtimeError', {
    message: String(reason instanceof Error ? reason.message : reason).slice(0, 500)
  })
})
`
  const javascript = `${bootstrap}\n${input.javascript}\n__opRuntimeComplete = true\n__opClearFrameBootContext()\n`
  const csp = [
    "default-src 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "child-src 'none'",
    "worker-src 'none'",
    "connect-src 'none'",
    "form-action 'none'",
    'img-src data: blob:',
    'font-src data:',
    'media-src data: blob:',
    "style-src 'unsafe-inline'",
    "script-src 'unsafe-inline' https://esm.sh"
  ].join('; ')
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="referrer" content="no-referrer">
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <title>OpenPencil browser preview</title>
    <script type="importmap">${importMap}</script>
    <style>${styleText(input.css)}</style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module">${scriptText(javascript)}</script>
  </body>
</html>
`
  const htmlBytes = encoder.encode(html).byteLength
  if (
    !Number.isSafeInteger(input.reviewedDataURLBytes) ||
    input.reviewedDataURLBytes < 0 ||
    input.reviewedDataURLBytes > BROWSER_PREVIEW_LIMITS.maxAssetExpandedCSSBytes ||
    input.reviewedDataURLBytes > htmlBytes
  ) {
    failBrowserPreview(
      'browser-preview-reviewed-asset-output-limit',
      'Browser preview reviewed assets exceed the sandbox document allowance.'
    )
  }
  const nonAssetHTMLBytes = htmlBytes - input.reviewedDataURLBytes
  if (
    htmlBytes > BROWSER_PREVIEW_LIMITS.maxAssetExpandedHTMLBytes ||
    nonAssetHTMLBytes > BROWSER_PREVIEW_LIMITS.maxHTMLBytes
  ) {
    failBrowserPreview(
      'browser-preview-html-output-limit',
      `Browser preview sandbox document exceeds the output byte limit. ${htmlBytes} total bytes, ${nonAssetHTMLBytes} bytes excluding reviewed assets; limits are ${BROWSER_PREVIEW_LIMITS.maxAssetExpandedHTMLBytes} and ${BROWSER_PREVIEW_LIMITS.maxHTMLBytes}.`
    )
  }
  return html
}
