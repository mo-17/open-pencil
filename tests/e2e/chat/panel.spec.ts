import { expect, test, type Page } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

const USE_REAL_LLM = process.env.TEST_REAL_LLM === '1'
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY ?? ''

let page: Page
let canvas: CanvasHelper

test.describe.configure({ mode: 'serial' })

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage()
  await page.goto('/')
  await page.evaluate(async () => {
    const themeModulePath = '/src/app/shell/theme.ts'
    const themeModule = await import(themeModulePath)
    themeModule.useAppTheme().setTheme('dark')
  })
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
  canvas = new CanvasHelper(page)
  await canvas.waitForInit()

  if (!USE_REAL_LLM) {
    await injectMockTransport(page)
  }
})

test.afterAll(async () => {
  await page.close()
})

async function injectMockTransport(page: Page) {
  await page.evaluate(() => {
    const setChatTransport = window.openPencil?.setChatTransport
    if (!setChatTransport) throw new Error('Transport override not available')

    let msgCounter = 0

    setChatTransport(() => ({
      async sendMessages({
        messages
      }: {
        messages: Array<{
          role: string
          parts: Array<{ type: string; text?: string; mediaType?: string; url?: string }>
        }>
      }) {
        const lastUser = [...messages].reverse().find((m) => m.role === 'user')
        const text = lastUser?.parts?.find((p) => p.type === 'text')?.text ?? ''
        const files = lastUser?.parts?.filter((part) => part.type === 'file') ?? []
        document.documentElement.dataset.lastChatFiles = files
          .map((part) => `${part.mediaType}:${part.url?.startsWith('data:') ? 'data' : 'url'}`)
          .join(',')
        const msgId = `mock-msg-${++msgCounter}`
        const lowerText = text.toLowerCase()
        const wantsTool = lowerText.includes('frame') || lowerText.includes('rectangle')
        const wantsCode = lowerText.includes('code block')

        if (lowerText.includes('missing agent')) {
          throw new Error(
            '"claude-agent-acp" is not installed. Install it with: npm i -g @agentclientprotocol/claude-agent-acp'
          )
        }

        return new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'start', messageId: msgId })

            if (wantsTool) {
              const toolCallId = `call-${msgId}`
              controller.enqueue({
                type: 'tool-input-start',
                toolCallId,
                toolName: 'create_shape'
              })
              controller.enqueue({
                type: 'tool-input-delta',
                toolCallId,
                inputTextDelta:
                  '{"type":"FRAME","x":100,"y":100,"width":200,"height":150,"name":"Card"}'
              })
              controller.enqueue({
                type: 'tool-input-available',
                toolCallId,
                toolName: 'create_shape',
                input: { type: 'FRAME', x: 100, y: 100, width: 200, height: 150, name: 'Card' }
              })
              controller.enqueue({
                type: 'tool-output-available',
                toolCallId,
                toolName: 'create_shape',
                output: {
                  result: {
                    content: [
                      {
                        type: 'text',
                        text: JSON.stringify({
                          id: '0:99',
                          type: 'FRAME',
                          x: 100,
                          y: 100,
                          width: 200,
                          height: 150,
                          name: 'Card'
                        })
                      }
                    ],
                    structuredContent: null,
                    _meta: null
                  },
                  error: null
                }
              })
            }

            let words: string[]
            if (wantsTool) words = ['Created', 'a', 'frame', 'called', '"Card".']
            else if (wantsCode) words = ['```typescript\nconst greeting = "Hello"\n```']
            else words = `I'll help you with: "${text}". Here's a mock response.`.split(' ')

            controller.enqueue({ type: 'text-start', id: 'text-1' })
            for (const word of words) {
              controller.enqueue({ type: 'text-delta', id: 'text-1', delta: word + ' ' })
            }
            controller.enqueue({ type: 'text-end', id: 'text-1' })
            controller.enqueue({ type: 'finish', finishReason: 'stop' })
            controller.close()
          }
        })
      },
      async reconnectToStream() {
        return null
      }
    }))
  })
}

function chatTab() {
  return page.getByRole('tab', { name: 'AI' })
}

function designTab() {
  return page.getByRole('tab', { name: 'Design' })
}

function chatInput() {
  return page.getByTestId('chat-input')
}

function sendButton() {
  return page.getByTestId('chat-send-button')
}

function apiKeyInput() {
  return page.getByTestId('provider-settings-api-key')
}

