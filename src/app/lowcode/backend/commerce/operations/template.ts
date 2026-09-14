import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import {
  commitBackendProviderDocumentRequest,
  createBackendProviderDocumentRequest
} from '@/app/lowcode/backend/document'
import { BackendDraftOperationError } from '@/app/lowcode/backend/draft'
import type { NotesTemplateEditor } from '@/app/lowcode/backend/notes-template'
import type { AppBackendProviderDescriptor } from '@/app/plugins/host/backend-provider'

import { createCommerceCatalogPage } from '../catalog/page'
import { createCommerceCatalogState } from '../catalog/state'
import { assertCommerceMerchantMode, type CommerceMerchantMode } from '../merchant/types'
import { canInstallCommerceExample } from '../template'
import { createOperationsCart, createOperationsCheckout } from './cart'
import { createOperationsContext } from './context'
import { createOperationsFulfillment } from './fulfillment'
import { createOperationsPurchases, createOperationsOrders } from './purchases'
import { createOperationsScreen } from './screen'
import { createOperationsSettlements, createOperationsOperator } from './settlements'
import { createOperationsShop, createOperationsStores } from './shop'
import { validateOperationsPages } from './validation'

/** Fresh operations edition only; existing starters and migration identities stay explicit. */
export function createCommerceOperationsPages(
  editor: NotesTemplateEditor,
  descriptor: AppBackendProviderDescriptor,
  application: BackendApplicationSpecV1,
  mode: CommerceMerchantMode,
  locale = 'en'
) {
  assertCommerceMerchantMode(mode)
  if (!application.commerce || application.commerce.mode !== mode)
    throw new BackendDraftOperationError(
      'The operations template requires its matching commerce model.'
    )
  if (!canInstallCommerceExample(editor))
    throw new BackendDraftOperationError(
      'Use a new document without an existing Backend or authentication flow.'
    )
  createBackendProviderDocumentRequest(descriptor, application)
  const root = editor.graph.getNode(editor.graph.rootId)
  if (!root) throw new BackendDraftOperationError('The document root is unavailable.')
  const ctx = createOperationsContext(editor, root, application, mode, locale)
  editor.undo.runBatch('Create commerce operations application', () => {
    commitBackendProviderDocumentRequest(editor, descriptor, application)
    const login = createOperationsScreen(ctx, 'login', 600, ctx.copy.loginHint, false)
    ctx.layout.button(login.page, ctx.copy.signIn, 48, 244, [
      {
        id: crypto.randomUUID(),
        kind: 'backendAuth',
        operation: 'signIn',
        returnPath: ctx.paths.shop,
        errorTarget: login.error
      }
    ])
    ctx.layout.button(login.page, ctx.copy.signOut, 280, 244, [
      {
        id: crypto.randomUUID(),
        kind: 'backendAuth',
        operation: 'signOut',
        errorTarget: login.error
      }
    ])
    login.finish()
    createOperationsShop(ctx)
    createOperationsCart(ctx)
    createOperationsCheckout(ctx)
    createOperationsPurchases(ctx)
    createOperationsOrders(ctx)
    createOperationsFulfillment(ctx)
    createOperationsSettlements(ctx)
    createOperationsOperator(ctx)
    createOperationsStores(ctx)
    const catalog = createCommerceCatalogState(ctx.doc, ctx.baseCopy, ctx.currentStore)
    createCommerceCatalogPage(ctx.layout, ctx.baseCopy, catalog, ctx.paths)
    editor.updateNodeWithUndo(
      root.id,
      { lowcodeDocumentState: ctx.docStates, lowcodeAuthRedirect: ctx.paths.login },
      'Configure commerce operations state'
    )
    validateOperationsPages(ctx)
  })
  return { pageIds: ctx.layout.pageIds, paths: ctx.paths }
}
