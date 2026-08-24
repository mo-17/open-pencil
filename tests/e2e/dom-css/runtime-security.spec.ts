import process from 'node:process'

import { expect, test } from '../fixtures'

const BROWSER_RUNTIME_MODULE = `http://localhost:1420/@fs${process.cwd()}/packages/dom-css/src/runtime/browser.ts`
const REMOTE_ORIGIN = 'https://security-probe.invalid'

test.describe('@open-pencil/dom-css inert browser boundary', () => {
  test('does not execute active markup or fetch external resources in either sandbox', async ({
    page
  }) => {
    await page.goto('http://localhost:1420/@vite/client', { waitUntil: 'domcontentloaded' })
    await page.setContent('<main>DOM/CSS security probe</main>')
    const externalRequests: string[] = []
    page.on('request', (request) => {
      if (request.url().startsWith(REMOTE_ORIGIN)) externalRequests.push(request.url())
    })

    const result = await page.evaluate(
      async ({ modulePath, remoteOrigin }) => {
        const marker = '__openPencilDOMCSSSecurityProbe'
        const globalRecord = globalThis as typeof globalThis & Record<string, unknown>
        globalRecord[marker] = 0
        customElements.define(
          'security-probe',
          class extends HTMLElement {
            connectedCallback() {
              globalRecord[marker] = Number(globalRecord[marker]) + 1
            }
          }
        )

        const { createBrowserCSSRuntime } = await import(modulePath)
        const source = `
          <main class="card" onclick="globalThis.${marker} = 1">
            <script>globalThis.${marker} = 2</script>
            <iframe srcdoc="<script>globalThis.${marker} = 3</script>"></iframe>
            <security-probe></security-probe>
            <img alt="Remote" src="${remoteOrigin}/pixel" onerror="globalThis.${marker} = 4">
          </main>
        `
        const outputs: Array<{ sandbox: string; html: string; source: unknown; width: unknown }> =
          []
        for (const sandbox of ['iframe', 'shadow-root'] as const) {
          const runtime = createBrowserCSSRuntime({ document, sandbox })
          const parsed = runtime.parseHTML(source)
          const computed = await runtime.computeStyles(
            parsed,
            '.card { width: 123px; color: red; }'
          )
          const root = computed.children[0]
          const image = root?.type === 'element' ? root.children[0] : undefined
          outputs.push({
            sandbox,
            html: runtime.serializeHTML(parsed),
            source: image?.type === 'element' ? image.attrs.src : undefined,
            width: root?.type === 'element' ? root.computedStyle?.width : undefined
          })
        }

        let rejectedExternalCSS = false
        try {
          const runtime = createBrowserCSSRuntime({ document, sandbox: 'shadow-root' })
          const parsed = runtime.parseHTML('<main class="card">Safe</main>')
          await runtime.computeStyles(
            parsed,
            String.raw`.card { background-image: u\72l(${remoteOrigin}/background); }`
          )
        } catch (error) {
          rejectedExternalCSS =
            error instanceof TypeError &&
            error.message.includes('rejected active or external CSS resource syntax')
        }

        return { marker: globalRecord[marker], outputs, rejectedExternalCSS }
      },
      { modulePath: BROWSER_RUNTIME_MODULE, remoteOrigin: REMOTE_ORIGIN }
    )
    await page.waitForTimeout(100)

    expect(result.marker).toBe(0)
    expect(result.rejectedExternalCSS).toBe(true)
    expect(externalRequests).toEqual([])
    for (const output of result.outputs) {
      expect(output.width).toBe('123px')
      expect(output.source).toBe(`${REMOTE_ORIGIN}/pixel`)
      expect(output.html).toContain(`src="${REMOTE_ORIGIN}/pixel"`)
      expect(output.html).not.toMatch(/<(?:script|iframe|security-probe)\b|\son(?:click|error)=/i)
    }
  })
})
