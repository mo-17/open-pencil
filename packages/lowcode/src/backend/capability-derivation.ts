import type {
  AuthPolicyIR,
  BackendApplicationSpecV1,
  BackendCapability,
  BackendDiagnostic,
  BackendWorkflowStepIR,
  DataModelIR
} from './types'

function collectStepCapabilities(
  steps: readonly BackendWorkflowStepIR[],
  capabilities: Set<BackendCapability>
): void {
  for (const step of steps) {
    if (step.kind === 'data.read') capabilities.add('data.read')
    else if (step.kind === 'data.mutate') capabilities.add('data.write')
    else if (step.kind === 'http.request') capabilities.add('server.http')
    else if (step.kind === 'branch') {
      collectStepCapabilities(step.consequent, capabilities)
      collectStepCapabilities(step.alternate, capabilities)
    }
  }
}

function collectAuthCapabilities(auth: AuthPolicyIR, capabilities: Set<BackendCapability>): void {
  const principals = auth.rowAccess.map((intent) => intent.principal.kind)
  if (
    auth.identities.length > 0 ||
    auth.ownership.length > 0 ||
    auth.tenants.length > 0 ||
    principals.some((kind) => kind !== 'anonymous')
  ) {
    capabilities.add('auth.identity')
  }
  if (auth.roles.length > 0 || principals.includes('role')) capabilities.add('auth.roles')
  if (auth.rowAccess.length > 0) capabilities.add('policy.row-level')
}

/** Backend IR v1 represents object-storage usage through its normalized external storage entity. */
function modelUsesObjectStorage(model: DataModelIR): boolean {
  return model.entities.some(
    (entity) =>
      entity.management === 'external' &&
      (entity.name === 'storage_objects' ||
        entity.id === 'storage.objects' ||
        entity.id.endsWith(':storage.objects') ||
        entity.id.endsWith(':storage.storage_objects'))
  )
}

export function deriveBackendApplicationCapabilities(
  application: BackendApplicationSpecV1
): BackendCapability[] {
  const capabilities = new Set<BackendCapability>()
  collectAuthCapabilities(application.auth, capabilities)
  if (application.workflows.workflows.length > 0) {
    capabilities.add('auth.identity')
    capabilities.add('server.functions')
    capabilities.add('server.http')
    for (const workflow of application.workflows.workflows) {
      collectStepCapabilities(workflow.steps, capabilities)
    }
  }
  if (application.dataModel.entities.some((entity) => entity.management === 'managed')) {
    capabilities.add('migrations.schema')
  }
  if (modelUsesObjectStorage(application.dataModel)) capabilities.add('storage.objects')
  return [...capabilities].sort((left, right) => left.localeCompare(right, 'en'))
}

export function validateBackendCapabilityDeclarations(
  application: BackendApplicationSpecV1
): BackendDiagnostic[] {
  const declarations = new Map(
    application.capabilities.map((requirement) => [requirement.capability, requirement])
  )
  return deriveBackendApplicationCapabilities(application).flatMap((capability) => {
    const declaration = declarations.get(capability)
    if (declaration?.required) return []
    const optional = declaration !== undefined
    return [
      {
        code: optional
          ? 'backend-capability-use-not-required'
          : 'backend-capability-use-undeclared',
        severity: 'error' as const,
        path: `$.capabilities.${capability}`,
        message: optional
          ? 'A capability used by Backend IR must be declared with required true.'
          : 'Backend IR uses a capability that is not declared as required.'
      }
    ]
  })
}
