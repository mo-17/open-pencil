import { expect, test } from 'bun:test'
import { existsSync } from 'node:fs'

import { emitBrowserAuthentication } from '#compiler/backend/nestjs/browser-auth'
import { chromium, webkit, expect as browserExpect } from '@playwright/test'

import { createPreviewServer } from '@open-pencil/compiler/dev-server'

import { browserApplication, browserGraph, compileBrowser } from '../browser-client/helpers'
import { OIDC_LIFETIME_STUB } from './helpers'

const previewOrigin = 'http://127.0.0.1:5181'
const relayPath = '/_openpencil/preview-auth'
const requestId = 'R'.repeat(43)
const pollToken = 'P'.repeat(43)

function generatedRouterFixture(target: 'react' | 'vue') {
  const fixture = browserGraph()
  for (const page of [fixture.login, fixture.notes]) {
    for (const id of page.childIds) {
      const node = fixture.graph.getNode(id)
      if (node?.type === 'BUTTON') {
        fixture.graph.updateNode(id, {
          x: 24,
          y: 80,
          width: 180,
          height: 40,
          interactiveProps: { text: node.name }
        })
      }
    }
  }
  fixture.graph.updateNode(fixture.list.id, { x: 24, y: 180, width: 400, height: 240 })
  fixture.graph.updateNode(fixture.form.id, { x: 24, y: 500 })
  fixture.graph.createNode('TEXT', fixture.notes.id, {
    text: 'Authenticated notes page',
    x: 24,
    y: 24,
    width: 400,
    height: 40
  })
  const application = browserApplication()
  const files = compileBrowser(target, fixture, application).files
  // Exercise the real emitted auth/routers in Chromium; cryptographic protocol
  // verification belongs to the separate OIDC suite, so only its library is stubbed.
  files.set(
    'src/lowcode-backend-auth.ts',
    emitBrowserAuthentication(application, { previewRelay: true }).replace(
      "import * as oidc from 'openid-client'",
      "import * as oidc from './test-oidc'"
    )
  )
  files.set('src/test-oidc.ts', OIDC_LIFETIME_STUB)
  return files
}

function shellHTML(parentOrigin: string): string {
  const context = {
    protocol: 'open-pencil-preview-v2',
    channel: 'preview-channel-1234567890',
    parentOrigin,
    transport: 'window'
  }
  return `<!doctype html><html><body><output></output><script>
const frame = document.createElement('iframe')
frame.title = 'Connected application'
frame.style.cssText = 'width:900px;height:800px'
frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms')
frame.name = ${JSON.stringify(JSON.stringify(context))}
frame.src = ${JSON.stringify(previewOrigin + '/login')}
document.body.append(frame)
window.addEventListener('message', (event) => {
  if (event.source !== frame.contentWindow || event.origin !== ${JSON.stringify(previewOrigin)} ||
      event.data.type !== 'openpencil:local-backend-sign-in') return
  document.querySelector('output').textContent = JSON.stringify(event.data)
  frame.contentWindow.postMessage({ ...event.data, type: 'openpencil:local-backend-sign-in-result', opened: true }, event.origin)
})
</script></body></html>`
}

type PreviewBrowserEngine = 'chromium' | 'webkit'