test('⌘J switches to AI tab', async () => {
  await designTab().waitFor()
  await page.keyboard.press('Meta+j')
  await expect(chatTab()).toHaveAttribute('data-state', 'active')
})

test('⌘J switches back to Design tab', async () => {
  await page.keyboard.press('Meta+j')
  await expect(designTab()).toHaveAttribute('data-state', 'active')
})

test('clicking AI tab directs provider setup to unified settings', async () => {
  await chatTab().click()
  await expect(page.getByText('Connect an AI provider to start chatting.')).toBeVisible()
  await expect(page.getByTestId('provider-setup-open-settings')).toBeVisible()
  await expect(apiKeyInput()).toBeHidden()
})

test('saving API key in unified settings shows chat interface', async () => {
  const key = USE_REAL_LLM ? OPENROUTER_KEY : 'sk-or-test-key-12345'
  await page.getByTestId('provider-setup-open-settings').click()
  await expect(page.getByTestId('app-settings-dialog')).toBeVisible()
  await expect(page.getByTestId('settings-remember-credentials')).toHaveAttribute(
    'data-state',
    'checked'
  )
  await expect(page.getByTestId('settings-credential-backend')).toContainText(
    'encrypted app storage'
  )
  await page.locator('[data-model-id]').first().click()
  await page.getByTestId('settings-model-provider').click()
  await page.getByRole('option', { name: 'OpenRouter' }).click()
  await page.getByLabel('Name').fill('Claude Sonnet')
  await apiKeyInput().fill(key)
  await page.getByRole('button', { name: 'Save model' }).click()
  await page.getByTestId('app-settings-done').click()

  await expect(chatInput()).toBeVisible()
  await expect(page.getByText('Describe what you want to create or change.')).toBeVisible()
})

test('empty input has disabled send button', async () => {
  await expect(sendButton()).toBeDisabled()
})

test('typing enables send button', async () => {
  await chatInput().fill('Make a red rectangle')
  await expect(sendButton()).toBeEnabled()
})

test('attaches the current canvas selection as a visual reference', async () => {
  await chatInput().fill('')
  await designTab().click()
  await canvas.drawRect(180, 140, 80, 60)
  await chatTab().click()

  const attachSelection = page.getByTestId('chat-attachment-selection-button')
  await expect(attachSelection).toBeEnabled()
  await attachSelection.click()
  await expect(chatInput()).toBeDisabled()
  await expect(sendButton()).toBeDisabled()

  const draftAttachment = page
    .getByTestId('chat-draft-attachments')
    .getByTestId('chat-visual-attachment')
  await expect(draftAttachment).toContainText('Rectangle')
  await expect(draftAttachment.locator('img')).toBeVisible()
  await expect(sendButton()).toBeEnabled()
  await sendButton().click()

  await expect(page.getByTestId('chat-draft-attachments')).toBeHidden()
  await expect(
    page.getByText('Recreate this visual reference as an editable design.', { exact: true })
  ).toBeVisible()
  const messageAttachments = page.getByTestId('chat-message-attachments').last()
  await expect(messageAttachments).toBeVisible()
  await expect(messageAttachments.locator('img')).toBeVisible()
})

test('attaches a normalized image reference and sends it as a file part', async () => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
  )
  await page.getByTestId('chat-attachment-file-input').setInputFiles({
    name: 'reference.png',
    mimeType: 'image/png',
    buffer: png
  })

  const draftAttachment = page
    .getByTestId('chat-draft-attachments')
    .getByTestId('chat-visual-attachment')
  await expect(draftAttachment).toContainText('reference.png')
  await expect(draftAttachment.locator('img')).toBeVisible()
  await expect(page.getByTestId('chat-attachment-target')).toContainText('Image route:')

  await chatInput().fill('Recreate this reference as editable layers')
  await chatInput().press('Enter')

  await expect(page.getByTestId('chat-draft-attachments')).toBeHidden()
  const messageAttachments = page.getByTestId('chat-message-attachments').last()
  await expect(messageAttachments).toBeVisible()
  await expect(messageAttachments.locator('img')).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-last-chat-files', 'image/png:data')
})

