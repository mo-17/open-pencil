import type { SceneNode, StateDef } from '@open-pencil/scene-graph'

import type { commerceCopy } from '../copy'
import type { CommerceLayout } from '../layout'
import { createCommerceRecoverySection } from '../recovery/section'
import { setCommerceState as set } from '../state'
import type { CommerceCatalogState } from './state'

export function createCommerceCatalogPage(
  layout: CommerceLayout,
  copy: ReturnType<typeof commerceCopy>,
  catalog: CommerceCatalogState,
  paths: { admin: string; shop: string }
) {
  const { page, text, shape, button, navigate, listing, pagination } = layout
  const { fields: f, targets: t, locked, editing, creating, draft } = catalog
  const admin = page(copy.admin, paths.admin, Object.values(f), true, 2000)
  text(admin, copy.admin, 48, 28, 850, { fontSize: 30 })
  text(admin, copy.adminHint, 48, 84, 880, { height: 64, fontSize: 14 })
  button(admin, copy.shop, 48, 162, [navigate(paths.shop)])
  button(admin, copy.newProduct, 252, 162, catalog.newProduct, { renderCondition: `!${locked}` })
  const search = shape('FORM', copy.search, admin, 48, 224, 900, 48, {
    layoutMode: 'NONE',
    events: { onSubmit: [set(f.search, f.searchInput.name), set(f.after, '""')] }
  })
  shape('INPUT', copy.searchPlaceholder, search, 0, 0, 650, 42, {
    bindings: { value: { kind: 'ref', stateId: f.searchInput.id } },
    interactiveProps: { placeholder: copy.searchPlaceholder, validation: { maxLength: 120 } }
  })
  button(search, copy.search, 670, 0, [])
  text(admin, copy.catalogHint, 48, 282, 880, { height: 44, fontSize: 13 })
  const product = listing(admin, copy.catalogAll, 340, catalog.source)
  text(product, copy.title, 16, 12, 800, {
    bindings: { text: { kind: 'expr', expr: 'item.title' } },
    fontSize: 20
  })
  text(product, copy.stock, 16, 54, 800, {
    fontSize: 14,
    bindings: {
      text: {
        kind: 'expr',
        expr: `${JSON.stringify(copy.price + ': ')} + item.price + ${JSON.stringify(' · ' + copy.stock + ': ')} + item.stock + " · " + (item.active ? ${JSON.stringify(copy.published)} : ${JSON.stringify(copy.unpublished)})`
      }
    }
  })
  button(product, copy.editProduct, 16, 108, catalog.select, { renderCondition: `!${locked}` })
  pagination(admin, f.after, t.cursor, 650)
  text(admin, copy.chooseToManage, 48, 714, 880, { renderCondition: `!${draft}`, height: 48 })
  text(admin, copy.draftHint, 48, 714, 880, { renderCondition: draft, height: 48, fontSize: 14 })
  const form = shape('FORM', copy.editProduct, admin, 48, 780, 900, 382, {
    layoutMode: 'NONE',
    renderCondition: `${draft} && !${locked}`,
    events: { onSubmit: [catalog.submit] }
  })
  const input = (
    label: string,
    entry: StateDef,
    y: number,
    validation: NonNullable<SceneNode['interactiveProps']>,
    condition?: string
  ) => {
    text(form, label, 0, y, 850, condition ? { renderCondition: condition } : {})
    shape('INPUT', label, form, 0, y + 30, 820, 42, {
      bindings: { value: { kind: 'ref', stateId: entry.id } },
      interactiveProps: { placeholder: label, validation },
      events: { onChange: catalog.clearFeedback() },
      ...(condition ? { renderCondition: condition } : {})
    })
  }
  input(copy.title, f.title, 0, {
    required: true,
    maxLength: 16384,
    pattern: '\\S',
    messages: {
      required: copy.titleInvalid,
      pattern: copy.titleInvalid,
      maxLength: copy.titleInvalid
    }
  })
  input(copy.price, f.price, 86, {
    required: true,
    customExpr: catalog.validPrice,
    messages: { custom: copy.nonnegativeInteger }
  })
  input(
    copy.initialStock,
    f.stock,
    172,
    {
      required: true,
      customExpr: catalog.validStock,
      messages: { custom: copy.nonnegativeInteger }
    },
    creating
  )
  text(form, copy.currentStock, 0, 174, 850, {
    renderCondition: editing,
    bindings: {
      text: {
        kind: 'expr',
        expr: `${JSON.stringify(copy.currentStock + ': ')} + ${f.displayedStock.name}`
      }
    }
  })
  text(form, copy.stockEditHint, 0, 206, 850, {
    renderCondition: editing,
    height: 38,
    fontSize: 13
  })
  text(form, copy.active, 0, 262, 360, {
    bindings: {
      text: {
        kind: 'expr',
        expr: `${f.active.name} ? ${JSON.stringify(copy.published)} : ${JSON.stringify(copy.unpublished)}`
      }
    }
  })
  for (const [active, label] of [
    [true, copy.markUnavailable],
    [false, copy.markAvailable]
  ] as const) {
    button(
      form,
      label,
      400,
      254,
      [set(f.active, active ? '!1' : '!0'), ...catalog.clearFeedback()],
      {
        renderCondition: active ? f.active.name : `!${f.active.name}`
      }
    )
  }
  for (const [condition, label] of [
    [creating, copy.saveProduct],
    [editing, copy.saveChanges]
  ]) {
    button(form, label, 0, 328, [], { renderCondition: condition })
  }
  button(form, copy.discardDraft, 252, 328, [set(f.mode, '""'), ...catalog.clearFeedback()], {
    renderCondition: draft
  })
  text(admin, copy.submitting, 48, 790, 860, {
    renderCondition: `${catalog.busy} && ${f.activity.name} !== "confirming"`
  })
  text(admin, '', 48, 1176, 880, {
    height: 48,
    renderCondition: catalog.currentOperation,
    bindings: { text: { kind: 'expr', expr: f.feedback.name } }
  })
  text(admin, copy.restockTitle, 48, 1234, 850, { fontSize: 24 })
  text(admin, copy.restockHint, 48, 1276, 880, { height: 60, fontSize: 14 })
  shape('INPUT', copy.restockQuantity, admin, 48, 1350, 300, 42, {
    renderCondition: `${editing} && !${locked}`,
    bindings: { value: { kind: 'ref', stateId: f.quantity.id } },
    interactiveProps: {
      placeholder: copy.restockQuantity,
      validation: {
        required: true,
        customExpr: catalog.validQuantity,
        messages: { custom: copy.restockInvalid }
      }
    }
  })
  button(admin, copy.restockTitle, 378, 1350, [catalog.restockSubmit], {
    renderCondition: `${editing} && !${locked} && ${catalog.validQuantity}`
  })
  text(admin, copy.restockInvalid, 48, 1402, 880, {
    renderCondition: `${editing} && !${locked} && !${catalog.validQuantity}`,
    height: 44
  })
  text(admin, '', 48, 1450, 880, {
    height: 64,
    renderCondition: `!!${t.restock}.id && ${catalog.currentOperation}`,
    bindings: {
      text: {
        kind: 'expr',
        expr: `${JSON.stringify(copy.restocked + ' · ' + copy.stock + ': ')} + ${t.restock}.stock + " · " + ${t.restock}.id`
      }
    }
  })
  text(admin, '', 48, 1524, 880, {
    height: 48,
    bindings: { text: { kind: 'docState', docStateName: t.error } }
  })
  createCommerceRecoverySection(layout, copy, admin, 1598, {
    info: t.recovery,
    busy: catalog.busy,
    display: t.display,
    actions: catalog.recovery,
    acknowledgeLabel: copy.newRestock
  })
}
