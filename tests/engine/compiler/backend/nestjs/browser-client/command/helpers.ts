import { deriveBackendApplicationCapabilities } from '@open-pencil/lowcode/backend'
import type { BackendCommandAction } from '@open-pencil/scene-graph'

import { browserApplication, browserGraph, setSubmit } from '../helpers'

export function commandApplication() {
  const application = browserApplication()
  application.commands = {
    version: 1,
    commands: [
      {
        id: 'save-note',
        name: 'Save note atomically',
        path: '/commands/save-note',
        access: { kind: 'authenticated' },
        idempotency: { kind: 'required', header: 'Idempotency-Key' },
        parameters: [{ name: 'title', type: 'string', maxLength: 100, required: true }],
        steps: [
          {
            id: 'insert',
            kind: 'data.mutate',
            entityId: 'notes',
            operation: 'insert',
            values: [
              { field: 'owner_id', value: { kind: 'caller-sub' } },
              { field: 'title', value: { kind: 'parameter', name: 'title' } }
            ],
            resultName: 'saved',
            fields: ['id', 'title']
          }
        ],
        return: { resultName: 'saved', fields: ['id', 'title'] }
      }
    ]
  }
  application.capabilities = deriveBackendApplicationCapabilities(application).map(
    (capability) => ({ capability, required: true })
  )
  return application
}
export function commandAction(): BackendCommandAction {
  return {
    id: 'save',
    kind: 'backendCommand',
    commandId: 'save-note',
    payloadEntries: [{ key: 'title', valueExpr: 'title' }],
    idempotencyKeyTarget: 'attempt',
    resultTarget: 'result',
    errorTarget: 'error',
    onSuccess: [
      { id: 'success', kind: 'setVariable', targetName: 'error', valueExpr: '""' },
      { id: 'navigate', kind: 'navigate', to: '/login' }
    ],
    onError: [{ id: 'failure', kind: 'setVariable', targetName: 'error', valueExpr: 'error.code' }]
  }
}
export function commandGraph() {
  const fixture = browserGraph()
  fixture.graph.updateNode(fixture.graph.rootId, {
    lowcodeDocumentState: [
      ...(fixture.graph.getNode(fixture.graph.rootId)?.lowcodeDocumentState ?? []),
      { id: 'attempt', name: 'attempt', type: 'string', defaultValue: '' }
    ]
  })
  setSubmit(fixture, commandAction())
  return fixture
}