test('multiple images appear inside the composer and can be removed', async () => {
  await chatInput().fill('')
  await page
    .getByTestId('chat-attachment-file-input')
    .setInputFiles([
      'tests/fixtures/vectorize/pilot_avatar.png',
      'tests/fixtures/vectorize/python_logo.png'
    ])

  const draftAttachments = page
    .getByTestId('chat-draft-attachments')
    .getByTestId('chat-visual-attachment')
  await expect(draftAttachments).toHaveCount(2)
  await expect(draftAttachments.nth(0)).toContainText('pilot_avatar.png')
  await expect(draftAttachments.nth(1)).toContainText('python_logo.png')

  await draftAttachments.nth(0).getByTestId('chat-attachment-remove').click()
  await expect(page.getByText('pilot_avatar.png', { exact: true })).toBeHidden()
  await expect(page.getByText('python_logo.png', { exact: true })).toBeVisible()
  await draftAttachments.nth(0).getByTestId('chat-attachment-remove').click()
})

test('sending images shows the complete user message immediately', async () => {
  await chatInput().fill('Use these images for the new layout')
  await page
    .getByTestId('chat-attachment-file-input')
    .setInputFiles([
      'tests/fixtures/vectorize/pilot_avatar.png',
      'tests/fixtures/vectorize/python_logo.png'
    ])

  await page.getByTestId('chat-send-button').click()

  const userMessage = page.getByTestId('chat-message-user').last()
  await expect(userMessage).toContainText('Use these images for the new layout', { timeout: 500 })
  const sentAttachments = userMessage.getByTestId('chat-visual-attachment')
  await expect(sentAttachments).toHaveCount(2, { timeout: 500 })
  await expect(sentAttachments.nth(0)).toContainText('pilot_avatar.png')
  await expect(sentAttachments.nth(1)).toContainText('python_logo.png')
})

test('Shift+Enter inserts a line break without submitting', async () => {
  await chatInput().fill('First line')
  await chatInput().press('Shift+Enter')
  await chatInput().type('Second line')

  await expect(chatInput()).toHaveValue('First line\nSecond line')
  await expect(page.getByText('First line', { exact: true })).toBeHidden()
})

test('Enter submits message and clears input', async () => {
  await chatInput().fill('Hello there')
  await chatInput().press('Enter')

  await expect(page.getByText('Hello there', { exact: true })).toBeVisible({ timeout: 5000 })
  await expect(chatInput()).toHaveValue('')
})

test('assistant responds', async () => {
  if (USE_REAL_LLM) {
    await expect(page.locator('.chat-markdown, [class*="rounded-tl-md"]').first()).toBeVisible({
      timeout: 30000
    })
  } else {
    await expect(
      page.getByTestId('chat-message-assistant').last().getByText('mock response', { exact: false })
    ).toBeVisible({ timeout: 5000 })
  }
})

test('completed Markdown responses release streaming parser history', async () => {
  await chatInput().fill('Show a code block')
  await chatInput().press('Enter')

  const markdown = page.locator('.chat-markdown').last()
  await expect(markdown).toBeVisible()
  await expect(markdown).toHaveAttribute('data-chat-markdown-mode', 'static')
  await expect(markdown.locator('.shiki').first()).toBeVisible()
})

test('assistant code blocks follow the active theme with readable contrast', async () => {
  await chatInput().fill('Show a code block')
  await chatInput().press('Enter')

  const code = page.getByTestId('chat-message-assistant').last().locator('.shiki').first()
  await expect(code).toBeVisible()
  await expect(page.locator('.chat-markdown').last()).toHaveClass(/dark/)
  await expect(code).toHaveCSS('background-color', 'rgb(30, 30, 30)')
  await expect(code.locator('span').filter({ hasText: 'const' }).first()).not.toHaveCSS(
    'color',
    'rgb(240, 240, 240)'
  )
  await page.evaluate(async () => {
    const themeModulePath = '/src/app/shell/theme.ts'
    const themeModule = await import(themeModulePath)
    themeModule.useAppTheme().setTheme('light')
  })
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light')
  await expect(page.locator('.chat-markdown').last()).toHaveClass(/light/)
  await expect(code).toHaveCSS('background-color', 'rgb(255, 255, 255)')
})

test('model selector is visible and clickable', async () => {
  const trigger = page.getByTestId('chat-model-selector')
  await expect(trigger).toBeVisible()
  await trigger.click()

  await expect(page.getByRole('option', { name: /Claude Sonnet 4\.6/ })).toBeVisible()
  await expect(page.getByText('Best for design')).toBeVisible()
  await expect(
    page.locator('[role="option"]:visible').filter({ hasText: 'Free' }).first()
  ).toBeVisible()

  await page.getByRole('option', { name: /Claude Sonnet 4\.6/ }).click()
  await expect(page.getByRole('option', { name: /Claude Sonnet 4\.6/ })).toBeHidden()
})

