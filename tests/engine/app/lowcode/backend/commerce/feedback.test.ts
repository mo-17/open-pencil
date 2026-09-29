import { describe, expect, test } from 'bun:test'

import type { ActionDef } from '@open-pencil/scene-graph'

import { createCommerceCatalogState } from '@/app/lowcode/backend/commerce/catalog/state'
import { commerceCopy } from '@/app/lowcode/backend/commerce/copy'
import { prepareCommerceMerchantState } from '@/app/lowcode/backend/commerce/merchant/state'
import {
  commerceOperationFeedback,
  commerceOperationsCopy
} from '@/app/lowcode/backend/commerce/operations/copy'
import { templateToast } from '@/app/lowcode/backend/feedback/actions'
import { templateCommandRecoveryActions } from '@/app/lowcode/backend/template-command-recovery'

function toastMessages(actions: readonly ActionDef[] = []): string[] {
  return actions.flatMap((action) => (action.kind === 'toast' ? [String(action.messageExpr)] : []))
}

describe('commerce user feedback boundaries', () => {
  test('only a successful retry announces success and clears its previous error', () => {
    const recovery = templateCommandRecoveryActions({
      commandId: 'checkout',
      keyTarget: 'attempt',
      infoTarget: 'saved',
      resultTarget: 'result',
      displayTarget: 'display',
      displayExpr: 'data.status',
      errorTarget: 'lastError',
      busy: { id: 'busy', name: 'busy', type: 'boolean', defaultValue: false },
      acknowledged: [],
      confirmation: 'I reviewed the result.',
      succeeded: [templateToast('Order recorded. No payment was collected.')]
    })
    expect(toastMessages(recovery.retry.onSuccess)).toEqual([
      '"Order recorded. No payment was collected."'
    ])
    expect(recovery.retry.onSuccess?.[0]).toMatchObject({
      kind: 'setVariable',
      targetName: 'lastError',
      valueExpr: '""'
    })
    expect(recovery.retry.onSuccess?.at(-1)).toMatchObject({
      kind: 'backendCommandRecovery',
      operation: 'inspect'
    })
    for (const action of [recovery.inspect(), recovery.acknowledge]) {
      expect(toastMessages(action.onSuccess)).toEqual([])
      expect(toastMessages(action.onError)).toEqual([])
    }
    expect(toastMessages(recovery.retry.onError)).toEqual([])
    expect(recovery.retry.attemptKeyExpr).toBe('saved.key')
    expect(recovery.retry.onError).toHaveLength(1)
    expect(recovery.retry.onError?.[0]).toMatchObject({ operation: 'inspect' })
  })

  test.each(['en', 'zh-CN'])(
    '%s catalog success preserves draft locks and failure feedback',
    (locale) => {
      const copy = commerceCopy(locale)
      const catalog = createCommerceCatalogState((name) => name, copy)
      for (const action of catalog.actions) {
        if (action.kind === 'backendRequest') {
          expect(toastMessages(action.onSuccess)).toEqual([
            JSON.stringify(
              action.operation === 'create' ? copy.productCreated : copy.productUpdated
            )
          ])
          expect(action.onError).toEqual([
            expect.objectContaining({
              kind: 'setState',
              targetStateId: catalog.fields.busy.id,
              valueExpr: '!1'
            })
          ])
        }
        if (action.kind === 'backendCommand') {
          expect(toastMessages(action.onSuccess)).toEqual([JSON.stringify(copy.restocked)])
          expect(toastMessages(action.onError)).toEqual([])
        }
      }
      expect(catalog.locked).toContain('restockAttempt')
      expect(catalog.recovery.retry.attemptKeyExpr).toBe('restockRecovery.key')
      expect(toastMessages(catalog.recovery.retry.onSuccess)).toEqual([
        JSON.stringify(copy.restocked)
      ])
      expect(toastMessages(catalog.recovery.inspect().onSuccess)).toEqual([])
    }
  )

  test.each(['single-merchant', 'multi-merchant'] as const)(
    '%s completion announces a recorded state only',
    (mode) => {
      const merchant = prepareCommerceMerchantState(mode, 'zh-CN', (name) => name, {
        shop: '/shop',
        orders: '/orders',
        login: '/login',
        admin: '/admin',
        merchantOrders: '/merchant-orders'
      })
      if (merchant.complete.kind !== 'backendCommand' || merchant.open.kind !== 'backendRequest')
        throw new Error('Missing merchant writes')
      expect(toastMessages(merchant.complete.onSuccess)).toEqual(['"完成状态已记录"'])
      expect(toastMessages(merchant.complete.onError)).toEqual([])
      expect(toastMessages(merchant.recovery.retry.onSuccess)).toEqual(['"完成状态已记录"'])
      expect(toastMessages(merchant.open.onSuccess)).toEqual([
        JSON.stringify(merchant.copy.storeCreated)
      ])
      expect(toastMessages(merchant.open.onError)).toEqual([])
      expect(merchant.complete.idempotencyKeyTarget).toBe('fulfillAttempt')
    }
  )

  test.each(['en', 'zh-CN'])(
    '%s financial and shipment messages preserve the exported integration boundary',
    (locale) => {
      const copy = commerceOperationsCopy(locale)
      const messages = [
        'payment.simulate',
        'refund.approve',
        'shipment.dispatch',
        'settlement.record'
      ].map((operation) =>
        commerceOperationFeedback(
          copy,
          operation as
            | 'payment.simulate'
            | 'refund.approve'
            | 'shipment.dispatch'
            | 'settlement.record'
        )
      )
      if (locale === 'en') {
        expect(messages[0]).toContain('No real payment was collected')
        expect(messages[1]).toContain('No money was transferred')
        expect(messages[2]).toContain('No carrier request was sent')
        expect(messages[3]).toContain('No money was transferred')
      } else {
        expect(messages[0]).toContain('未收取真实款项')
        expect(messages[1]).toContain('尚未划转资金')
        expect(messages[2]).toContain('未调用快递服务')
        expect(messages[3]).toContain('尚未划转资金')
      }
    }
  )
})
