import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import type { NotesTemplateEditor } from '@/app/lowcode/backend/notes-template'
import type { AppBackendProviderDescriptor } from '@/app/plugins/host/backend-provider'

import { createCommercePages } from '../template'
import { assertCommerceMerchantMode, type CommerceMerchantMode } from './types'

export function createMerchantCommercePages(
  editor: NotesTemplateEditor,
  descriptor: AppBackendProviderDescriptor,
  application: BackendApplicationSpecV1,
  mode: CommerceMerchantMode,
  locale = 'en'
) {
  assertCommerceMerchantMode(mode)
  const result = createCommercePages(editor, descriptor, application, locale, mode)
  if (!result.paths.merchantOrders) throw new Error('Missing merchant orders page.')
  return { ...result, paths: { ...result.paths, merchantOrders: result.paths.merchantOrders } }
}
