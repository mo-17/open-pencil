import { expect, test } from '#tests/helpers/chat/fixture'
import { observeChatOwner, releaseChatOwner } from '#tests/helpers/chat/owner-lifecycle'
import { addPage, switchPage } from '#tests/helpers/chat/render-preview'

for (const kind of ['page-switch', 'font-retry'] as const) {
  test(`new owner first observed during ${kind} initializes after settle`, async ({
    configuredChat: chat,
    page
  }) => {
    await chat.submit('Old owner transcript')
    await expect(chat.assistantMessage()).toBeVisible()
    const owner = await observeChatOwner(page)
    try {
      const connections = await owner.evaluateHandle((p) => p.installAcceptedFailure())
      try {
        const before = await owner.evaluate((p) => p.snapshot())
        const prepared = await owner.evaluate((p, kind) => p.newOwnerPreparing(kind), kind)
        await expect
          .poll(() => owner.evaluate((p) => p.snapshot().preparation?.id))
          .toBe(prepared.preparationId)
        await owner.evaluate((p, key) => p.settle(key), prepared.key)
        await expect
          .poll(() =>
            owner.evaluate((p) => ({
              document: p.snapshot().historyDocument,
              busy: p.snapshot().historyBusy
            }))
          )
          .toEqual({ document: prepared.documentId, busy: false })
        const after = await owner.evaluate((p) => p.snapshot())
        expect(after.historyId).not.toBe(before.historyId)
        expect(after.messages).toHaveLength(0)
        expect(after.readOnly).toBe(false)
        expect(await connections.evaluate((c) => c.connections())).toBe(0)
      } finally {
        await connections.dispose()
      }
    } finally {
      await releaseChatOwner(page, owner)
    }
  })
}

test('initialized same owner retains its stream through page and font preparation', async ({
  configuredChat: chat,
  page
}) => {
  const pages = await addPage(page, 'Other canvas page')
  const owner = await observeChatOwner(page)
  try {
    const stream = await owner.evaluateHandle((p) => p.installHeldRender())
    try {
      await chat.submit('Hold the real render stream')
      await expect.poll(() => stream.evaluate((s) => s.ready())).toBe(true)
      await expect(page.getByTestId('chat-stop-button')).toBeVisible()
      const before = await owner.evaluate((p) => p.snapshot())
      await switchPage(page, pages.added)
      await expect(page.getByTestId('chat-stop-button')).toBeVisible()
      const key = await owner.evaluate((p) => p.prepare('font-retry'))
      await expect(page.getByTestId('chat-stop-button')).toBeVisible()
      await owner.evaluate((p, key) => p.settle(key), key)
      await expect(page.getByTestId('chat-stop-button')).toBeVisible()
      const after = await owner.evaluate((p) => p.snapshot())
      expect(after.projection?.contextId).toBe(before.projection?.contextId)
      expect(after.historyId).toBe(before.historyId)
      expect(after.graph).toBe(before.graph)
      expect(await stream.evaluate((s) => s.stats().requests)).toBe(1)
      expect(await stream.evaluate((s) => s.stats().aborts)).toBe(0)
      await stream.evaluate((s) => s.complete())
      await expect(chat.assistantMessage()).toContainText('Rendered.')
    } finally {
      await stream.dispose()
    }
  } finally {
    await releaseChatOwner(page, owner)
  }
})

test('real SDK prevalidation rejection restores the unaccepted composer request', async ({
  configuredChat: chat,
  page
}) => {
  const owner = await observeChatOwner(page)
  try {
    const validation = await owner.evaluateHandle((p) => p.installPredispatchFailure())
    try {
      await chat.submit('Keep this rejected request in its original draft')
      await expect(chat.input).toHaveValue('Keep this rejected request in its original draft')
      await expect(page.getByTestId('chat-message-user')).toHaveCount(0)
      expect(await validation.evaluate((v) => v.transitions())).not.toContain('submitted')
      expect(await validation.evaluate((v) => v.transitions())).not.toContain('streaming')
      expect(await owner.evaluate((p) => p.activeDraft().pending)).toBe(false)
    } finally {
      await validation.dispose()
    }
  } finally {
    await releaseChatOwner(page, owner)
  }
})

test('accepted SDK transport failure retains exact user and offers retry', async ({
  configuredChat: chat,
  page
}) => {
  const owner = await observeChatOwner(page)
  try {
    const failure = await owner.evaluateHandle((p) => p.installAcceptedFailure())
    try {
      await chat.submit('Preserve accepted failed request')
      await expect(chat.userMessage()).toContainText('Preserve accepted failed request')
      await expect.poll(() => failure.evaluate((f) => f.calls())).toBe(1)
      await expect.poll(() => owner.evaluate((p) => p.snapshot().status)).toBe('error')
      await expect(page.getByTestId('chat-retry')).toBeVisible()
      expect(await owner.evaluate((p) => p.activeDraft().text)).toBe('')
      await page.getByTestId('chat-retry').click()
      await expect.poll(() => failure.evaluate((f) => f.calls())).toBe(2)
      await expect(page.getByTestId('chat-retry')).toBeVisible()
      await owner.evaluate((p) => p.retryTwice())
      expect(await failure.evaluate((f) => f.calls())).toBe(3)
      await expect(page.getByTestId('chat-message-user')).toHaveCount(1)
      await expect(page.getByTestId('chat-retry')).toBeVisible()
    } finally {
      await failure.dispose()
    }
  } finally {
    await releaseChatOwner(page, owner)
  }
})

