import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'
import type { SceneNode } from '@open-pencil/scene-graph'

import { BackendDraftOperationError } from '@/app/lowcode/backend/draft'
import type { NotesTemplateEditor } from '@/app/lowcode/backend/notes-template'

import { commerceCopy } from '../copy'
import { createCommerceLayout } from '../layout'
import type { CommerceMerchantMode } from '../merchant/types'
import { commerceOperationsCopy } from './copy'

export function createOperationsContext(
  editor: NotesTemplateEditor,
  root: SceneNode,
  application: BackendApplicationSpecV1,
  mode: CommerceMerchantMode,
  locale: string
) {
  const copy = commerceOperationsCopy(locale)
  const baseCopy = { ...commerceCopy(locale), admin: copy.admin }
  const docStates = structuredClone(root.lowcodeDocumentState ?? [])
  const doc = (base: string, type: 'string' | 'object' | 'number' = 'string') => {
    let name = 'commerce' + base[0].toUpperCase() + base.slice(1)
    while (docStates.some((entry) => entry.name === name)) name += 'Next'
    docStates.push({
      id: crypto.randomUUID(),
      name,
      type,
      defaultValue: { object: {}, number: 0, string: '' }[type]
    })
    return name
  }
  const route = (base: string) => {
    for (let index = 1; index < 100; index++) {
      const path = index === 1 ? base : base + '-' + index
      if (
        !editor.graph
          .getPages()
          .some(
            (page) =>
              page.lowcodeRoutePattern === path ||
              '/' + page.name.toLowerCase().replace(/\s+/gu, '-') === path
          )
      )
        return path
    }
    throw new BackendDraftOperationError('No available commerce route remains.')
  }
  const paths = {
    shop: route('/shop'),
    cart: route('/cart'),
    checkout: route('/checkout'),
    purchases: route('/purchases'),
    orders: route('/orders'),
    merchantOrders: route('/merchant-orders'),
    settlements: route('/merchant-settlements'),
    operator: route('/commerce-operator'),
    stores: route('/stores'),
    myStore: route('/my-store'),
    login: route('/shop-login'),
    admin: route('/catalog-admin')
  }
  const error = doc('error')
  const store = doc('managedStore', 'object')
  const browseStore = doc('browseStore')
  const currentStore = `(${store}.id || "")`
  const layout = createCommerceLayout(editor, baseCopy, error)
  return {
    editor,
    application,
    mode,
    locale,
    copy,
    baseCopy,
    docStates,
    doc,
    paths,
    layout,
    error,
    store,
    currentStore,
    browseStore
  }
}
export type OperationsContext = ReturnType<typeof createOperationsContext>
