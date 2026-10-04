import { writeFile } from 'node:fs/promises'

import { test, type ConsoleMessage, type Page, type Request, type Response } from '@playwright/test'

const MAX_EVENTS = 40

interface FixtureConsoleEvent {
  type: string
  text: string
}
interface FixtureRequestEvent {
  path: string
  resourceType: string
  failure?: string
  status?: number
}

/** Only controlled fixtures use this collector; it never reads field values or response bodies. */
export function moduleFormDiagnostics(page: Page, origin: string) {
  const consoleEvents: FixtureConsoleEvent[] = []
  const requestEvents: FixtureRequestEvent[] = []
  const pageErrors: string[] = []
  const safePath = (url: string) => {
    try {
      const parsed = new URL(url)
      return parsed.origin === origin ? parsed.pathname : '[external request]'
    } catch {
      return '[invalid URL]'
    }
  }
  const safeMessage = (message: string) =>
    message.replace(/https?:\/\/[^\s"'<>]+/gu, safePath).slice(0, 600)
  const captureConsole = (message: ConsoleMessage) => {
    if (consoleEvents.length < MAX_EVENTS && ['error', 'warning'].includes(message.type()))
      consoleEvents.push({ type: message.type(), text: safeMessage(message.text()) })
  }
  const capturePageError = (error: Error) => {
    if (pageErrors.length < MAX_EVENTS) pageErrors.push(safeMessage(error.message))
  }
  const captureRequestFailure = (request: Request) => {
    if (requestEvents.length < MAX_EVENTS)
      requestEvents.push({
        path: safePath(request.url()),
        resourceType: request.resourceType(),
        failure: request.failure()?.errorText
      })
  }
  const captureResponse = (response: Response) => {
    if (response.status() >= 400 && requestEvents.length < MAX_EVENTS)
      requestEvents.push({
        path: safePath(response.url()),
        resourceType: response.request().resourceType(),
        status: response.status()
      })
  }
  page.on('console', captureConsole)
  page.on('pageerror', capturePageError)
  page.on('requestfailed', captureRequestFailure)
  page.on('response', captureResponse)
  return {
    async attach(): Promise<void> {
      const dom = await Promise.allSettled([
        page.evaluate(() => ({
          readyState: document.readyState,
          rootChildren: document.querySelector('#root')?.childElementCount ?? null,
          bodyElements: document.querySelector('body')?.querySelectorAll('*').length ?? 0,
          comboboxes: document.querySelectorAll('[role="combobox"],select').length,
          errorOverlay: document.querySelector('vite-error-overlay') !== null,
          moduleScriptPaths: Array.from(document.scripts)
            .filter((script) => script.type === 'module' && script.src)
            .map((script) => new URL(script.src).pathname)
        }))
      ])
      const first = dom[0]
      const path = test.info().outputPath('module-form-failure-diagnostics.json')
      await writeFile(
        path,
        JSON.stringify(
          {
            dom: first.status === 'fulfilled' ? first.value : { unavailable: true },
            consoleEvents,
            requestEvents,
            pageErrors
          },
          null,
          2
        )
      )
      await test.info().attach('module-form-failure-diagnostics', {
        path,
        contentType: 'application/json'
      })
    },
    dispose(): void {
      page.off('console', captureConsole)
      page.off('pageerror', capturePageError)
      page.off('requestfailed', captureRequestFailure)
      page.off('response', captureResponse)
    }
  }
}
