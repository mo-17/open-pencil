import type { SceneNode } from '@open-pencil/scene-graph'

import { BackendDraftOperationError } from '../draft'
import type { NotesTemplateEditor } from '../notes-template'
import { commerceCopy } from './copy'
import { commerceMerchantCopy } from './merchant/copy'
import { prepareCommerceMerchantState } from './merchant/state'
import type { CommerceMerchantMode } from './merchant/types'

/** Prepare local state and collision-free routes before the document's one undoable mutation. */
export function createCommercePageContext(
  editor: NotesTemplateEditor,
  root: SceneNode,
  locale: string,
  merchantMode?: CommerceMerchantMode
) {
  const copy = merchantMode ? commerceMerchantCopy(locale, merchantMode).base : commerceCopy(locale)
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
    admin: route('/catalog-admin'),
    ...(merchantMode ? { merchantOrders: route('/merchant-orders') } : {}),
    ...(merchantMode === 'multi-merchant'
      ? { stores: route('/stores'), openStore: route('/my-store') }
      : {})
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
  const merchant =
    merchantMode && paths.merchantOrders
      ? prepareCommerceMerchantState(merchantMode, locale, doc, {
          ...paths,
          merchantOrders: paths.merchantOrders
        })
      : undefined
  return { copy, paths, docStates, doc, names, merchant }
}