for (const transition of ['tab', 'conversation', 'source'] as const) {
  test(`late real normalized image cannot enter another ${transition} owner`, async ({
    configuredChat: _chat,
    page
  }) => {
    const owner = await observeChatOwner(page)
    try {
      const gate = await owner.evaluateHandle((p) => p.installBlobGate())
      try {
        await owner.evaluate((p) => p.startPNG())
        await expect.poll(() => gate.evaluate((g) => g.waiting())).toBeGreaterThan(0)
        expect(await owner.evaluate((p) => p.snapshot().attachmentBusy)).toBe(true)
        if (transition === 'tab') await owner.evaluate((p) => p.newOwner())
        else if (transition === 'conversation') await owner.evaluate((p) => p.newConversation())
        else await owner.evaluate((p) => p.changeSourceIdentity())
        const newOwnerDraft = await owner.evaluate((p) => p.activeDraft())
        await gate.evaluate((g) => g.release())
        await expect.poll(() => owner.evaluate((p) => p.snapshot().attachmentBusy)).toBe(false)
        expect(await owner.evaluate((p) => p.activeDraft())).toEqual(newOwnerDraft)
        expect((await owner.evaluate((p) => p.activeDraft())).attachments).toHaveLength(0)
      } finally {
        try {
          await gate.evaluate((g) => g.release())
        } finally {
          await gate.dispose()
        }
      }
    } finally {
      await releaseChatOwner(page, owner)
    }
  })
}

test('same-document page preparation preserves a late real SVG attachment', async ({
  configuredChat: _chat,
  page
}) => {
  const owner = await observeChatOwner(page)
  try {
    const gate = await owner.evaluateHandle((p) => p.installBlobGate())
    try {
      await owner.evaluate((p) => p.startSVG())
      await expect.poll(() => gate.evaluate((g) => g.waiting())).toBeGreaterThan(0)
      const key = await owner.evaluate((p) => p.prepare('page-switch'))
      await owner.evaluate((p, key) => p.settle(key), key)
      await gate.evaluate((g) => g.release())
      await expect.poll(() => owner.evaluate((p) => p.snapshot().attachmentBusy)).toBe(false)
      expect((await owner.evaluate((p) => p.activeDraft())).attachments).toEqual(['late-image.png'])
    } finally {
      try {
        await gate.evaluate((g) => g.release())
      } finally {
        await gate.dispose()
      }
    }
  } finally {
    await releaseChatOwner(page, owner)
  }
})

for (const source of ['same-path', 'new-source'] as const) {
  test(`${source} actual graph replacement aborts old stream and rejects old popout intent`, async ({
    configuredChat: chat,
    page
  }) => {
    const owner = await observeChatOwner(page)
    try {
      const stream = await owner.evaluateHandle((p) => p.installHeldRender())
      try {
        await chat.submit('Hold the request before replacing its graph')
        await expect.poll(() => stream.evaluate((s) => s.ready())).toBe(true)
        const before = await owner.evaluate((p) => p.snapshot())
        const contextId = before.projection?.contextId
        if (!contextId) throw new Error('Missing actual public projection context')
        const replacement = await owner.evaluate(
          (p, changed) => p.startSamePathReplacement(changed),
          source === 'new-source'
        )
        expect(replacement.newGraph).not.toBe(replacement.oldGraph)
        if (source === 'same-path') expect(replacement.newDocumentId).toBe(replacement.documentId)
        else expect(replacement.newDocumentId).not.toBe(replacement.documentId)
        await expect.poll(() => stream.evaluate((s) => s.stats().aborts)).toBeGreaterThan(0)
        const stale = await owner.evaluate((p, id) => p.lateIntent(id), contextId)
        expect(stale.ok).toBe(false)
        if (stale.ok) throw new Error('Stale intent unexpectedly accepted')
        expect(stale.code).toBe('stale-context')
        await stream.evaluate((s) => s.complete())
        await expect.poll(() => owner.evaluate((p) => p.snapshot().pending)).toBe(false)
        expect(await owner.evaluate((p) => p.documentNodes())).toEqual([])
        expect(await stream.evaluate((s) => s.stats().requests)).toBe(1)
        const settled = await owner.evaluate((p) => p.snapshot())
        expect(settled.projection?.contextId).not.toBe(contextId)
        if (source === 'new-source') {
          await expect
            .poll(() => owner.evaluate((p) => p.snapshot().historyDocument))
            .toBe(replacement.newDocumentId)
          const originalUser = before.messages.find((m) => m.role === 'user')
          if (!originalUser || !before.historyId)
            throw new Error('Missing original owned conversation request')
          expect(
            (await owner.evaluate((p) => p.snapshot())).messages.some(
              (m) => m.id === originalUser.id
            )
          ).toBe(false)
          const persisted = await owner.evaluate(
            (p, id) => p.readStoredConversation(id),
            before.historyId
          )
          expect(persisted?.documentId).toBe(before.historyDocument)
          expect(persisted?.messages.some((m) => m.id === originalUser.id)).toBe(true)
        }
      } finally {
        await stream.dispose()
      }
    } finally {
      await releaseChatOwner(page, owner)
    }
  })
}
