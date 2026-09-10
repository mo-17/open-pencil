import { auditApplicationRuntime as auditFromSubpath } from '../dist/application-runtime.js'
import {
  BACKEND_APPLICATION_SPEC_VERSION,
  createBackendAutomationIdempotencyCASProposal,
  createBackendAutomationOutboxCASProposal,
  createBackendOperationalEventSinkCASProposal,
  planBackendAutomationExecutionDisposition,
  planBackendAutomationQueueMutation,
  reviewBackendWebhookEndpointObservationV1
} from '../dist/backend.js'
import { auditApplicationRuntime, parseExpression } from '../dist/index.js'

if (auditApplicationRuntime !== auditFromSubpath) {
  throw new Error('Application runtime subpath does not match the package root export')
}

if (BACKEND_APPLICATION_SPEC_VERSION !== 1) {
  throw new Error('Backend contract subpath smoke failed')
}

const backendP2Exports = [
  planBackendAutomationExecutionDisposition,
  createBackendAutomationIdempotencyCASProposal,
  planBackendAutomationQueueMutation,
  createBackendAutomationOutboxCASProposal,
  createBackendOperationalEventSinkCASProposal,
  reviewBackendWebhookEndpointObservationV1
]

if (backendP2Exports.some((value) => typeof value !== 'function')) {
  throw new Error('Backend P2 contract subpath smoke failed')
}

const parsed = parseExpression('count + 1')
if (!parsed.ok || !parsed.references.has('count')) {
  throw new Error('Lowcode expression parser smoke failed')
}

process.stdout.write('@open-pencil/lowcode dist smoke passed\n')
