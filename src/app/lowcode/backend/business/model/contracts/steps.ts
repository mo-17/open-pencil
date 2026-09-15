import type {
  BackendCommandDefinitionIR,
  BackendCommandLeafIR,
  BackendCommandParameterIR,
  BackendCommandStepIR,
  BackendCommandValueIR,
  BackendCommandValueSourceIR,
  DataEntityIR
} from '@open-pencil/lowcode/backend'

import { businessAuditIdentityValues } from '../audit-values'
import {
  businessAssert,
  businessInsert,
  businessLiteral,
  businessParameter,
  businessRead,
  businessResult
} from '../commands'
import {
  CONTRACT_FIELDS,
  CONTRACT_HISTORY_FIELDS,
  CONTRACTS_ROLES,
  type ContractEntities
} from './fields'

export const contractVersionParameter = (): BackendCommandParameterIR => ({
  name: 'expectedVersion',
  type: 'integer',
  required: true,
  min: 0,
  max: 2147483647
})
export const contractRole = (): BackendCommandDefinitionIR['access'] => ({
  kind: 'role',
  roleId: CONTRACTS_ROLES[0]
})
export const contractAccess = (
  entity: DataEntityIR,
  parameter: string
): BackendCommandDefinitionIR['access'] => ({
  kind: 'row-policy',
  entityId: entity.id,
  parameter,
  policyIds: [`own-${entity.name.replaceAll('_', '-')}`],
  roleId: CONTRACTS_ROLES[0]
})
export const contractMath = (
  operator: 'add' | 'multiply',
  left: BackendCommandLeafIR,
  right: BackendCommandLeafIR
): BackendCommandValueSourceIR => ({ kind: 'integer-arithmetic', operator, left, right })
export const contractRevision = (record: string, field = 'version'): BackendCommandValueIR => ({
  field,
  value: contractMath('add', businessResult(record, field), businessLiteral(1))
})
export const contractNonempty = (parameter: string) =>
  businessAssert('nonempty_' + parameter, businessParameter(parameter), businessLiteral(''), 'neq')
export const contractCopy = (record: string, fields: readonly string[]): BackendCommandValueIR[] =>
  fields.map((field) => ({ field, value: businessResult(record, field) }))

export function readContractVersioned(
  entity: DataEntityIR,
  record: string,
  parameter: string,
  fields: readonly string[]
): BackendCommandStepIR[] {
  return [
    businessRead(entity, record, businessParameter(parameter), ['owner_id', ...fields]),
    businessAssert(
      'expected_version',
      businessResult(record, 'version'),
      businessParameter('expectedVersion')
    )
  ]
}
export function readActiveContract(entities: ContractEntities): BackendCommandStepIR[] {
  return [
    ...readContractVersioned(entities.contracts, 'contract', 'contractId', CONTRACT_FIELDS),
    businessAssert(
      'active_contract',
      businessResult('contract', 'status'),
      businessLiteral('active')
    )
  ]
}
export function contractHistory(
  entities: ContractEntities,
  action: string,
  after: 'active' | 'closed' | 'cancelled' = 'active',
  created = false
): BackendCommandStepIR {
  return businessInsert(
    entities.history,
    'history',
    [
      ...businessAuditIdentityValues('contract', 'contract_id', action, created),
      { field: 'reference', value: businessParameter('reference') },
      { field: 'before_status', value: businessResult('contract', 'status') },
      { field: 'after_status', value: businessLiteral(after) },
      { field: 'before_version', value: businessResult('contract', 'version') },
      {
        field: 'after_version',
        value: created ? businessLiteral(0) : contractRevision('contract').value
      }
    ],
    CONTRACT_HISTORY_FIELDS
  )
}
