import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { buildOpenPencilAccordionComponent } from '#compiler/adapters/react/modules/accordion'
import { buildOpenPencilAudioPlayerComponent } from '#compiler/adapters/react/modules/audio-player'
import { buildOpenPencilCodeBlockComponent } from '#compiler/adapters/react/modules/code-block'
import { buildOpenPencilMarkdownComponent } from '#compiler/adapters/react/modules/markdown'
import { buildOpenPencilPDFViewerComponent } from '#compiler/adapters/react/modules/pdf-viewer'
import { buildOpenPencilTabsComponent } from '#compiler/adapters/react/modules/tabs'
import { chromium, type Browser, type Page } from '@playwright/test'

import { createPreviewServer, type PreviewServer } from '@open-pencil/compiler/dev-server'

const ORIGINAL_PDF_URL = 'https://assets.example.com/original.pdf'
const ALTERNATE_PDF_URL = 'https://assets.example.com/alternate.pdf'
const ORIGINAL_AUDIO_URL = 'https://assets.example.com/original.mp3'
const ALTERNATE_AUDIO_URL = 'https://assets.example.com/alternate.mp3'
const MARKDOWN_TRACKER_URL = 'https://assets.example.com/markdown-tracker.png'
const INERT_CODE =
  '<script>globalThis.__openPencilCodeExecuted = true</script>\nglobalThis.__openPencilCodeExecuted = true'

function buildRuntimeFiles(): Map<string, string | Uint8Array> {
  return new Map<string, string | Uint8Array>([
    [
      'index.html',
      '<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>'
    ],
    ['src/__openpencil_tabs.tsx', buildOpenPencilTabsComponent()],
    ['src/__openpencil_accordion.tsx', buildOpenPencilAccordionComponent()],
    ['src/__openpencil_code_block.tsx', buildOpenPencilCodeBlockComponent()],
    ['src/__openpencil_markdown.tsx', buildOpenPencilMarkdownComponent()],
    ['src/__openpencil_pdf_viewer.tsx', buildOpenPencilPDFViewerComponent({ devMode: true })],
    ['src/__openpencil_audio_player.tsx', buildOpenPencilAudioPlayerComponent({ devMode: true })],
    [
      'src/main.tsx',
      `import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import Accordion from './__openpencil_accordion'
import AudioPlayer from './__openpencil_audio_player'
import CodeBlock from './__openpencil_code_block'
import Markdown from './__openpencil_markdown'
import PdfViewer from './__openpencil_pdf_viewer'
import Tabs from './__openpencil_tabs'
import './index.css'

function tabsConfig(orientation: 'horizontal' | 'vertical', activationMode: 'automatic' | 'manual') {
  return {
    label: orientation === 'horizontal' ? 'Manual tabs' : 'Automatic tabs',
    tabs: [
      { id: 'first', label: 'First tab', content: 'First panel' },
      { id: 'second', label: 'Second tab', content: 'Second panel' },
      { id: 'third', label: 'Third tab', content: 'Third panel' }
    ],
    initialTabId: 'first',
    orientation,
    activationMode,
    showDivider: true,
    backgroundColor: '#FFFFFF',
    textColor: '#111827',
    accentColor: '#2563EB',
    fontSize: 14
  }
}

function accordionConfig() {
  return {
    label: 'Demo accordion',
    items: [
      { id: 'alpha', title: 'Alpha section', content: 'Alpha content' },
      { id: 'beta', title: 'Beta section', content: 'Beta content' },
      { id: 'gamma', title: 'Gamma section', content: 'Gamma content' }
    ],
    allowMultiple: false,
    initialOpenIds: ['alpha'],
    showDividers: true,
    backgroundColor: '#FFFFFF',
    textColor: '#111827',
    accentColor: '#2563EB',
    fontSize: 14
  }
}

function codeConfig() {
  return {
    label: 'Inert code sample',
    code: ${JSON.stringify(INERT_CODE)},
    language: 'javascript' as const,
    theme: 'dark' as const,
    showLineNumbers: true,
    wrapLines: false,
    showCopyButton: true,
    fontSize: 13,
    tabSize: 2,
    backgroundColor: '#111827',
    textColor: '#F9FAFB',
    accentColor: '#60A5FA'
  }
}

function markdownConfig() {
  return {
    source: ${JSON.stringify('![Tracking pixel](https://assets.example.com/markdown-tracker.png)')},
    flavor: 'gfm' as const,
    linkTarget: 'same-tab' as const,
    backgroundColor: '#FFFFFF',
    textColor: '#111827',
    headingColor: '#111827',
    accentColor: '#2563EB',
    fontSize: 14,
    lineHeight: 1.5
  }
}

function pdfConfig(revision: number) {
  return {
    sourceUrl: revision === 1 ? ${JSON.stringify(ALTERNATE_PDF_URL)} : ${JSON.stringify(ORIGINAL_PDF_URL)},
    title: 'Consent PDF',
    initialPage: 1,
    pageCountHint: 2,
    fit: 'width' as const,
    showToolbar: true,
    allowDownload: true,
    backgroundColor: '#E5E7EB',
    accentColor: '#374151'
  }
}

function audioConfig(revision: number) {
  return {
    src: revision === 1 ? ${JSON.stringify(ALTERNATE_AUDIO_URL)} : ${JSON.stringify(ORIGINAL_AUDIO_URL)},
    title: 'Consent audio',
    artist: 'OpenPencil',
    controls: true,
    autoplay: false,
    loop: false,
    muted: false,
    preload: 'metadata' as const,
    volume: 0.7,
    playbackRate: 1,
    backgroundColor: '#111827',
    textColor: '#F9FAFB',
    accentColor: '#60A5FA'
  }
}

function RuntimeHarness() {
  const [sourceRevision, setSourceRevision] = useState(0)
  return (
    <main>
      <button type="button" onClick={() => setSourceRevision(1)}>Use alternate sources</button>
      <button type="button" onClick={() => setSourceRevision(2)}>Restore original sources</button>
      <output aria-label="Source revision">{sourceRevision}</output>
      <Tabs config={tabsConfig('horizontal', 'manual')} style={{ height: 220, width: 520 }} />
      <Tabs config={tabsConfig('vertical', 'automatic')} style={{ height: 220, width: 520 }} />
      <Accordion config={accordionConfig()} style={{ height: 280, width: 520 }} />
      <CodeBlock config={codeConfig()} style={{ height: 240, width: 640 }} />
      <Markdown config={markdownConfig()} style={{ height: 120, width: 640 }} />
      <PdfViewer config={pdfConfig(sourceRevision)} style={{ height: 360, width: 520 }} />
      <AudioPlayer config={audioConfig(sourceRevision)} style={{ height: 120, width: 640 }} />
    </main>
  )
}

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')
createRoot(root).render(<RuntimeHarness />)
`
    ],
    [
      'src/index.css',
      'body { font-family: sans-serif; margin: 0; } main { display: grid; gap: 20px; padding: 20px; }'
    ]
  ])
}

