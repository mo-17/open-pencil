import type { ActionDef } from '@open-pencil/scene-graph'

import type { CommerceLayout } from '../layout'
import { setCommerceState as set, setCommerceVariable as variable } from '../state'
import type { CommerceMerchantState } from './state'

export function createCommerceStorePages(
  layout: CommerceLayout,
  merchant: CommerceMerchantState
): void {
  const {
    copy,
    paths,
    targets: t,
    storeId,
    browseStore,
    browseTitle,
    storesAfter,
    storeTitle,
    storeBusy
  } = merchant
  if (!paths.stores || !paths.openStore || !storeId || !browseStore || !browseTitle)
    throw new Error('Missing marketplace page configuration.')
  const { page, text, button, navigate, listing, shape, pagination } = layout
  const directory = page(copy.stores, paths.stores, [storesAfter], false, 900)
  text(directory, copy.stores, 48, 28, 850, { fontSize: 30 })
  text(directory, copy.storeHint, 48, 84, 880, { height: 54, fontSize: 14 })
  button(directory, copy.allProducts, 48, 150, [
    variable(browseStore, '""'),
    variable(browseTitle, '""'),
    navigate(paths.shop)
  ])
  button(directory, copy.openStore, 252, 150, [navigate(paths.openStore)])
  const store = listing(directory, copy.stores, 230, merchant.storesSource, 170)
  text(store, copy.storeTitle, 16, 18, 800, {
    fontSize: 22,
    bindings: { text: { kind: 'expr', expr: 'item.title' } }
  })
  button(store, copy.visitStore, 16, 90, [
    variable(browseStore, 'item.id'),
    variable(browseTitle, 'item.title'),
    navigate(paths.shop)
  ])
  pagination(directory, storesAfter, t.storesCursor, 552)
  const privateStore = page(copy.openStore, paths.openStore, [storeTitle, storeBusy], true, 1300)
  text(privateStore, copy.openStore, 48, 28, 850, { fontSize: 30 })
  text(privateStore, copy.openStoreHint, 48, 80, 880, { height: 70, fontSize: 14 })
  button(privateStore, copy.stores, 48, 164, [navigate(paths.stores)])
  button(privateStore, copy.merchantOrders, 252, 164, [navigate(paths.merchantOrders)])
  text(privateStore, copy.existingStore, 48, 232, 850, { fontSize: 22 })
  const own = listing(privateStore, copy.existingStore, 280, merchant.ownStoreSource, 170)
  text(own, copy.storeTitle, 16, 18, 800, {
    fontSize: 22,
    bindings: { text: { kind: 'expr', expr: 'item.title' } }
  })
  button(own, copy.manageStore, 16, 90, [variable(storeId, 'item.id'), navigate(paths.admin)])
  text(privateStore, copy.createStore, 48, 590, 850, { fontSize: 22 })
  text(privateStore, copy.createStoreHint, 48, 634, 880, { height: 68, fontSize: 14 })
  const submit: ActionDef = {
    id: crypto.randomUUID(),
    kind: 'condition',
    condExpr: `!${storeBusy.name}`,
    consequent: [set(storeBusy, '!0'), variable(t.error, '""'), merchant.open]
  }
  const form = shape('FORM', copy.createStore, privateStore, 48, 724, 900, 148, {
    layoutMode: 'NONE',
    renderCondition: `!${storeBusy.name}`,
    events: { onSubmit: [submit] }
  })
  text(form, copy.storeTitle, 0, 0, 850)
  shape('INPUT', copy.storeTitle, form, 0, 38, 820, 42, {
    bindings: { value: { kind: 'ref', stateId: storeTitle.id } },
    interactiveProps: {
      placeholder: copy.storeTitle,
      validation: { required: true, maxLength: 100, pattern: '\\S' }
    }
  })
  button(form, copy.createStore, 0, 100, [])
  text(privateStore, copy.base.submitting, 48, 738, 850, { renderCondition: storeBusy.name })
  text(privateStore, copy.storeCreated, 48, 912, 850, { renderCondition: `!!${t.createdStore}.id` })
  button(privateStore, copy.manageStore, 48, 962, [navigate(paths.admin)], {
    renderCondition: `!!${storeId}`
  })
  for (const parent of [directory, privateStore])
    text(parent, '', 48, parent === directory ? 624 : 1030, 880, {
      height: 64,
      bindings: { text: { kind: 'docState', docStateName: t.error } }
    })
}