test('successful ACP tool envelopes render as done', async () => {
  await chatInput().fill('Create a frame')
  await chatInput().press('Enter')

  if (USE_REAL_LLM) {
    await expect(page.locator('.chat-markdown, [class*="rounded-tl-md"]').first()).toBeVisible({
      timeout: 30000
    })
  } else {
    const toolCall = page.getByTestId('chat-tool-call').filter({ hasText: 'Create Shape' })
    await expect(toolCall).toBeVisible({ timeout: 5000 })
    await expect(toolCall.getByText('Done', { exact: true })).toBeVisible()
    await expect(toolCall.getByText('Error', { exact: true })).toHaveCount(0)
  }
})

test('switching tabs preserves chat', async () => {
  const selectedModel = page.getByRole('option', { name: /Claude Sonnet 4\.6/ })
  if (await selectedModel.isVisible().catch(() => false)) {
    await selectedModel.click()
  }
  await designTab().click({ timeout: 10000 })
  await expect(designTab()).toHaveAttribute('data-state', 'active')

  await chatTab().click()
  await expect(page.getByText('Hello there', { exact: true })).toBeVisible({ timeout: 10000 })
})

test('OpenRouter accepts a custom model ID from provider settings', async () => {
  const customModel = 'meta-llama/llama-3.3-70b-instruct'

  await page.keyboard.press('Escape')
  await page.getByTestId('provider-settings-trigger').click()
  await page.locator('[data-model-id]').first().click()
  await page.getByLabel('Model ID').click()
  await page.getByRole('option', { name: 'Custom model…' }).click()
  const customModelInput = page.getByTestId('provider-settings-custom-model')
  await expect(customModelInput).toBeVisible()
  await customModelInput.fill(customModel)
  await page.getByRole('button', { name: 'Save model' }).click()
  await page.getByTestId('app-settings-done').click()

  await expect(page.getByTestId('chat-custom-model-label')).toContainText(customModel)
  await expect(page.getByTestId('chat-model-selector')).toBeHidden()

  await page.getByTestId('provider-settings-trigger').click()
  await page.locator('[data-model-id]').first().click()
  const savedCustomModelInput = page.getByTestId('provider-settings-custom-model')
  await savedCustomModelInput.fill('')
  await page.getByRole('combobox', { name: 'Model ID' }).click()
  await page.getByRole('option', { name: /Claude Sonnet 4\.6/ }).click()
  await page.getByRole('button', { name: 'Save model' }).click()
  await page.getByTestId('app-settings-done').click()

  await expect(page.getByTestId('chat-model-selector')).toBeVisible()
})

test('transport errors show a safe localized toast', async () => {
  await chatInput().fill('Trigger missing agent error')
  await chatInput().press('Enter')

  await expect(
    page.getByTestId('toast-item').filter({
      hasText: 'The model request failed. Check the provider settings and try again.'
    })
  ).toBeVisible({ timeout: 5000 })
})

test('"Get API key" link opens external URL via window.open', async () => {
  await page.getByTestId('provider-settings-trigger').click()
  await page.locator('[data-model-id]').first().click()
  await page.getByTestId('provider-settings-clear-key').click()
  await page.getByRole('button', { name: 'Back' }).click()
  await page.getByTestId('app-settings-done').click()
  await expect(page.getByTestId('provider-setup-open-settings')).toBeVisible()
  await page.getByTestId('provider-setup-open-settings').click()
  await page.locator('[data-model-id]').first().click()
  await page.getByTestId('settings-model-provider').click()
  await page.getByRole('option', { name: 'OpenRouter' }).click()

  const link = page.getByRole('button', { name: 'Get API key →' })
  await expect(link).toBeVisible()

  // Intercept window.open to verify it's called with the right URL
  const openedUrls: string[] = []
  await page.exposeFunction('mockWindowOpen', (url: string) => openedUrls.push(url))
  await page.evaluate(() => {
    window.openPencil ??= {}
    window.openPencil.test = { ...window.openPencil.test, savedOpen: window.open }
    window.open = (url: string | URL) => {
      window.mockWindowOpen?.(String(url))
      return null
    }
  })

  await link.click()

  await expect(() => {
    expect(openedUrls.length).toBeGreaterThan(0)
    expect(openedUrls[0]).toMatch(/^https:\/\//)
  }).toPass({ timeout: 3000 })

  // Restore
  await page.evaluate(() => {
    const savedOpen = window.openPencil?.test?.savedOpen
    if (savedOpen) window.open = savedOpen
  })
})
