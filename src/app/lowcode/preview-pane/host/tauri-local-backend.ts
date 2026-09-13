import { nestJSPreviewApplicationDigest } from '@open-pencil/compiler/backend'
import type { PreviewLocalBackendConnection } from '@open-pencil/compiler/preview-local-backend'
import { parseBackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import { readAppBackendProviderDocumentRequest } from '@/app/plugins/host/backend-provider'

import type { PreviewHostBuildRequest } from './types'

/** The process connection cannot change when a document or compiler request changes. */
export function assertLocalBackendPreviewRequest(
  connection: PreviewLocalBackendConnection | undefined,
  request: PreviewHostBuildRequest
): void {
  const preview = request.options.backendPreview
  if (!connection && !preview) return
  const fail = () =>
    new Error(
      'NestJS preview connection no longer matches this document. Reconnect the matching local backend.'
    )
  if (
    !connection ||
    preview?.kind !== 'nestjs-local' ||
    preview.applicationDigest !== connection.applicationDigest
  )
    throw fail()
  const document = readAppBackendProviderDocumentRequest(request.graph)
  if (!document) throw fail()
  const parsed = parseBackendApplicationSpecV1(document.application)
  if (
    !parsed.ok ||
    parsed.value.applicationId !== connection.applicationId ||
    parsed.value.httpApi?.browserClient?.apiBasePath !== connection.apiBasePath ||
    nestJSPreviewApplicationDigest(parsed.value) !== connection.applicationDigest
  )
    throw fail()
}
