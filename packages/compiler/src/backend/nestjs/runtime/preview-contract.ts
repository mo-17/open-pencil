import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import { nestJSPreviewApplicationDigest } from '../preview-digest'
import { runtimeArtifact } from './artifact'

/** Compatibility metadata only; this never grants migration or release authority. */
export function emitNestJSPreviewContract(application: BackendApplicationSpecV1) {
  const available = !application.httpApi?.resources.some((resource) =>
    /^\/_openpencil(?:\/|$)/iu.test(resource.path)
  )
  const contract = JSON.stringify({
    version: 1,
    applicationId: application.applicationId,
    applicationDigest: nestJSPreviewApplicationDigest(application)
  })
  return runtimeArtifact(
    'preview-contract.ts',
    `import type { NestExpressApplication } from '@nestjs/platform-express'
import type { NextFunction, Request, Response } from 'express'

const CONTRACT = ${contract}
const AVAILABLE = ${available}

export function configurePreviewContract(app: NestExpressApplication): void {
  if (!AVAILABLE || process.env.OPENPENCIL_LOCAL_PREVIEW !== '1' ||
      (process.env.HOST ?? '127.0.0.1') !== '127.0.0.1') return
  app.use((request: Request, response: Response, next: NextFunction) => {
    if (request.url?.split('?', 1)[0] !== '/_openpencil/preview-contract') { next(); return }
    const address = request.socket.remoteAddress
    const host = '127.0.0.1:' + (process.env.PORT ?? '3000')
    if (request.method !== 'GET' || request.url !== '/_openpencil/preview-contract' ||
        !['127.0.0.1', '::ffff:127.0.0.1'].includes(address ?? '') ||
        request.headers.host !== host || request.headers.origin !== undefined) {
      response.status(404).end()
      return
    }
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.json(CONTRACT)
  })
}
`
  )
}
