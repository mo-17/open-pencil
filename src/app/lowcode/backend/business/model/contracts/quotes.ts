import type {
  BackendCommandDefinitionIR,
  BackendCommandParameterIR,
  BackendCommandValueIR
} from '@open-pencil/lowcode/backend'

import {
  businessAssert,
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
import {
  CONTRACT_MAX_TOTAL,
  CONTRACT_PARTY_FIELDS,
  QUOTE_CONTENT_FIELDS,
  QUOTE_DRAFT_FIELDS,
  QUOTE_VERSION_FIELDS,
  type ContractEntities
} from './fields'
import {
  contractAccess,
  contractCopy,
  contractMath,
  contractNonempty,
  contractRevision,
  contractVersionParameter,
  readContractVersioned
} from './steps'

function parameters(): BackendCommandParameterIR[] {
  return [
    businessUUIDParameter('partyId'),
    businessStringParameter('title', 200),
    businessStringParameter('itemTitle', 200),
    businessStringParameter('description', 2000),
    { name: 'quantity', type: 'integer', required: true, min: 1, max: 100000 },
    { name: 'unitPriceCents', type: 'integer', required: true, min: 0, max: 1000000 }
  ]
}
const total = () =>
  contractMath('multiply', businessParameter('quantity'), businessParameter('unitPriceCents'))
function partyRead(entities: ContractEntities, fromDraft = false) {
  return [
    businessRead(
      entities.parties,
      'party',
      fromDraft ? businessResult('draft', 'party_id') : businessParameter('partyId'),
      ['owner_id', ...CONTRACT_PARTY_FIELDS],
      'owner'
    ),
    businessAssert('active_party', businessResult('party', 'active'), businessLiteral(true))
  ]
}
const draftValues = (): BackendCommandValueIR[] => [
  { field: 'party_id', value: businessResult('party', 'id') },
  { field: 'party_title', value: businessResult('party', 'title') },
  { field: 'party_contact', value: businessResult('party', 'contact') },
  ...['title', 'description', 'quantity'].map((field) => ({
    field,
    value: businessParameter(field)
  })),
  { field: 'item_title', value: businessParameter('itemTitle') },
  { field: 'unit_price_cents', value: businessParameter('unitPriceCents') },
  { field: 'total_cents', value: total() }
]
function draftChecks() {
  return [
    contractNonempty('title'),
    contractNonempty('itemTitle'),
    businessAssert('bounded_total', total(), businessLiteral(CONTRACT_MAX_TOTAL), 'lte')
  ]
}
const draftState = () =>
  businessAssert('editable_draft', businessResult('draft', 'status'), businessLiteral('draft'))

export function quoteCommands(entities: ContractEntities): BackendCommandDefinitionIR[] {
  return [
    businessCommand(
      'create-quote-draft',
      'Create a one-line quotation draft',
      contractAccess(entities.parties, 'partyId'),
      parameters(),
      [
        ...partyRead(entities),
        ...draftChecks(),
        businessInsert(
          entities.drafts,
          'draft',
          [{ field: 'owner_id', value: businessResult('party', 'owner_id') }, ...draftValues()],
          QUOTE_DRAFT_FIELDS
        )
      ],
      { resultName: 'draft', fields: QUOTE_DRAFT_FIELDS }
    ),
    businessCommand(
      'update-quote-draft',
      'Edit an unconfirmed quotation draft',
      contractAccess(entities.drafts, 'draftId'),
      [businessUUIDParameter('draftId'), contractVersionParameter(), ...parameters()],
      [
        ...readContractVersioned(entities.drafts, 'draft', 'draftId', QUOTE_DRAFT_FIELDS),
        draftState(),
        ...partyRead(entities),
        ...draftChecks(),
        businessUpdate(
          entities.drafts,
          'draft',
          'updated',
          [...draftValues(), contractRevision('draft')],
          QUOTE_DRAFT_FIELDS
        )
      ],
      { resultName: 'updated', fields: QUOTE_DRAFT_FIELDS }
    ),
    businessCommand(
      'publish-quote-version',
      'Freeze a quotation version for review',
      contractAccess(entities.drafts, 'draftId'),
      [businessUUIDParameter('draftId'), contractVersionParameter()],
      [
        ...readContractVersioned(entities.drafts, 'draft', 'draftId', QUOTE_DRAFT_FIELDS),
        draftState(),
        ...partyRead(entities, true),
        businessInsert(
          entities.versions,
          'quote',
          [
            { field: 'owner_id', value: businessResult('draft', 'owner_id') },
            { field: 'draft_id', value: businessResult('draft', 'id') },
            ...contractCopy(
              'draft',
              QUOTE_CONTENT_FIELDS.filter(
                (field) => field !== 'party_title' && field !== 'party_contact'
              )
            ),
            { field: 'party_title', value: businessResult('party', 'title') },
            { field: 'party_contact', value: businessResult('party', 'contact') },
            { field: 'revision', value: contractRevision('draft', 'publication_count').value },
            { field: 'draft_version', value: contractRevision('draft').value }
          ],
          QUOTE_VERSION_FIELDS
        ),
        businessUpdate(
          entities.drafts,
          'draft',
          'updated',
          [contractRevision('draft', 'publication_count'), contractRevision('draft')],
          QUOTE_DRAFT_FIELDS
        )
      ],
      { resultName: 'quote', fields: QUOTE_VERSION_FIELDS }
    )
  ]
}
