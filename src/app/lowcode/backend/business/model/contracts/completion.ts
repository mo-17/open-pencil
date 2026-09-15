import type { BackendCommandDefinitionIR } from '@open-pencil/lowcode/backend'

import {
  businessAssert,
  businessCommand,
  businessLiteral,
  businessResult,
  businessUpdate,
  businessUUIDParameter
} from '../commands'
import { contractEvidenceParameters } from './confirmation'
import { CONTRACT_FIELDS, type ContractEntities } from './fields'
import {
  contractAccess,
  contractHistory,
  contractNonempty,
  contractRevision,
  contractVersionParameter,
  readActiveContract
} from './steps'

export function contractCompletionCommands(
  entities: ContractEntities
): BackendCommandDefinitionIR[] {
  return (['closed', 'cancelled'] as const).map((status) =>
    businessCommand(
      status === 'closed' ? 'close-contract' : 'cancel-contract',
      status === 'closed'
        ? 'Close a fully accepted contract record'
        : 'Cancel further fulfillment and retain its records',
      contractAccess(entities.contracts, 'contractId'),
      [
        businessUUIDParameter('contractId'),
        contractVersionParameter(),
        ...contractEvidenceParameters()
      ],
      [
        ...readActiveContract(entities),
        contractNonempty('reference'),
        ...(status === 'closed'
          ? [
              businessAssert(
                'fully_delivered',
                businessResult('contract', 'delivered_quantity'),
                businessResult('contract', 'quantity')
              ),
              businessAssert(
                'fully_accepted',
                businessResult('contract', 'accepted_quantity'),
                businessResult('contract', 'quantity')
              ),
              businessAssert(
                'all_stages_accepted',
                businessResult('contract', 'next_accept_sequence'),
                businessResult('contract', 'next_delivery_sequence')
              )
            ]
          : [contractNonempty('note')]),
        contractHistory(entities, status, status),
        businessUpdate(
          entities.contracts,
          'contract',
          'updated',
          [{ field: 'status', value: businessLiteral(status) }, contractRevision('contract')],
          CONTRACT_FIELDS
        )
      ],
      { resultName: 'updated', fields: CONTRACT_FIELDS }
    )
  )
}