describe('preview browser — phase 6 content module runtimes', () => {
  const timeoutMs = 30_000
  let server: PreviewServer | null = null
  let browser: Browser | null = null
  let page: Page | null = null

  beforeEach(async () => {
    server = await createPreviewServer({ initialFiles: buildRuntimeFiles() })
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 960, height: 760 } })
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          async writeText(value: string) {
            ;(
              window as typeof window & {
                __openPencilCopiedCode?: string
              }
            ).__openPencilCopiedCode = value
          }
        }
      })
    })
  }, timeoutMs)

  afterEach(async () => {
    try {
      await page?.close()
    } finally {
      try {
        await browser?.close()
      } finally {
        await server?.close()
        page = null
        browser = null
        server = null
      }
    }
  }, timeoutMs)

  test(
    'keeps tabs/accordion focus behavior accessible and code content inert',
    async () => {
      if (!server || !page) throw new Error('Missing module preview runtime')
      await page.route('https://assets.example.com/**', (route) => route.abort())
      await page.goto(server.url, { waitUntil: 'networkidle' })

      const manualList = page.getByRole('tablist', { name: 'Manual tabs' })
      const manualTabs = manualList.getByRole('tab')
      const firstManual = manualTabs.nth(0)
      const secondManual = manualTabs.nth(1)
      const thirdManual = manualTabs.nth(2)
      await firstManual.focus()
      await firstManual.press('ArrowRight')
      expect(await secondManual.evaluate((element) => element === document.activeElement)).toBe(
        true
      )
      expect(await firstManual.getAttribute('aria-selected')).toBe('true')
      expect(await secondManual.getAttribute('aria-selected')).toBe('false')
      await secondManual.press(' ')
      expect(await secondManual.getAttribute('aria-selected')).toBe('true')
      await secondManual.press('End')
      expect(await thirdManual.evaluate((element) => element === document.activeElement)).toBe(true)
      expect(await thirdManual.getAttribute('aria-selected')).toBe('false')
      await thirdManual.press('Enter')
      expect(await thirdManual.getAttribute('aria-selected')).toBe('true')
      await thirdManual.press('Tab')
      const activeManualPanel = page.getByRole('tabpanel', { name: 'Third tab' })
      expect(
        await activeManualPanel.evaluate((element) => element === document.activeElement)
      ).toBe(true)

      const automaticList = page.getByRole('tablist', { name: 'Automatic tabs' })
      const automaticTabs = automaticList.getByRole('tab')
      const firstAutomatic = automaticTabs.nth(0)
      const secondAutomatic = automaticTabs.nth(1)
      await firstAutomatic.focus()
      await firstAutomatic.press('ArrowDown')
      expect(await secondAutomatic.evaluate((element) => element === document.activeElement)).toBe(
        true
      )
      expect(await secondAutomatic.getAttribute('aria-selected')).toBe('true')
      await secondAutomatic.press('ArrowRight')
      expect(await secondAutomatic.evaluate((element) => element === document.activeElement)).toBe(
        true
      )

      const accordion = page.getByRole('region', { name: 'Demo accordion' })
      const alpha = accordion.getByRole('button', { name: 'Alpha section' })
      const beta = accordion.getByRole('button', { name: 'Beta section' })
      const gamma = accordion.getByRole('button', { name: 'Gamma section' })
      expect(await alpha.getAttribute('aria-expanded')).toBe('true')
      await alpha.focus()
      await alpha.press('ArrowDown')
      expect(await beta.evaluate((element) => element === document.activeElement)).toBe(true)
      await beta.press('End')
      expect(await gamma.evaluate((element) => element === document.activeElement)).toBe(true)
      await gamma.press('ArrowDown')
      expect(await alpha.evaluate((element) => element === document.activeElement)).toBe(true)
      await alpha.press('Enter')
      expect(await alpha.getAttribute('aria-expanded')).toBe('false')
      await alpha.press('ArrowDown')
      await beta.press('Enter')
      expect(await beta.getAttribute('aria-expanded')).toBe('true')

      const codeBlock = page.getByRole('region', { name: 'Inert code sample' })
      expect(await codeBlock.locator('code').textContent()).toBe(INERT_CODE)
      expect(await codeBlock.locator('script').count()).toBe(0)
      expect(
        await page.evaluate(
          () =>
            (window as typeof window & { __openPencilCodeExecuted?: boolean })
              .__openPencilCodeExecuted
        )
      ).toBeUndefined()
      await codeBlock.getByRole('button', { name: 'Copy' }).click()
      expect(
        await page.evaluate(
          () =>
            (window as typeof window & { __openPencilCopiedCode?: string }).__openPencilCopiedCode
        )
      ).toBe(INERT_CODE)
      expect(await codeBlock.locator('[aria-live="polite"]').textContent()).toBe('Copied')
    },
    timeoutMs
  )

  test(
    'keeps PDF/audio at zero requests before consent and revokes consent after every URL change',
    async () => {
      if (!server || !page) throw new Error('Missing module preview runtime')
      const assetRequests: string[] = []
      page.on('request', (request) => {
        if (request.url().startsWith('https://assets.example.com/')) {
          assetRequests.push(request.url())
        }
      })
      await page.route('https://assets.example.com/**', (route) => route.abort())
      await page.goto(server.url, { waitUntil: 'networkidle' })
      await page.waitForTimeout(100)
      expect(assetRequests).toEqual([])
      expect(await page.locator('[data-openpencil-markdown-image]').textContent()).toBe(
        '[Tracking pixel]'
      )
      expect(assetRequests).not.toContain(MARKDOWN_TRACKER_URL)

      const pdfViewer = page.locator('[data-openpencil-pdf-viewer]')
      const audioPlayer = page.locator('[data-openpencil-audio-player]')
      await Promise.all([
        page.waitForRequest((request) => request.url().startsWith(ORIGINAL_PDF_URL)),
        pdfViewer.getByRole('button', { name: 'Load PDF preview' }).click()
      ])
      await Promise.all([
        page.waitForRequest((request) => request.url().startsWith(ORIGINAL_AUDIO_URL)),
        audioPlayer.getByRole('button', { name: 'Load audio preview' }).click()
      ])
      const originalPDFRequests = assetRequests.filter((url) =>
        url.startsWith(ORIGINAL_PDF_URL)
      ).length
      const originalAudioRequests = assetRequests.filter((url) =>
        url.startsWith(ORIGINAL_AUDIO_URL)
      ).length
      expect(originalPDFRequests).toBeGreaterThan(0)
      expect(originalAudioRequests).toBeGreaterThan(0)

      await page.getByRole('button', { name: 'Use alternate sources' }).click()
      await expect(page.getByLabel('Source revision').textContent()).resolves.toBe('1')
      await page.waitForTimeout(100)
      expect(assetRequests.some((url) => url.startsWith(ALTERNATE_PDF_URL))).toBe(false)
      expect(assetRequests.some((url) => url.startsWith(ALTERNATE_AUDIO_URL))).toBe(false)
      expect(await pdfViewer.getByRole('button', { name: 'Load PDF preview' }).count()).toBe(1)
      expect(await audioPlayer.getByRole('button', { name: 'Load audio preview' }).count()).toBe(1)

      await page.getByRole('button', { name: 'Restore original sources' }).click()
      await expect(page.getByLabel('Source revision').textContent()).resolves.toBe('2')
      await page.waitForTimeout(150)
      expect(assetRequests.filter((url) => url.startsWith(ORIGINAL_PDF_URL))).toHaveLength(
        originalPDFRequests
      )
      expect(assetRequests.filter((url) => url.startsWith(ORIGINAL_AUDIO_URL))).toHaveLength(
        originalAudioRequests
      )
      expect(await pdfViewer.getByRole('button', { name: 'Load PDF preview' }).count()).toBe(1)
      expect(await audioPlayer.getByRole('button', { name: 'Load audio preview' }).count()).toBe(1)
    },
    timeoutMs
  )
})
