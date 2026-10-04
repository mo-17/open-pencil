import { execFileSync } from 'node:child_process'

import type { Locator, Page } from '@playwright/test'

import { withComponentTemplateFiles } from '../templates/browser'

export async function withVueRichText(page: Page, run: () => Promise<void>): Promise<void> {
  const source = `import { vueRichTextFixture } from './tests/helpers/compiler/components/vue-rich-text/fixture'; process.stdout.write(JSON.stringify([...vueRichTextFixture()]));`
  const files = new Map(
    JSON.parse(
      execFileSync('bun', ['-e', source], {
        cwd: process.cwd(),
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024
      })
    ) as [string, string][]
  )
  await withComponentTemplateFiles(page, 'vue', files, run)
}

/** Synthetic browser composition events exercise the component lifecycle, not OS IME delivery. */
export async function beginRichTextComposition(editor: Locator, text: string): Promise<void> {
  await editor.evaluate((element, value) => {
    element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '中' }))
    const paragraph = document.createElement('p')
    paragraph.textContent = value
    paragraph.setAttribute('data-composition-marker', '')
    element.replaceChildren(paragraph)
    element.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        isComposing: true,
        inputType: 'insertCompositionText',
        data: value
      })
    )
  }, text)
}

export async function finishRichTextComposition(editor: Locator): Promise<void> {
  await editor.evaluate((element) => {
    element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '中文' }))
    element.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        isComposing: false,
        inputType: 'insertText',
        data: '中文'
      })
    )
  })
}
