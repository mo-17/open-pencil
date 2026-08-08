import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { chromium, type Browser, type Locator, type Page } from '@playwright/test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { createPreviewServer, type PreviewServer } from '@open-pencil/compiler/dev-server'
import { createRichTextModuleFrameOverrides } from '@open-pencil/core/plugins'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

declare global {
  interface Window {
    __richTextPasteExecuted?: boolean
  }
}

const TYPED_TEXT = ' 编译器中可编辑'
const PASTED_TEXT = ' pasted <img src=x><script>not-executed</script>'

function buildRichTextEditorFiles(): Map<string, string | Uint8Array> {
  const graph = makeSceneGraph()
  const pageId = firstPageId(graph)
  graph.createNode('FRAME', pageId, {
    ...createRichTextModuleFrameOverrides({
      content: {
        type: 'doc',
        blocks: [
          {
            type: 'heading',
            level: 2,
            align: 'left',
            children: [{ type: 'text', text: 'Compiled rich text', marks: [{ type: 'bold' }] }]
          },
          {
            type: 'paragraph',
            align: 'left',
            children: [{ type: 'text', text: 'Editable body', marks: [] }]
          }
        ]
      }
    }),
    x: 24,
    y: 64,
    width: 560,
    height: 360
  })

  const files = compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({ packageName: 'rich-text-runtime-browser', devMode: false })
  }).files

  // Make a parent React state update re-render <App /> without remounting it.
  // The authored rich-text runtime must preserve its in-session edits across this boundary.
  files.set(
    'src/main.tsx',
    `import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

function RuntimeHarness() {
  const [revision, setRevision] = useState(0)
  return (
    <>
      <button
        type="button"
        onClick={() => setRevision((value) => value + 1)}
        style={{ position: 'fixed', right: 8, top: 8, zIndex: 9999 }}
      >
        Rerender host
      </button>
      <output aria-label="Host revision">{revision}</output>
      <App />
    </>
  )
}

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

createRoot(root).render(
  <StrictMode>
    <RuntimeHarness />
  </StrictMode>
)
`
  )
  return files
}

async function selectContents(locator: Locator): Promise<void> {
  await locator.evaluate((element) => {
    const selection = window.getSelection()
    if (!selection) throw new Error('Selection API is unavailable')
    const range = document.createRange()
    range.selectNodeContents(element)
    selection.removeAllRanges()
    selection.addRange(range)
  })
}

async function placeCaretAtEnd(locator: Locator): Promise<void> {
  await locator.evaluate((element) => {
    const selection = window.getSelection()
    if (!selection) throw new Error('Selection API is unavailable')
    const range = document.createRange()
    range.selectNodeContents(element)
    range.collapse(false)
    selection.removeAllRanges()
    selection.addRange(range)
    const editable = element.closest('[contenteditable="true"]') as HTMLElement | null
    editable?.focus()
  })
}

async function dispatchPlainTextPaste(editor: Locator): Promise<void> {
  await editor.evaluate((element, text) => {
    const transfer = new DataTransfer()
    transfer.setData('text/plain', text)
    transfer.setData(
      'text/html',
      '<img src="x" onerror="window.__richTextPasteExecuted = true"><script>window.__richTextPasteExecuted = true</script>'
    )
    element.dispatchEvent(
      new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: transfer
      })
    )
  }, PASTED_TEXT)
}

describe('preview browser — compiled rich text editor', () => {
  const timeoutMs = 30_000
  let server: PreviewServer | null = null
  let browser: Browser | null = null
  let page: Page | null = null

  beforeEach(async () => {
    server = await createPreviewServer({ initialFiles: buildRichTextEditorFiles() })
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 })
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
    'edits safely and preserves content across an outer React re-render',
    async () => {
      if (!server || !page) throw new Error('Missing rich-text preview runtime')
      await page.goto(server.url, { waitUntil: 'networkidle' })

      await page.locator('[data-openpencil-rich-text]').waitFor({ state: 'visible' })
      const editor = page.getByRole('textbox')
      expect(await editor.count()).toBe(1)
      expect(await editor.getAttribute('contenteditable')).toBe('true')
      expect(await editor.getAttribute('aria-multiline')).toBe('true')
      expect(await editor.evaluate((element) => (element as HTMLElement).isContentEditable)).toBe(
        true
      )

      const paragraph = editor.locator('p').filter({ hasText: 'Editable body' })
      await selectContents(paragraph)
      await page.getByRole('button', { name: 'Bold', exact: true }).click()
      expect(
        (await paragraph.locator('strong, b').allTextContents()).some((text) =>
          text.includes('Editable body')
        )
      ).toBe(true)

      await placeCaretAtEnd(paragraph)
      await page.keyboard.insertText(TYPED_TEXT)
      expect(await paragraph.textContent()).toContain(TYPED_TEXT)

      await placeCaretAtEnd(editor)
      await dispatchPlainTextPaste(editor)
      expect(await editor.textContent()).toContain(PASTED_TEXT)
      expect(await editor.locator('img, script').count()).toBe(0)
      expect(await page.evaluate(() => Boolean(window.__richTextPasteExecuted))).toBe(false)
      const formValue = await page
        .locator('[data-openpencil-rich-text-editor] input[type="hidden"]')
        .inputValue()
      expect(formValue).toContain(TYPED_TEXT)
      expect(formValue).toContain(PASTED_TEXT)

      await page.getByRole('button', { name: 'Rerender host', exact: true }).click()
      await page.waitForTimeout(50)
      const revision = page.getByLabel('Host revision')
      expect(await revision.count()).toBe(1)
      expect(await revision.textContent()).toBe('1')
      expect(await editor.textContent()).toContain(TYPED_TEXT)
      expect(await editor.textContent()).toContain(PASTED_TEXT)
      expect(await editor.evaluate((element) => element.outerHTML)).toContain('<strong')
    },
    timeoutMs
  )
})
