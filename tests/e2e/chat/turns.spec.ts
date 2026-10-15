import type { Page } from '@playwright/test'

import type * as ChatHostModule from '@/app/ai/popout/chat-host-controller'

import { CanvasHelper } from '#tests/helpers/canvas'
import { expect, test } from '#tests/helpers/chat/fixture'
import { injectToolLoopTransport } from '#tests/helpers/chat/tool-loop'

const cardCount = (page: Page) =>
  page.evaluate(() => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

    const graph = window.openPencil?.getStore?.().graph
    return graph ? [...graph.nodes.values()].filter((node) => node.name === 'Card').length : -1
  })

test('reverting a reply undoes its edits, marks it, saves the chat, and tells the model', async ({
  configuredChat: chat,
  page
}) => {
  const canvas = new CanvasHelper(page)
  await injectToolLoopTransport(page)

  await chat.submit('Add a card')
  await expect(chat.assistantMessage()).toContainText('Done')
  expect(await cardCount(page)).toBe(1)

  const content = chat.assistantMessage().locator('[data-slot="chat-reply-content"]')
  await chat.assistantMessage().getByTestId('chat-revert-turn').click()
  expect(await cardCount(page)).toBe(0)
  await expect(content).toHaveAttribute('data-reverted', 'true')

  // Restore redoes the edits, then reverting again leaves the reply marked.
  await chat.assistantMessage().getByTestId('chat-restore-turn').click()
  expect(await cardCount(page)).toBe(1)
  await expect(content).toHaveAttribute('data-reverted', 'false')
  await chat.assistantMessage().getByTestId('chat-revert-turn').click()
  expect(await cardCount(page)).toBe(0)

  await chat.submit('Try something else')
  await expect(page.getByTestId('chat-message-assistant')).toHaveCount(2)
  await expect(chat.assistantMessage()).toContainText('Done')
  const request = await page.evaluate(() => document.documentElement.dataset.lastModelRequest)
  // The note names the undone call by its tool.
  expect(request).toContain('- render (')
  // The note is for the model only.
  await expect(chat.userMessage()).toHaveText('Try something else')
  // The second reply's edits closed Redo, so the first reply is marked instead.
  await expect(
    page.getByTestId('chat-message-assistant').first().locator('[data-slot="chat-turn-reverted"]')
  ).toBeVisible()

  // Saving the conversation, which every send and the revert trigger, must not fail.
  canvas.assertNoErrors()

  // The mark is stored with the conversation; wait for the save before reloading drops it.
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const historyPath = '/src/app/ai/chat/history/idb.ts'
        const { createConversationStore } = await import(historyPath)
        const store = createConversationStore()
        const [latest] = await store.list(undefined)
        const conversation = latest ? await store.read(latest.id) : null
        return (
          conversation?.messages.some(
            (entry: { message: { metadata?: { undo?: { undone?: string[] } } } }) =>
              (entry.message.metadata?.undo?.undone?.length ?? 0) > 0
          ) ?? false
        )
      })
    )
    .toBe(true)
  await page.reload()
  await chat.chatTab.click()
  await page.getByRole('button', { name: 'Conversation history', exact: true }).click()
  await page.getByRole('button', { name: 'All documents', exact: true }).click()
  await page.getByRole('button', { name: /Add a card/ }).click()
  await expect(
    page.getByTestId('chat-message-assistant').first().locator('[data-slot="chat-turn-reverted"]')
  ).toBeVisible()
})

test('reply undo actions wait until the submitted reply finishes saving', async ({
  configuredChat: chat,
  page
}) => {
  const canvas = new CanvasHelper(page)
  await injectToolLoopTransport(page, 'Read only follow-up')
  const held = await page.evaluateHandle(async () => {
    const path = '/src/app/ai/popout/chat-host-controller.ts'
    const module: typeof ChatHostModule = await import(path)
    const host = module.chatPanelController
    const originalFlush = host.history.flush
    let gate: { wait: Promise<void>; release: () => void } | null = null
    let waiting = false
    function arm() {
      if (gate) throw new Error('A history flush is already held')
      let release: () => void = () => undefined
      const wait = new Promise<void>((resolve) => {
        release = resolve
      })
      gate = { wait, release }
      waiting = false
    }
    function release() {
      gate?.release()
      gate = null
    }
    host.history.flush = async () => {
      const current = gate
      if (current) {
        waiting = true
        await current.wait
      }
      return originalFlush()
    }
    arm()
    return {
      arm,
      release,
      snapshot: () => ({
        waiting,
        pending: host.submissionPending.value,
        status: host.status.value
      }),
      restore: () => {
        host.history.flush = originalFlush
        release()
      }
    }
  })
  const cleanupErrors: unknown[] = []
  try {
    await chat.submit('Add a card')
    await expect(chat.assistantMessage()).toContainText('Done')
    const firstReply = page.getByTestId('chat-message-assistant').first()
    const revert = firstReply.getByTestId('chat-revert-turn')
    await expect(revert).toBeVisible()
    await expect
      .poll(() => held.evaluate((probe) => probe.snapshot()))
      .toEqual({
        waiting: true,
        pending: true,
        status: 'ready'
      })
    expect(await cardCount(page)).toBe(1)
    expect(await revert.isDisabled()).toBe(true)

    await held.evaluate((probe) => probe.release())
    await expect(chat.input).toBeEnabled()
    await expect(revert).toBeEnabled()
    await revert.click()
    expect(await cardCount(page)).toBe(0)
    await expect(firstReply.locator('[data-slot="chat-reply-content"]')).toHaveAttribute(
      'data-reverted',
      'true'
    )

    // A non-mutating second reply leaves the first turn on Redo while its final save is held.
    await held.evaluate((probe) => probe.arm())
    await chat.submit('Read only follow-up')
    await expect(page.getByTestId('chat-message-assistant')).toHaveCount(2)
    await expect(chat.assistantMessage()).toContainText('Done')
    const restore = firstReply.getByTestId('chat-restore-turn')
    await expect(restore).toBeVisible()
    await expect
      .poll(() => held.evaluate((probe) => probe.snapshot()))
      .toEqual({
        waiting: true,
        pending: true,
        status: 'ready'
      })
    expect(await restore.isDisabled()).toBe(true)
    expect(await cardCount(page)).toBe(0)
    expect(await page.evaluate(() => document.documentElement.dataset.lastModelRequest)).toContain(
      '- render ('
    )

    await held.evaluate((probe) => probe.release())
    await expect(chat.input).toBeEnabled()
    await expect(restore).toBeEnabled()
    await restore.click()
    expect(await cardCount(page)).toBe(1)
    await expect(firstReply.locator('[data-slot="chat-reply-content"]')).toHaveAttribute(
      'data-reverted',
      'false'
    )
    canvas.assertNoErrors()
  } finally {
    if (!page.isClosed()) {
      try {
        await held.evaluate((probe) => probe.restore())
      } catch (error) {
        cleanupErrors.push(error)
      }
    }
    try {
      await held.dispose()
    } catch (error) {
      cleanupErrors.push(error)
    }
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, 'Could not release the held conversation save')
  }
})