async function runPreviewRouter(
  target: 'react' | 'vue',
  engine: PreviewBrowserEngine
): Promise<void> {
  const files = generatedRouterFixture(target)
  const browser = await (engine === 'webkit'
    ? webkit.launch()
    : chromium.launch({ args: ['--enable-unsafe-swiftshader'] }))
  const server = await createPreviewServer({ target, initialFiles: files }).catch(
    async (error: unknown) => {
      await browser.close()
      throw error
    }
  )
  const page = await browser.newPage()
  const errors: string[] = []
  let iframeLoads = 0
  let authenticatedReads = 0
  let state = ''
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    // The app keeps its registered callback origin. Route forwarding avoids
    // binding or contacting port 5181, which may belong to a user's session.
    await page.route(previewOrigin + '/**', async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      if (url.pathname === relayPath) {
        const authorization = new URL(request.postDataJSON().authorizationURL)
        state = authorization.searchParams.get('state') ?? ''
        await route.fulfill({ status: 201, json: { requestId, pollToken } })
      } else if (url.pathname === relayPath + '/result/' + requestId) {
        expect(request.headers().authorization).toBe('Bearer ' + pollToken)
        await route.fulfill({
          json: {
            callbackURL: previewOrigin + '/_openpencil/auth/callback?code=once&state=' + state
          }
        })
      } else if (url.pathname === relayPath + '/' + requestId) {
        await route.fulfill({ status: 204, body: '' })
      } else if (url.pathname.startsWith('/api/')) {
        expect(request.headers().authorization).toBe('Bearer header.payload.signature')
        authenticatedReads++
        await route.fulfill({ json: { data: [], nextCursor: null } })
      } else {
        if (request.isNavigationRequest()) iframeLoads++
        const path = url.pathname === '/login' ? '/' : url.pathname + url.search
        const response = await route.fetch({ url: new URL(path, server.url).href })
        await route.fulfill({ response })
      }
    })
    await page.routeWebSocket('ws://127.0.0.1:5181/**', (socket) => socket.close())
    await page.route(server.url + 'editor-shell', (route) =>
      route.fulfill({ contentType: 'text/html', body: shellHTML(new URL(server.url).origin) })
    )
    await page.goto(server.url + 'editor-shell')
    const application = page.frameLocator('iframe')
    await application.getByRole('button', { name: 'Login', exact: true }).click()
    await browserExpect(application.getByText('Authenticated notes page')).toBeVisible()
    const frame = page.frames().find((candidate) => candidate.url().startsWith(previewOrigin))
    expect(frame?.url()).toBe(previewOrigin + '/notes')
    await browserExpect.poll(() => authenticatedReads).toBeGreaterThan(0)
    expect(iframeLoads).toBe(1)
    expect(JSON.parse(await page.locator('output').innerText())).toEqual({
      type: 'openpencil:local-backend-sign-in',
      version: 1,
      channel: 'preview-channel-1234567890',
      requestId
    })
    if (!frame) throw new Error('Expected embedded frame')
    await frame.evaluate(async () => {
      const source = '/src/lowcode-backend-auth.ts'
      const auth = await import(source)
      const original = Date.now
      const future = original() + 3600001
      Date.now = () => future
      try {
        auth.getSession()
      } finally {
        Date.now = original
      }
    })
    await browserExpect(
      application.locator('[data-openpencil-auth-error="expired"]')
    ).toContainText('Failed changes will not be submitted again')
    await application.getByRole('button', { name: 'Sign in again', exact: true }).click()
    await browserExpect(application.getByText('Authenticated notes page')).toBeVisible()
    await browserExpect(application.locator('[data-openpencil-auth-error]')).toHaveCount(0)
    expect(frame.url()).toBe(previewOrigin + '/notes')
    expect(iframeLoads).toBe(1)
    await application.getByRole('button', { name: 'Logout', exact: true }).click()
    await browserExpect(
      application.getByRole('button', { name: 'Login', exact: true })
    ).toBeVisible()
    await browserExpect(application.getByText('Authenticated notes page')).toHaveCount(0)
    expect(frame.url()).toBe(previewOrigin + '/login')
    expect(iframeLoads).toBe(1)
    await frame.goto(previewOrigin + '/login')
    await browserExpect(
      application.getByRole('button', { name: 'Login', exact: true })
    ).toBeVisible()
    await browserExpect(application.locator('[data-openpencil-auth-error]')).toHaveCount(0)
    expect(errors).toEqual([])
  } catch (error) {
    const frame = page.frames().find((candidate) => candidate.url().startsWith(previewOrigin))
    throw new Error(
      JSON.stringify({
        error: String(error),
        errors,
        iframeLoads,
        authenticatedReads,
        frameURL: frame?.url(),
        text: await frame?.locator('body').innerText(),
        context: await frame?.evaluate(() => ({
          name: window.name,
          origin: location.origin
        })),
        registered: state.length > 0,
        message: await page.locator('output').innerText()
      })
    )
  } finally {
    await page.close()
    await browser.close()
    await server.close()
  }
}

if (import.meta.main && process.argv[2] === '--preview-auth-browser') {
  const target = process.argv[3]
  const engine = process.argv[4] ?? 'chromium'
  if (target !== 'react' && target !== 'vue') throw new Error('Expected a preview framework')
  if (engine !== 'chromium' && engine !== 'webkit') throw new Error('Expected a browser engine')
  await runPreviewRouter(target, engine)
} else {
  for (const engine of ['chromium', 'webkit'] as const) {
    const browserTest =
      engine === 'webkit' && !existsSync(webkit.executablePath()) ? test.skip : test
    browserTest.each(['react', 'vue'] as const)(
      `%s router in ${engine} resumes embedded authentication without reloading and clears it on logout`,
      async (target) => {
        // Isolate native browser transport from Bun's in-process test lifecycle.
        const child = Bun.spawn(
          [process.execPath, import.meta.path, '--preview-auth-browser', target, engine],
          {
            stdout: 'pipe',
            stderr: 'pipe'
          }
        )
        const timer = setTimeout(() => child.kill(), 55000)
        try {
          const [code, stdout, stderr] = await Promise.all([
            child.exited,
            new Response(child.stdout).text(),
            new Response(child.stderr).text()
          ])
          if (code !== 0)
            throw new Error(`Preview browser fixture exited ${code}.\n${stdout}${stderr}`)
          expect(code).toBe(0)
        } finally {
          clearTimeout(timer)
          child.kill()
        }
      },
      60000
    )
  }
}
