import type { AuthRowAccessIntentIR, BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

/** Include HTTP and command authority in draft editing, before final contract validation. */
export function backendContractReferencesEntity(
  application: BackendApplicationSpecV1,
  entityId: string
): boolean {
  return (
    (application.modules?.modules.some((module) => module.entityIds.includes(entityId)) ?? false) ||
    application.auth.rowAccess.some(
      (policy) =>
        policy.principal.kind === 'related-member' &&
        policy.principal.membershipEntityId === entityId
    ) ||
    (application.httpApi?.resources.some((resource) => resource.entityId === entityId) ?? false) ||
    (application.commands?.commands.some(
      (command) =>
        (command.access.kind === 'row-policy' && command.access.entityId === entityId) ||
        command.steps.some((step) => step.kind !== 'assert' && step.entityId === entityId)
    ) ??
      false)
  )
}

export function backendContractReferencesField(
  application: BackendApplicationSpecV1,
  entityId: string,
  fieldId: string
): boolean {
  if (
    application.auth.rowAccess.some((policy) => {
      if (
        policy.entityId === entityId &&
        policy.conditions?.some((condition) => condition.fieldId === fieldId)
      )
        return true
      const principal = policy.principal
      if (principal.kind !== 'related-member') return false
      return (
        (policy.entityId === entityId && principal.entityFieldId === fieldId) ||
        (principal.membershipEntityId === entityId &&
          (principal.membershipFieldId === fieldId ||
            principal.identityFieldId === fieldId ||
            (principal.conditions?.some((condition) => condition.fieldId === fieldId) ?? false)))
      )
    })
  )
    return true
  if (
    application.httpApi?.resources.some(
      (resource) =>
        resource.entityId === entityId &&
        [
          ...resource.readFields,
          ...(resource.createFields ?? []),
          ...(resource.updateFields ?? []),
          ...(resource.query?.filterFields ?? []),
          ...(resource.query?.searchFields ?? []),
          ...(resource.query?.sortFields ?? [])
        ].includes(fieldId)
    )
  )
    return true
  return (
    application.commands?.commands.some((command) =>
      command.steps.some(
        (step) =>
          step.kind !== 'assert' &&
          step.entityId === entityId &&
          (step.fields.includes(fieldId) ||
            (step.kind === 'data.mutate' &&
              step.values.some((assignment) => assignment.field === fieldId)))
      )
    ) ?? false
  )
}

export function backendContractReferencesRole(
  application: BackendApplicationSpecV1,
  roleId: string
): boolean {
  return (
    application.auth.rowAccess.some(
      (policy) => 'roleId' in policy.principal && policy.principal.roleId === roleId
    ) ||
    (application.commands?.commands.some(
      (command) => 'roleId' in command.access && command.access.roleId === roleId
    ) ??
      false)
  )
}

export function backendContractReferencesPolicy(
  application: BackendApplicationSpecV1,
  policyId: string
): boolean {
  return (
    (application.httpApi?.resources.some((resource) =>
      resource.readPolicyIds?.includes(policyId)
    ) ??
      false) ||
    (application.commands?.commands.some(
      (command) =>
        command.access.kind === 'row-policy' && command.access.policyIds.includes(policyId)
    ) ??
      false)
  )
}

/** The basic permission form must not erase a compound rule it cannot represent. */
export function backendPolicyNeedsAdvancedEditor(
  application: BackendApplicationSpecV1,
  policy: AuthRowAccessIntentIR
): boolean {
  return (
    policy.principal.kind === 'related-member' ||
    Boolean(policy.conditions?.length) ||
    (application.commands?.commands.some(
      (command) =>
        command.access.kind === 'row-policy' && command.access.policyIds.includes(policy.id)
    ) ??
      false)
  )
}
