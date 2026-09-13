import {
  validateBackendClientAction,
  validateBackendResourceDataSource
} from '@open-pencil/lowcode/backend'
import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'
import type { ActionDef } from '@open-pencil/scene-graph'

import type { AppBackendProviderDescriptor } from '@/app/plugins/host/backend-provider'

import {
  commitBackendProviderDocumentRequest,
  createBackendProviderDocumentRequest,
  readBackendProviderDocumentRequest
} from '../document'
import { BackendDraftOperationError } from '../draft'
import type { NotesTemplateEditor } from '../notes-template'
import { createCommerceCatalogPage } from './catalog/page'
import { createCommerceCatalogState } from './catalog/state'
import { commerceCopy } from './copy'
import { createCommerceLayout } from './layout'
import { commerceRecoveryActions } from './recovery/actions'
import { createCommerceRecoverySection } from './recovery/section'
import { commerceState as state, setCommerceState as set } from './state'

export function canInstallCommerceExample(editor: NotesTemplateEditor): boolean {
  try {
    const root = editor.graph.getNode(editor.graph.rootId)
    return Boolean(
      root &&
      !readBackendProviderDocumentRequest(editor.graph) &&
      !root.lowcodeSupabaseConfig &&
      !root.lowcodeAuthRedirect &&
      !editor.graph.getPages().some((page) => page.lowcodeRequiresAuth)
    )
  } catch {
    return false
  }
}

