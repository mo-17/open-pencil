import type { BackendCommandDefinitionIR } from '@open-pencil/lowcode/backend'

import {
  businessAssert,
  businessCaller,
  businessCommand,
  businessInsert,
  businessLiteral,
  businessParameter,
  businessRead,
  businessResult,
  businessStringParameter,
  businessUpdate,
  businessUUIDParameter
} from '../commands'
import { contractEvidenceParameters } from './confirmation'
import { CONTRACT_DELIVERY_FIELDS, CONTRACT_FIELDS, type ContractEntities } from './fields'
import {
  contractAccess,
  contractHistory,
  contractMath,
  contractNonempty,
  contractRevision,
  contractVersionParameter,
  readActiveContract
} from './steps'

function recordDelivery(entities: ContractEntities): BackendCommandDefinitionIR {
  const delivered = contractMath(
    'add',
    businessResult('contract', 'delivered_quantity'),
    businessParameter('quantity')
  )
  return businessCommand(
    'record-contract-delivery',
    'Record the next delivery stage',
    contractAccess(entities.contracts, 'contractId'),
    [
      businessUUIDParameter('contractId'),
      contractVersionParameter(),
      businessStringParameter('title', 200),
      { name: 'quantity', type: 'integer', required: true, min: 1, max: 100000 },
      ...contractEvidenceParameters()
    ],
    [
      ...readActiveContract(entities),
      contractNonempty('title'),
      contractNonempty('reference'),
      businessAssert('bounded_delivery', delivered, businessResult('contract', 'quantity'), 'lte'),
      businessInsert(
        entities.deliveries,
        'delivery',
        [
          { field: 'owner_id', value: businessResult('contract', 'owner_id') },
          { field: 'contract_id', value: businessResult('contract', 'id') },
          { field: 'title', value: businessParameter('title') },
          { field: 'sequence', value: businessResult('contract', 'next_delivery_sequence') },
          { field: 'quantity', value: businessParameter('quantity') },
          {
            field: 'amount_cents',
            value: contractMath(
              'multiply',
              businessParameter('quantity'),
              businessResult('contract', 'unit_price_cents')
            )
          },
          ...['reference', 'note'].map((field) => ({ field, value: businessParameter(field) })),
          { field: 'submitted_by', value: businessCaller() }
        ],
        CONTRACT_DELIVERY_FIELDS
      ),
      contractHistory(entities, 'delivery_recorded'),
      businessUpdate(
        entities.contracts,
        'contract',
        'updated',
        [
          { field: 'delivered_quantity', value: delivered },
          contractRevision('contract', 'next_delivery_sequence'),
          contractRevision('contract')
        ],
        CONTRACT_FIELDS
      )
    ],
    { resultName: 'updated', fields: CONTRACT_FIELDS }
  )
}

function acceptDelivery(entities: ContractEntities): BackendCommandDefinitionIR {
  const accepted = contractMath(
    'add',
    businessResult('contract', 'accepted_quantity'),
    businessResult('delivery', 'quantity')
  )
  return businessCommand(
    'accept-contract-delivery',
    'Internally record acceptance of the next delivery',
    contractAccess(entities.contracts, 'contractId'),
    [
      businessUUIDParameter('contractId'),
      businessUUIDParameter('deliveryId'),
      contractVersionParameter(),
      ...contractEvidenceParameters()
    ],
    [
      ...readActiveContract(entities),
      businessRead(
        entities.deliveries,
        'delivery',
        businessParameter('deliveryId'),
        ['owner_id', ...CONTRACT_DELIVERY_FIELDS],
        'owner'
      ),
      businessAssert(
        'delivery_matches_contract',
        businessResult('delivery', 'contract_id'),
        businessResult('contract', 'id')
      ),
      businessAssert(
        'pending_acceptance',
        businessResult('delivery', 'status'),
        businessLiteral('submitted')
      ),
      businessAssert(
        'acceptance_sequence',
        businessResult('delivery', 'sequence'),
        businessResult('contract', 'next_accept_sequence')
      ),
      businessAssert(
        'bounded_acceptance',
        accepted,
        businessResult('contract', 'delivered_quantity'),
        'lte'
      ),
      contractNonempty('reference'),
      businessUpdate(
        entities.deliveries,
        'delivery',
        'accepted',
        [
          { field: 'status', value: businessLiteral('accepted') },
          { field: 'accepted_by', value: businessCaller() },
          { field: 'acceptance_reference', value: businessParameter('reference') },
          { field: 'acceptance_note', value: businessParameter('note') },
          { field: 'accepted_at', value: { kind: 'server-now' } },
          contractRevision('delivery')
        ],
        CONTRACT_DELIVERY_FIELDS
      ),
      contractHistory(entities, 'acceptance_recorded'),
      businessUpdate(
        entities.contracts,
        'contract',
        'updated',
        [
          { field: 'accepted_quantity', value: accepted },
          contractRevision('contract', 'next_accept_sequence'),
          contractRevision('contract')
        ],
        CONTRACT_FIELDS
      )
    ],
    { resultName: 'updated', fields: CONTRACT_FIELDS }
  )
}

export const contractDeliveryCommands = (entities: ContractEntities) => [
  recordDelivery(entities),
  acceptDelivery(entities)
]
