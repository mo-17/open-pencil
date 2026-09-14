import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import {
  commitBackendProviderDocumentRequest,
  createBackendProviderDocumentRequest,
  readBackendProviderDocumentRequest
} from '@/app/lowcode/backend/document'
import { BackendDraftOperationError } from '@/app/lowcode/backend/draft'
import type { AppBackendProviderDescriptor } from '@/app/plugins/host/backend-provider'

import { assertBusinessTemplateId, type BusinessTemplateId } from './model/types'
import { prepareBusinessModulePages, renderBusinessModulePages } from './pages/module'
import type { BusinessTemplateEditor } from './types'

export { prepareBusinessModulePages, renderBusinessModulePages } from './pages/module'
export type {
  BusinessModulePageOptions,
  BusinessModulePagePlan,
  BusinessNavigationEntry,
  BusinessPageReference
} from './pages/module-types'

export function createBusinessPages(
  editor: BusinessTemplateEditor,
  descriptor: AppBackendProviderDescriptor,
  application: BackendApplicationSpecV1,
  kind: BusinessTemplateId,
  locale = 'en'
) {
  assertBusinessTemplateId(kind)
  const root = editor.graph.getNode(editor.graph.rootId)
  if (
    !root ||
    readBackendProviderDocumentRequest(editor.graph) ||
    root.lowcodeSupabaseConfig !== undefined ||
    root.lowcodeAuthRedirect !== undefined ||
    editor.graph.getPages().some((page) => page.lowcodeRequiresAuth)
  )
    throw new BackendDraftOperationError(
      'Create this business application in a document without an existing Backend or authentication flow.'
    )
  createBackendProviderDocumentRequest(descriptor, application)
  const plan = prepareBusinessModulePages(editor, application, kind, { locale })
  return editor.undo.runBatch('Create business application', () => {
    commitBackendProviderDocumentRequest(editor, descriptor, application)
    return renderBusinessModulePages(editor, plan)
  })
}
