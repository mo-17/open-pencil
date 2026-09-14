import type { ActionDef, BackendResourceDataSource } from '@open-pencil/scene-graph'

import { templateCommandRecoveryActions } from '@/app/lowcode/backend/template-command-recovery'

import {
  commerceState as state,
  setCommerceState as set,
  setCommerceVariable as variable,
  type CommerceDocumentStateFactory
} from '../state'
import { commerceMerchantCopy } from './copy'
import type { CommerceMerchantMode, CommerceMerchantPaths } from './types'

export function prepareCommerceMerchantState(
  mode: CommerceMerchantMode,
  locale: string,
  doc: CommerceDocumentStateFactory,
  paths: CommerceMerchantPaths
) {
  const copy = commerceMerchantCopy(locale, mode)
  const multi = mode === 'multi-merchant'
  const storeId = multi ? doc('merchantStoreId') : undefined
  const browseStore = multi ? doc('browseStoreId') : undefined
  const browseTitle = multi ? doc('browseStoreTitle') : undefined
  const productStore = multi ? doc('selectedProductStoreId') : undefined
  const targets = {
    order: doc('merchantSelectedOrder'),
    summary: doc('merchantOrderSummary'),
    cursor: doc('merchantOrdersCursor'),
    error: doc('merchantError'),
    key: doc('fulfillAttempt'),
    result: doc('fulfillResult', 'object'),
    recovery: doc('fulfillRecovery', 'object'),
    display: doc('fulfillRecoveryDisplay'),
    createdStore: doc('createdStore', 'object'),
    storesCursor: doc('storesCursor'),
    storeProductsCursor: doc('storeProductsCursor')
  }
  const busy = state('fulfillBusy', 'boolean', false)
  const after = state('merchantOrdersAfter', 'string', '')
  const storeTitle = state('storeTitleInput', 'string', '')
  const storeBusy = state('storeCreateBusy', 'boolean', false)
  const storesAfter = state('storesAfter', 'string', '')
  const storeProductsAfter = state('storeProductsAfter', 'string', '')
  const locked = `(${busy.name} || ${targets.key} !== "" || !!${targets.recovery}.key)`
  const recovery = templateCommandRecoveryActions({
    commandId: 'fulfill-order',
    keyTarget: targets.key,
    infoTarget: targets.recovery,
    resultTarget: targets.result,
    displayTarget: targets.display,
    errorTarget: targets.error,
    busy,
    displayExpr: `data.status === "recorded" && data.payload ? ${JSON.stringify(copy.base.savedOrder + ': ')} + data.payload.orderId : ""`,
    confirmation: copy.completionRecovery,
    acknowledged: [
      variable(targets.order, '""'),
      variable(targets.summary, '""'),
      variable(targets.error, '""')
    ]
  })
  const complete: ActionDef = {
    id: crypto.randomUUID(),
    kind: 'backendCommand',
    commandId: 'fulfill-order',
    recovery: 'browser',
    payloadEntries: [
      { key: 'orderId', valueExpr: targets.order },
      ...(storeId ? [{ key: 'storeId', valueExpr: storeId }] : [])
    ],
    idempotencyKeyTarget: targets.key,
    resultTarget: targets.result,
    errorTarget: targets.error,
    onSuccess: [recovery.inspect()],
    onError: [recovery.inspect()]
  }
  const submit: ActionDef = {
    id: crypto.randomUUID(),
    kind: 'condition',
    condExpr: `!!${targets.order} && !${locked}${storeId ? ' && !!' + storeId : ''}`,
    consequent: [
      set(busy, '!0'),
      {
        id: crypto.randomUUID(),
        kind: 'confirm',
        messageExpr: `${JSON.stringify(copy.confirmComplete + ' ')} + ${targets.summary}`,
        confirmLabel: copy.complete,
        cancelLabel: copy.base.keepEditing,
        consequent: [variable(targets.error, '""'), complete],
        alternate: [set(busy, '!1')]
      }
    ]
  }
  const source: BackendResourceDataSource = {
    kind: 'backendResource',
    resourceId: 'merchant-orders',
    limit: 20,
    sortField: 'created_at',
    sortDirection: 'desc',
    afterExpr: after.name,
    nextCursorTarget: targets.cursor,
    errorTarget: targets.error,
    ...(storeId
      ? {
          filterEntries: [
            { key: 'store_id', valueExpr: `${storeId} || "00000000-0000-4000-8000-000000000000"` }
          ]
        }
      : {})
  }
  const storesSource: BackendResourceDataSource = {
    kind: 'backendResource',
    resourceId: 'stores',
    limit: 20,
    sortField: 'id',
    sortDirection: 'asc',
    afterExpr: storesAfter.name,
    nextCursorTarget: targets.storesCursor,
    errorTarget: targets.error
  }
  const ownStoreSource: BackendResourceDataSource = {
    kind: 'backendResource',
    resourceId: 'my-store',
    limit: 1,
    errorTarget: targets.error
  }
  const open: ActionDef = {
    id: crypto.randomUUID(),
    kind: 'backendRequest',
    resourceId: 'stores',
    operation: 'create',
    payloadEntries: [{ key: 'title', valueExpr: storeTitle.name }],
    resultTarget: targets.createdStore,
    errorTarget: targets.error,
    onSuccess: [set(storeBusy, '!1'), ...(storeId ? [variable(storeId, 'data.id')] : [])],
    onError: [set(storeBusy, '!1')]
  }
  return {
    mode,
    copy,
    paths,
    storeId,
    browseStore,
    browseTitle,
    productStore,
    targets,
    busy,
    after,
    storeTitle,
    storeBusy,
    storesAfter,
    storeProductsAfter,
    locked,
    recovery,
    submit,
    complete,
    source,
    storesSource,
    ownStoreSource,
    open,
    actions: [
      complete,
      recovery.inspect(),
      recovery.retry,
      recovery.acknowledge,
      ...(multi ? [open] : [])
    ],
    sources: [source, ...(multi ? [storesSource, ownStoreSource] : [])]
  }
}

export type CommerceMerchantState = ReturnType<typeof prepareCommerceMerchantState>
