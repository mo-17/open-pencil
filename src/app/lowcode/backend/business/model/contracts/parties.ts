import type {
  BackendCommandDefinitionIR,
  BackendCommandParameterIR
} from '@open-pencil/lowcode/backend'

import {
  businessCaller,
  businessCommand,
  businessInsert,
  businessParameter,
  businessStringParameter,
  businessUpdate,
  businessUUIDParameter
} from '../commands'
import { CONTRACT_PARTY_FIELDS, type ContractEntities } from './fields'
import {
  contractAccess,
  contractNonempty,
  contractRevision,
  contractRole,
  contractVersionParameter,
  readContractVersioned
} from './steps'

export function contractPartyCommands(entities: ContractEntities): BackendCommandDefinitionIR[] {
  const parameters = (): BackendCommandParameterIR[] => [
    businessStringParameter('title', 200),
    businessStringParameter('contact', 200),
    businessStringParameter('description', 1000),
    { name: 'active', type: 'boolean', required: true }
  ]
  const values = () =>
    ['title', 'contact', 'description', 'active'].map((field) => ({
      field,
      value: businessParameter(field)
    }))
  return [
    businessCommand(
      'create-contract-party',
      'Create my counterparty record',
      contractRole(),
      parameters(),
      [
        contractNonempty('title'),
        businessInsert(
          entities.parties,
          'party',
          [{ field: 'owner_id', value: businessCaller() }, ...values()],
          CONTRACT_PARTY_FIELDS
        )
      ],
      { resultName: 'party', fields: CONTRACT_PARTY_FIELDS }
    ),
    businessCommand(
      'update-contract-party',
      'Update my counterparty record',
      contractAccess(entities.parties, 'partyId'),
      [businessUUIDParameter('partyId'), contractVersionParameter(), ...parameters()],
      [
        ...readContractVersioned(entities.parties, 'party', 'partyId', CONTRACT_PARTY_FIELDS),
        contractNonempty('title'),
        businessUpdate(
          entities.parties,
          'party',
          'updated',
          [...values(), contractRevision('party')],
          CONTRACT_PARTY_FIELDS
        )
      ],
      { resultName: 'updated', fields: CONTRACT_PARTY_FIELDS }
    )
  ]
}