export function createCommercePages(
  editor: NotesTemplateEditor,
  descriptor: AppBackendProviderDescriptor,
  application: BackendApplicationSpecV1,
  locale = 'en'
) {
  if (!canInstallCommerceExample(editor))
    throw new BackendDraftOperationError(
      'Create the checkout example in a new document without Backend or authentication declarations.'
    )
  createBackendProviderDocumentRequest(descriptor, application)
  const root = editor.graph.getNode(editor.graph.rootId)
  if (!root) throw new BackendDraftOperationError('The document root is unavailable.')
  const copy = commerceCopy(locale)
  const route = (base: string) => {
    for (let index = 1; index < 100; index++) {
      const value = index === 1 ? base : `${base}-${index}`
      if (
        !editor.graph
          .getPages()
          .some(
            (page) =>
              page.lowcodeRoutePattern === value ||
              `/${page.name.toLowerCase().replace(/\s+/gu, '-')}` === value
          )
      )
        return value
    }
    throw new BackendDraftOperationError('No available route remains.')
  }
  const paths = {
    shop: route('/shop'),
    orders: route('/orders'),
    login: route('/shop-login'),
    admin: route('/catalog-admin')
  }
  const docStates = structuredClone(root.lowcodeDocumentState ?? [])
  const doc = (base: string, type: 'string' | 'object' | 'number' = 'string') => {
    let name = base
    for (let index = 2; docStates.some((state) => state.name === name); index++)
      name = `${base}${index}`
    docStates.push({
      id: crypto.randomUUID(),
      name,
      type,
      defaultValue: { object: {}, number: 1, string: '' }[type]
    })
    return name
  }
  const names = {
    checkoutKey: doc('checkoutAttempt'),
    cancelKey: doc('cancelAttempt'),
    error: doc('shopError'),
    order: doc('checkoutResult', 'object'),
    cancel: doc('cancelResult', 'object'),
    checkoutRecovery: doc('checkoutRecovery', 'object'),
    cancelRecovery: doc('cancelRecovery', 'object'),
    checkoutRecoveryDisplay: doc('checkoutRecoveryDisplay'),
    cancelRecoveryDisplay: doc('cancelRecoveryDisplay'),
    productsCursor: doc('productsCursor'),
    ordersCursor: doc('ordersCursor')
  }
  const selected = { name: doc('selectedSku') },
    selectedTitle = { name: doc('selectedProduct') },
    selectedPrice = { name: doc('selectedPrice', 'number') },
    selectedStock = { name: doc('selectedStock', 'number') },
    quantity = { name: doc('orderQuantity', 'number') },
    checkoutBusy = state('checkoutBusy', 'boolean', false),
    searchInput = state('productSearchInput', 'string', ''),
    searchTerm = state('productSearch', 'string', ''),
    productsAfter = state('productsAfter', 'string', '')
  const selectedOrder = { name: doc('selectedOrder') },
    selectedOrderSummary = { name: doc('selectedOrderSummary') },
    cancelBusy = state('cancelBusy', 'boolean', false),
    ordersAfter = state('ordersAfter', 'string', '')
  const checkoutBlocked = checkoutBusy.name
  const cancelBlocked = cancelBusy.name
  const checkoutLocked = `(${checkoutBlocked} || ${names.checkoutKey} !== "" || !!${names.checkoutRecovery}.key)`
  const cancelLocked = `(${cancelBlocked} || ${names.cancelKey} !== "" || !!${names.cancelRecovery}.key)`
  const validQuantity = `(${quantity.name} >= 1 && ${quantity.name} <= 99 && ${quantity.name} % 1 === 0 && ${quantity.name} <= ${selectedStock.name})`
  const canCheckout = `(!!$currentUser.signedIn && ${selected.name} !== "" && ${validQuantity} && !${checkoutLocked})`
  const orderSummary = `${JSON.stringify(copy.quantityLabel + ': ')} + ${quantity.name} + ${JSON.stringify(' · ' + copy.estimatedTotal + ': ')} + (${selectedPrice.name} * ${quantity.name}) + ${JSON.stringify(' · ' + copy.priceNotice + ' · ')} + ${selectedTitle.name}`
  const orderStatus = `item.status === "pending" ? ${JSON.stringify(copy.pendingStatus)} : item.status === "cancelled" ? ${JSON.stringify(copy.cancelledStatus)} : ${JSON.stringify(copy.unknownStatus)}`
  const selectedSummary = `${JSON.stringify(copy.quantityLabel + ': ')} + item.quantity + ${JSON.stringify(' · ' + copy.total + ': ')} + item.total + ${JSON.stringify(' · ')} + item.product_title`
  const setDoc = (target: { name: string }, valueExpr: string): ActionDef => ({
    id: crypto.randomUUID(),
    kind: 'setVariable',
    targetName: target.name,
    valueExpr
  })
  const clear = (targetName: string): ActionDef => ({
    id: crypto.randomUUID(),
    kind: 'setVariable',
    targetName,
    valueExpr: '""'
  })
  const checkoutRecovery = commerceRecoveryActions({
    commandId: 'checkout',
    keyTarget: names.checkoutKey,
    infoTarget: names.checkoutRecovery,
    resultTarget: names.order,
    displayTarget: names.checkoutRecoveryDisplay,
    displayExpr: `data.status === "recorded" && data.payload ? ${JSON.stringify(copy.savedSku + ': ')} + data.payload.skuId + ${JSON.stringify(' · ' + copy.quantityLabel + ': ')} + data.payload.quantity : ""`,
    errorTarget: names.error,
    busy: checkoutBusy,
    confirmation: copy.recoveryConfirm,
    acknowledged: [
      clear(names.error),
      setDoc(selected, '""'),
      setDoc(selectedTitle, '""'),
      setDoc(selectedPrice, '0'),
      setDoc(selectedStock, '0'),
      setDoc(quantity, '1'),
      setDoc({ name: names.order }, 'data')
    ]
  })
  const cancelRecovery = commerceRecoveryActions({
    commandId: 'cancel-order',
    keyTarget: names.cancelKey,
    infoTarget: names.cancelRecovery,
    resultTarget: names.cancel,
    displayTarget: names.cancelRecoveryDisplay,
    displayExpr: `data.status === "recorded" && data.payload ? ${JSON.stringify(copy.savedOrder + ': ')} + data.payload.orderId : ""`,
    errorTarget: names.error,
    busy: cancelBusy,
    confirmation: copy.recoveryConfirm,
    acknowledged: [
      clear(names.error),
      setDoc(selectedOrder, '""'),
      setDoc(selectedOrderSummary, '""'),
      setDoc({ name: names.cancel }, 'data')
    ]
  })
  const checkout: ActionDef = {
    id: crypto.randomUUID(),
    kind: 'backendCommand',
    commandId: 'checkout',
    recovery: 'browser',
    payloadEntries: [
      { key: 'skuId', valueExpr: selected.name },
      { key: 'quantity', valueExpr: quantity.name }
    ],
    idempotencyKeyTarget: names.checkoutKey,
    resultTarget: names.order,
    errorTarget: names.error,
    onSuccess: [checkoutRecovery.inspect()],
    onError: [checkoutRecovery.inspect()]
  }
  const cancel: ActionDef = {
    id: crypto.randomUUID(),
    kind: 'backendCommand',
    commandId: 'cancel-order',
    recovery: 'browser',
    payloadEntries: [{ key: 'orderId', valueExpr: selectedOrder.name }],
    idempotencyKeyTarget: names.cancelKey,
    resultTarget: names.cancel,
    errorTarget: names.error,
    onSuccess: [cancelRecovery.inspect()],
    onError: [cancelRecovery.inspect()]
  }
  const productSource = {
    kind: 'backendResource' as const,
    resourceId: 'products',
    limit: 20,
    filterEntries: [{ key: 'active', valueExpr: '!0' }],
    searchExpr: searchTerm.name,
    sortField: 'price',
    sortDirection: 'asc' as const,
    afterExpr: productsAfter.name,
    nextCursorTarget: names.productsCursor,
    errorTarget: names.error
  }
  const orderSource = {
    kind: 'backendResource' as const,
    resourceId: 'orders',
    limit: 20,
    sortField: 'created_at',
    sortDirection: 'desc' as const,
    afterExpr: ordersAfter.name,
    nextCursorTarget: names.ordersCursor,
    errorTarget: names.error
  }
  const catalog = createCommerceCatalogState(doc, copy)
  const diagnostics = [
    ...catalog.actions,
    checkout,
    cancel,
    checkoutRecovery.inspect(),
    checkoutRecovery.retry,
    checkoutRecovery.acknowledge,
    cancelRecovery.inspect(),
    cancelRecovery.retry,
    cancelRecovery.acknowledge
  ].flatMap((action) => validateBackendClientAction(application, action, docStates))
  diagnostics.push(
    ...[productSource, orderSource, catalog.source].flatMap((source) =>
      validateBackendResourceDataSource(application, source, docStates)
    )
  )
  if (diagnostics.length)
    throw new BackendDraftOperationError(diagnostics.map((entry) => entry.message).join(' '))
  const layout = createCommerceLayout(editor, copy, names.error)
  const { shape, text, button, navigate, page, error, listing, pagination, pageIds } = layout
  editor.undo.runBatch('Create single-item checkout application', () => {
    commitBackendProviderDocumentRequest(editor, descriptor, application)
    editor.updateNodeWithUndo(
      root.id,
      { lowcodeDocumentState: docStates, lowcodeAuthRedirect: paths.login },
      'Configure checkout state'
    )
    const login = page(copy.login, paths.login, [])
    text(login, copy.shop, 48, 44, 850, { fontSize: 32 })
    text(login, copy.loginHint, 48, 104)
    button(login, copy.signIn, 48, 160, [
      {
        id: crypto.randomUUID(),
        kind: 'backendAuth',
        operation: 'signIn',
        returnPath: paths.shop,
        errorTarget: names.error
      }
    ])
    error(login, 226)
    const shop = page(
      copy.shop,
      paths.shop,
      [checkoutBusy, productsAfter, searchInput, searchTerm],
      false,
      1500
    )
    text(shop, copy.shop, 48, 28, 850, { fontSize: 30 })
    text(shop, copy.productHint, 48, 82)
    button(shop, copy.signIn, 48, 130, [navigate(paths.login)], {
      renderCondition: '!$currentUser.signedIn'
    })
    button(shop, copy.orders, 252, 130, [navigate(paths.orders)])
    button(shop, copy.admin, 456, 130, [navigate(paths.admin)])
    const search = shape('FORM', copy.search, shop, 48, 194, 900, 48, {
      layoutMode: 'NONE',
      events: { onSubmit: [set(searchTerm, searchInput.name), set(productsAfter, '""')] }
    })
    shape('INPUT', copy.searchPlaceholder, search, 0, 0, 650, 42, {
      bindings: { value: { kind: 'ref', stateId: searchInput.id } },
      interactiveProps: { placeholder: copy.searchPlaceholder, validation: { maxLength: 120 } }
    })
    button(search, copy.search, 670, 0, [])
    text(shop, copy.searchHint, 48, 250, 870, { fontSize: 13 })
    const product = listing(shop, copy.shop, 290, productSource)
    text(product, 'Product', 16, 12, 800, {
      bindings: { text: { kind: 'expr', expr: 'item.title' } },
      fontSize: 20
    })
    text(product, 'Price', 16, 50, 800, {
      bindings: {
        text: {
          kind: 'expr',
          expr: `${JSON.stringify(copy.unitPrice + ': ')} + item.price + ${JSON.stringify(' · ' + copy.stock + ': ')} + item.stock + ${JSON.stringify(' · ' + copy.amountUnit)}`
        }
      },
      fontSize: 14
    })
    button(
      product,
      copy.choose,
      16,
      104,
      [
        setDoc(selected, 'item.id'),
        setDoc(selectedTitle, 'item.title'),
        setDoc(selectedPrice, 'item.price'),
        setDoc(selectedStock, 'item.stock'),
        setDoc(quantity, '1'),
        clear(names.error)
      ],
      { renderCondition: `item.stock > 0 && item.active && !${checkoutLocked}` }
    )
    text(product, copy.soldOut, 228, 112, 540, {
      renderCondition: 'item.stock <= 0 || !item.active'
    })
    pagination(shop, productsAfter, names.productsCursor, 600)
    text(shop, copy.review, 48, 662, 850, { fontSize: 24 })
    text(shop, copy.chooseFirst, 48, 706, 860, {
      bindings: {
        text: {
          kind: 'expr',
          expr: `${selected.name} !== "" ? ${selectedTitle.name} : ${JSON.stringify(copy.chooseFirst)}`
        }
      }
    })
    text(shop, '', 48, 746, 860, {
      renderCondition: `${selected.name} !== ""`,
      bindings: {
        text: {
          kind: 'expr',
          expr: `${JSON.stringify(copy.unitPrice + ': ')} + ${selectedPrice.name} + ${JSON.stringify(' · ' + copy.stock + ': ')} + ${selectedStock.name} + ${JSON.stringify(' · ' + copy.amountUnit)}`
        }
      },
      fontSize: 14
    })
    text(shop, copy.quantity, 48, 790)
    shape('INPUT', copy.quantity, shop, 48, 832, 230, 42, {
      bindings: { value: { kind: 'docState', docStateName: quantity.name } },
      renderCondition: `!${checkoutLocked}`,
      interactiveProps: {
        placeholder: '1–99',
        validation: {
          required: true,
          customExpr: validQuantity,
          messages: { custom: copy.quantityInvalid }
        }
      }
    })
    text(shop, '', 48, 832, 230, {
      bindings: { text: { kind: 'expr', expr: quantity.name } },
      renderCondition: checkoutLocked
    })
    text(shop, copy.submitting, 520, 838, 360, {
      renderCondition: `${checkoutBlocked} && (${names.checkoutKey} !== "" || !!${names.checkoutRecovery}.key)`
    })
    button(
      shop,
      copy.checkout,
      296,
      832,
      [
        {
          id: crypto.randomUUID(),
          kind: 'condition',
          condExpr: canCheckout,
          consequent: [
            set(checkoutBusy, '!0'),
            {
              id: crypto.randomUUID(),
              kind: 'confirm',
              messageExpr: `${JSON.stringify(copy.checkoutConfirm + ' ')} + (${orderSummary})`,
              confirmLabel: copy.confirmCheckout,
              cancelLabel: copy.keepEditing,
              consequent: [clear(names.error), checkout],
              alternate: [set(checkoutBusy, '!1')]
            }
          ]
        }
      ],
      { renderCondition: canCheckout }
    )
    text(shop, copy.quantityInvalid, 48, 906, 860, {
      renderCondition: `${selected.name} !== "" && !${validQuantity} && !${checkoutLocked}`,
      height: 48
    })
    text(shop, copy.loginHint, 674, 130, 270, {
      renderCondition: '!$currentUser.signedIn',
      fontSize: 14,
      height: 48
    })
    text(shop, '', 48, 950, 870, {
      bindings: {
        text: {
          kind: 'expr',
          expr: `${selected.name} !== "" && ${validQuantity} ? ${JSON.stringify(copy.estimatedTotal + ': ')} + (${selectedPrice.name} * ${quantity.name}) : ""`
        }
      },
      fontSize: 20
    })
    text(shop, copy.priceNotice, 48, 992, 850, { height: 48, fontSize: 14 })
    error(shop, 1048)
    text(shop, '', 48, 1100, 890, {
      height: 60,
      bindings: {
        text: {
          kind: 'expr',
          expr: `${names.order}.id ? ${JSON.stringify(copy.placed + ': ')} + ${names.order}.product_title + ${JSON.stringify(' · ' + copy.total + ': ')} + ${names.order}.total + ${JSON.stringify(' · ' + copy.orderLabel + ': ')} + ${names.order}.id : ""`
        }
      }
    })
    createCommerceRecoverySection(layout, copy, shop, 1180, {
      info: names.checkoutRecovery,
      busy: checkoutBlocked,
      display: names.checkoutRecoveryDisplay,
      actions: checkoutRecovery
    })
    const orderPage = page(copy.orders, paths.orders, [cancelBusy, ordersAfter], true, 1320)
    text(orderPage, copy.orders, 48, 28, 850, { fontSize: 30 })
    button(orderPage, copy.shop, 48, 88, [navigate(paths.shop)])
    button(orderPage, copy.signOut, 252, 88, [
      {
        id: crypto.randomUUID(),
        kind: 'backendAuth',
        operation: 'signOut',
        errorTarget: names.error
      }
    ])
    const order = listing(orderPage, copy.orders, 164, orderSource, 260)
    text(order, 'Order product', 16, 12, 800, {
      bindings: { text: { kind: 'expr', expr: 'item.product_title' } },
      fontSize: 20
    })
    text(order, 'Order', 16, 48, 810, {
      bindings: {
        text: { kind: 'expr', expr: `${JSON.stringify(copy.orderLabel + ': ')} + item.id` }
      },
      fontSize: 13
    })
    text(order, 'Status', 16, 82, 800, {
      bindings: {
        text: {
          kind: 'expr',
          expr: `(${orderStatus}) + ${JSON.stringify(' · ' + copy.quantityLabel + ': ')} + item.quantity + ${JSON.stringify(' · ' + copy.total + ': ')} + item.total + ${JSON.stringify(' · ' + copy.amountUnit)}`
        }
      },
      fontSize: 14
    })
    text(order, copy.createdAt, 16, 120, 810, {
      bindings: {
        text: { kind: 'expr', expr: `${JSON.stringify(copy.createdAt + ': ')} + item.created_at` }
      },
      fontSize: 13
    })
    button(
      order,
      copy.chooseOrder,
      16,
      172,
      [
        setDoc(selectedOrder, 'item.id'),
        setDoc(selectedOrderSummary, selectedSummary),
        clear(names.error)
      ],
      { renderCondition: `item.status === "pending" && !${cancelLocked}` }
    )
    pagination(orderPage, ordersAfter, names.ordersCursor, 476)
    text(orderPage, copy.selectedOrder, 48, 544, 880, { fontSize: 22 })
    text(orderPage, '', 48, 584, 880, {
      height: 60,
      bindings: {
        text: {
          kind: 'expr',
          expr: `${selectedOrder.name} !== "" ? ${selectedOrderSummary.name} + ${JSON.stringify(' · ')} + ${selectedOrder.name} : ""`
        }
      }
    })
    text(orderPage, copy.submitting, 252, 662, 360, {
      renderCondition: `${cancelBlocked} && (${names.cancelKey} !== "" || !!${names.cancelRecovery}.key)`
    })
    button(
      orderPage,
      copy.cancel,
      48,
      656,
      [
        {
          id: crypto.randomUUID(),
          kind: 'condition',
          condExpr: `${selectedOrder.name} !== "" && !${cancelLocked}`,
          consequent: [
            set(cancelBusy, '!0'),
            {
              id: crypto.randomUUID(),
              kind: 'confirm',
              messageExpr: `${JSON.stringify(copy.cancelConfirm + ' ')} + ${selectedOrder.name} + ${JSON.stringify(' · ')} + ${selectedOrderSummary.name}`,
              confirmLabel: copy.confirmCancellation,
              cancelLabel: copy.keepOrder,
              consequent: [clear(names.error), cancel],
              alternate: [set(cancelBusy, '!1')]
            }
          ]
        }
      ],
      { renderCondition: `${selectedOrder.name} !== "" && !${cancelLocked}` }
    )
    text(orderPage, copy.cancelled, 48, 716, 870, {
      renderCondition: `${names.cancel}.status === "cancelled"`,
      height: 48
    })
    text(orderPage, copy.cancelHint, 48, 774, 850, { height: 64, fontSize: 14 })
    error(orderPage, 846)
    createCommerceRecoverySection(layout, copy, orderPage, 924, {
      info: names.cancelRecovery,
      busy: cancelBlocked,
      display: names.cancelRecoveryDisplay,
      actions: cancelRecovery,
      cancellation: true
    })
    createCommerceCatalogPage(layout, copy, catalog, paths)
  })
  return { pageIds, paths }
}
