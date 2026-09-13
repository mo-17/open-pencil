import type {
  ActionDef,
  BackendResourceDataSource,
  BackendRequestAction,
  BackendCommandAction
} from '@open-pencil/scene-graph'

import type { commerceCopy } from '../copy'
import { commerceRecoveryActions } from '../recovery/actions'
import {
  commerceState as state,
  setCommerceState as set,
  setCommerceVariable as variable,
  type CommerceDocumentStateFactory
} from '../state'

export function createCommerceCatalogState(
  doc: CommerceDocumentStateFactory,
  copy: ReturnType<typeof commerceCopy>
) {
  const fields = {
    mode: state('catalogMode', 'string', ''),
    generation: state('catalogDraftGeneration', 'string', ''),
    operationGeneration: state('catalogOperationGeneration', 'string', ''),
    busy: state('catalogBusy', 'boolean', false),
    activity: state('catalogActivity', 'string', ''),
    selected: state('catalogSelectedId', 'string', ''),
    title: state('catalogTitle', 'string', ''),
    price: state('catalogPrice', 'number', 0),
    stock: state('catalogInitialStock', 'number', 0),
    displayedStock: state('catalogDisplayedStock', 'number', 0),
    active: state('catalogActive', 'boolean', true),
    quantity: state('catalogRestockQuantity', 'number', 1),
    searchInput: state('catalogSearchInput', 'string', ''),
    search: state('catalogSearch', 'string', ''),
    after: state('catalogAfter', 'string', ''),
    feedback: state('catalogFeedback', 'string', '')
  }
  const targets = {
    cursor: doc('catalogCursor'),
    error: doc('catalogError'),
    result: doc('catalogResult', 'object'),
    key: doc('restockAttempt'),
    restock: doc('restockResult', 'object'),
    recovery: doc('restockRecovery', 'object'),
    display: doc('restockRecoveryDisplay')
  }
  const generation = '("" + $currentUser.generation)'
  const current = `${fields.generation.name} === ${generation}`
  const currentOperation = `${fields.operationGeneration.name} === ${generation}`
  const busy = `(${fields.busy.name} && ${currentOperation})`
  const locked = `(${busy} || ${targets.key} !== "" || !!${targets.recovery}.key)`
  const editing = `(${current} && ${fields.mode.name} === "edit")`
  const creating = `(${current} && ${fields.mode.name} === "create")`
  const draft = `(${editing} || ${creating})`
  const integer = (value: string, minimum: number, maximum: number) =>
    `(${value} >= ${minimum} && ${value} <= ${maximum} && ${value} % 1 === 0)`
  const validPrice = integer(fields.price.name, 0, 2147483647)
  const validStock = integer(fields.stock.name, 0, 2147483647)
  const validQuantity = integer(fields.quantity.name, 1, 100000)
  const clearFeedback = () => [set(fields.feedback, '""'), variable(targets.error, '""')]
  const begin = (activity: string) => [
    set(fields.operationGeneration, generation),
    set(fields.activity, JSON.stringify(activity)),
    set(fields.busy, '!0'),
    ...clearFeedback()
  ]
  const finish = (message: string): ActionDef[] => [
    set(fields.busy, '!1'),
    set(fields.feedback, JSON.stringify(message))
  ]
  const request = (operation: 'create' | 'update'): BackendRequestAction => ({
    id: crypto.randomUUID(),
    kind: 'backendRequest',
    resourceId: 'products',
    operation,
    ...(operation === 'update' ? { idExpr: fields.selected.name } : {}),
    payloadEntries: [
      { key: 'title', valueExpr: fields.title.name },
      { key: 'price', valueExpr: fields.price.name },
      { key: 'active', valueExpr: fields.active.name },
      ...(operation === 'create' ? [{ key: 'stock', valueExpr: fields.stock.name }] : [])
    ],
    resultTarget: targets.result,
    errorTarget: targets.error,
    onSuccess: [
      ...finish(operation === 'create' ? copy.productCreated : copy.productUpdated),
      set(fields.mode, '"edit"'),
      set(fields.selected, 'data.id'),
      set(fields.displayedStock, 'data.stock'),
      set(fields.after, '""')
    ],
    onError: [set(fields.busy, '!1')]
  })
  const create = request('create')
  const update = request('update')
  const submit: ActionDef = {
    id: crypto.randomUUID(),
    kind: 'condition',
    condExpr: `${draft} && !${locked} && ${validPrice} && (!${creating} || ${validStock})`,
    consequent: [
      ...begin('saving'),
      {
        id: crypto.randomUUID(),
        kind: 'condition',
        condExpr: creating,
        consequent: [create],
        alternate: [update]
      }
    ]
  }
  const recovery = commerceRecoveryActions({
    commandId: 'restock-product',
    keyTarget: targets.key,
    infoTarget: targets.recovery,
    resultTarget: targets.restock,
    displayTarget: targets.display,
    displayExpr: `data.status === "recorded" && data.payload ? ${JSON.stringify(copy.quantityLabel + ': ')} + data.payload.quantity + ${JSON.stringify(' · ' + copy.savedSku + ': ')} + data.payload.skuId : ""`,
    errorTarget: targets.error,
    busy: fields.busy,
    started: [set(fields.operationGeneration, generation), set(fields.activity, '"restocking"')],
    confirmation: copy.restockAcknowledge,
    acknowledged: [...clearFeedback(), variable(targets.restock, 'data')]
  })
  const restock: BackendCommandAction = {
    id: crypto.randomUUID(),
    kind: 'backendCommand',
    commandId: 'restock-product',
    recovery: 'browser',
    payloadEntries: [
      { key: 'skuId', valueExpr: fields.selected.name },
      { key: 'quantity', valueExpr: fields.quantity.name }
    ],
    idempotencyKeyTarget: targets.key,
    resultTarget: targets.restock,
    errorTarget: targets.error,
    onSuccess: [recovery.inspect()],
    onError: [recovery.inspect()]
  }
  const restockSubmit: ActionDef = {
    id: crypto.randomUUID(),
    kind: 'condition',
    condExpr: `${editing} && !${locked} && ${validQuantity}`,
    consequent: [
      ...begin('confirming'),
      {
        id: crypto.randomUUID(),
        kind: 'confirm',
        messageExpr: `${JSON.stringify(copy.restockConfirm + ' ' + copy.quantityLabel + ': ')} + ${fields.quantity.name} + ${JSON.stringify(' · ' + copy.savedSku + ': ')} + ${fields.selected.name} + " · " + ${fields.title.name}`,
        confirmLabel: copy.confirmRestock,
        cancelLabel: copy.keepEditing,
        consequent: [set(fields.activity, '"restocking"'), restock],
        alternate: [set(fields.busy, '!1')]
      }
    ]
  }
  const select: ActionDef[] = [
    set(fields.generation, generation),
    set(fields.mode, '"edit"'),
    set(fields.selected, 'item.id'),
    set(fields.title, 'item.title'),
    set(fields.price, 'item.price'),
    set(fields.stock, '0'),
    set(fields.displayedStock, 'item.stock'),
    set(fields.active, 'item.active'),
    set(fields.quantity, '1'),
    ...clearFeedback()
  ]
  const newProduct: ActionDef[] = [
    set(fields.generation, generation),
    set(fields.mode, '"create"'),
    set(fields.selected, '""'),
    set(fields.title, '""'),
    set(fields.price, '0'),
    set(fields.stock, '0'),
    set(fields.active, '!0'),
    ...clearFeedback()
  ]
  const source: BackendResourceDataSource = {
    kind: 'backendResource',
    resourceId: 'products',
    limit: 20,
    searchExpr: fields.search.name,
    sortField: 'price',
    sortDirection: 'asc',
    afterExpr: fields.after.name,
    nextCursorTarget: targets.cursor,
    errorTarget: targets.error
  }
  return {
    fields,
    targets,
    source,
    recovery,
    busy,
    locked,
    editing,
    creating,
    draft,
    currentOperation,
    validPrice,
    validStock,
    validQuantity,
    clearFeedback,
    submit,
    restockSubmit,
    select,
    newProduct,
    actions: [create, update, restock, recovery.inspect(), recovery.retry, recovery.acknowledge]
  }
}

export type CommerceCatalogState = ReturnType<typeof createCommerceCatalogState>
