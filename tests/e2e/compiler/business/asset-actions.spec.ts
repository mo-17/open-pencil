import { expect, test, type Page } from '@playwright/test'

import type { BusinessTestRow } from '#tests/engine/app/lowcode/backend/business/browser/transport/helpers'
import { expansionActionFixture } from '#tests/helpers/compiler/business/expansion/fixtures'
import {
  expansionDefinition,
  expansionId
} from '#tests/helpers/compiler/business/expansion/metadata'
import {
  finishBusinessRequest,
  submitBusinessAction,
  withBusinessBrowser
} from '#tests/helpers/compiler/business/helpers'

const handovers = ['Confirm assignment handover', 'Confirm loan handover']

async function selectRecord(page: Page, index: number): Promise<void> {
  // The fixture clock is paused; allow the generated 300ms request activation guard to expire.
  await page.clock.fastForward(350)
  await page.getByRole('button', { name: 'Select record', exact: true }).nth(index).click()
}

for (const target of ['react', 'vue'] as const) {
  test(`${target} asset actions follow request state and kind while preserving forms and receipts`, async ({
    page
  }, info) => {
    test.setTimeout(120_000)
    await withBusinessBrowser(page, 'asset-management', target, async (session) => {
      const definition = expansionDefinition('asset-management')
      const screen = definition.pages.find((entry) => entry.id === 'asset-management-requests')
      const loanAction = screen?.actions.find((entry) => entry.commandId === 'issue-asset-loan')
      if (!screen || !loanAction) throw new Error('Missing asset handover definition')
      const fixture = expansionActionFixture(session.fixture.application, screen, loanAction)
      Object.assign(session.api.resources, fixture.resources)
      const requests: BusinessTestRow[] = [
        'requested',
        'issued',
        'returned',
        'cancelled',
        'rejected'
      ].flatMap((status, index) =>
        ['assignment', 'loan'].map((kind, kindIndex) => ({
          ...fixture.selected,
          id: expansionId(1000 + index * 2 + kindIndex),
          asset_tag: `${status}-${kind}`,
          status,
          kind
        }))
      )
      session.api.resources['asset-management-requests'] = requests
      await session.open(screen.id)
      const labels = [...handovers, 'Confirm physical return', 'Reject pending request']
      for (const label of labels)
        await expect(page.getByRole('button', { name: label, exact: true })).toHaveCount(0)
      for (const [index, row] of requests.entries()) {
        await selectRecord(page, index)
        await expect(page.getByText('Asset tag: ' + row.asset_tag, { exact: true })).toHaveCount(2)
        for (const [kindIndex, label] of handovers.entries())
          await expect(page.getByRole('button', { name: label, exact: true })).toHaveCount(
            row.status === 'requested' && row.kind === (kindIndex ? 'loan' : 'assignment') ? 1 : 0
          )
        await expect(
          page.getByRole('button', { name: 'Confirm physical return', exact: true })
        ).toHaveCount(row.status === 'issued' ? 1 : 0)
        await expect(
          page.getByRole('button', { name: 'Reject pending request', exact: true })
        ).toHaveCount(row.status === 'requested' ? 1 : 0)
      }

      // Refresh clears selection without discarding the opened form or saved-request controls.
      await selectRecord(page, 1)
      await page.getByRole('button', { name: handovers[1], exact: true }).click()
      await page
        .getByPlaceholder('Handling explanation', { exact: true })
        .fill('Keep my handover note')
      await page.getByRole('button', { name: 'Refresh list', exact: true }).click()
      await expect(page.getByPlaceholder('Handling explanation', { exact: true })).toHaveValue(
        'Keep my handover note'
      )
      await expect(page.getByRole('button', { name: handovers[1], exact: true })).toHaveCount(0)
      await expect(
        page.getByText(
          'Select a record that supports this action to continue. You can still review any saved request below.',
          { exact: true }
        )
      ).toBeVisible()
      expect(session.api.calls).toHaveLength(0)

      // A real generated submit still carries the stored deadline and revision, then exposes its receipt.
      const selected = requests[1]
      await selectRecord(page, 1)
      await page.getByRole('button', { name: handovers[1], exact: true }).click()
      await page
        .getByPlaceholder('Handling explanation', { exact: true })
        .fill('Checked physical handover')
      const issued = { ...selected, status: 'issued', version: Number(selected.version) + 1 }
      session.api.steps.push({
        commandId: 'issue-asset-loan',
        payload: {
          assetId: selected.asset_id,
          requestId: selected.id,
          expectedVersion: selected.version,
          dueAt: String(selected.due_at).replace('.000Z', '.000000Z'),
          note: 'Checked physical handover'
        },
        result: issued,
        resources: {
          'asset-management-requests': requests.map((row) =>
            row.id === selected.id ? issued : row
          )
        }
      })
      await submitBusinessAction(page, handovers[1])
      await expect.poll(() => session.api.calls.length).toBe(1)
      await expect(page.getByRole('button', { name: handovers[1], exact: true })).toHaveCount(0)
      await expect(
        page.getByRole('button', { name: 'Finish reviewed request', exact: true })
      ).toBeVisible()
      await session.open('asset-management')
      await session.open(screen.id)
      await page
        .getByRole('button', {
          name: 'Inspect saved request · ' + handovers[1],
          exact: true
        })
        .first()
        .click()
      await expect(page.getByPlaceholder('Handling explanation', { exact: true })).toHaveCount(0)
      await expect(page.getByRole('button', { name: handovers[1], exact: true })).toHaveCount(0)
      await finishBusinessRequest(page)
      expect(session.api.calls).toHaveLength(1)

      // Old single-field conditions remain effective; unconditional creation remains visible.
      const states = ['available', 'in_use', 'repair', 'retired']
      const asset = session.api.resources['asset-management'][0]
      session.api.resources['asset-management'] = states.map((status, index) => ({
        ...asset,
        id: expansionId(2000 + index),
        status
      }))
      await session.open('asset-management')
      await expect(page.getByRole('button', { name: 'Register asset', exact: true })).toHaveCount(1)
      await expect(
        page.getByRole('button', { name: 'Edit available asset', exact: true })
      ).toHaveCount(0)
      for (const [index, status] of states.entries()) {
        await selectRecord(page, index)
        for (const label of ['Edit available asset', 'Start repair', 'Retire asset'])
          await expect(page.getByRole('button', { name: label, exact: true })).toHaveCount(
            status === 'available' ? 1 : 0
          )
        await expect(
          page.getByRole('button', { name: 'Complete repair', exact: true })
        ).toHaveCount(status === 'repair' ? 1 : 0)
        await expect(page.getByRole('button', { name: 'Register asset', exact: true })).toHaveCount(
          1
        )
      }
      await page.screenshot({ path: info.outputPath('asset-actions-retired.png') })
    })
  })
}
