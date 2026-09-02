import type { BackendApplicationSpecV1, DataModelIR } from '@open-pencil/lowcode/backend'

export function stripeSecretCanary(suffix: string): string {
  return ['sk', 'live', suffix].join('_')
}

export function backendModelFixture(): DataModelIR {
  return {
    version: 1,
    entities: [
      {
        id: 'notes',
        name: 'notes',
        management: 'managed',
        fields: [
          { id: 'id', name: 'id', type: 'uuid', nullable: false },
          { id: 'owner_id', name: 'owner_id', type: 'uuid', nullable: false },
          { id: 'title', name: 'title', type: 'string', nullable: true }
        ],
        primaryKey: { fields: ['id'] },
        indexes: [{ id: 'notes_owner_idx', fields: ['owner_id'] }]
      }
    ],
    enums: [],
    relations: []
  }
}

export function backendApplicationFixture(): BackendApplicationSpecV1 {
  return {
    format: 'openpencil.backend-application',
    version: 1,
    applicationId: 'notes-app',
    dataModel: backendModelFixture(),
    auth: {
      version: 1,
      identities: [{ id: 'user', kind: 'user' }],
      roles: [],
      ownership: [{ id: 'note-owner', entityId: 'notes', identityFieldId: 'owner_id' }],
      tenants: [],
      rowAccess: [
        {
          id: 'owner-access',
          entityId: 'notes',
          effect: 'allow',
          operations: ['select', 'insert', 'update', 'delete'],
          principal: { kind: 'owner', ownershipId: 'note-owner' }
        }
      ]
    },
    workflows: { version: 1, workflows: [] },
    capabilities: [
      { capability: 'data.read', required: true },
      { capability: 'data.write', required: true },
      { capability: 'policy.row-level', required: true }
    ],
    secrets: [
      {
        kind: 'environment',
        name: 'BACKEND_PUBLIC_KEY',
        exposure: 'client-public',
        required: true
      }
    ]
  }
}
