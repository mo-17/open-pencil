import type { BackendCommandDefinitionIR } from '@open-pencil/lowcode/backend'

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
  CONTRACT_FIELDS,
  QUOTE_CONTENT_FIELDS,
  QUOTE_DRAFT_FIELDS,
  QUOTE_VERSION_FIELDS,
  type ContractEntities
} from './fields'
import {
  contractAccess,
  contractCopy,
  contractHistory,
  contractNonempty,
  contractRevision,
  contractVersionParameter,
  readContractVersioned
} from './steps'

export const contractEvidenceParameters = () => [
  businessStringParameter('reference', 200),
  businessStringParameter('note', 500)
]

export function confirmQuoteContract(entities: ContractEntities): BackendCommandDefinitionIR {
  return businessCommand(
    'confirm-quote-contract',
    'Internally record external quotation confirmation',
    contractAccess(entities.drafts, 'draftId'),
    [
      businessUUIDParameter('draftId'),
      businessUUIDParameter('quoteVersionId'),
      contractVersionParameter(),
      ...contractEvidenceParameters()
    ],
    [
      ...readContractVersioned(entities.drafts, 'draft', 'draftId', QUOTE_DRAFT_FIELDS),
      businessAssert(
        'unconfirmed_draft',
        businessResult('draft', 'status'),
        businessLiteral('draft')
      ),
      businessRead(
        entities.versions,
        'quote',
        businessParameter('quoteVersionId'),
        ['owner_id', ...QUOTE_VERSION_FIELDS],
        'owner'
      ),
      businessAssert(
        'quote_matches_draft',
        businessResult('quote', 'draft_id'),
        businessResult('draft', 'id')
      ),
      businessAssert(
        'latest_quote',
        businessResult('quote', 'revision'),
        businessResult('draft', 'publication_count')
      ),
      businessAssert(
        'unchanged_published_draft',
        businessResult('quote', 'draft_version'),
        businessResult('draft', 'version')
      ),
      contractNonempty('reference'),
      businessInsert(
        entities.contracts,
        'contract',
        [
          { field: 'owner_id', value: businessResult('draft', 'owner_id') },
          { field: 'draft_id', value: businessResult('draft', 'id') },
          { field: 'quote_version_id', value: businessResult('quote', 'id') },
          ...contractCopy('quote', QUOTE_CONTENT_FIELDS),
          { field: 'quote_revision', value: businessResult('quote', 'revision') },
          { field: 'confirmation_reference', value: businessParameter('reference') },
          { field: 'confirmation_note', value: businessParameter('note') },
          { field: 'confirmed_at', value: { kind: 'server-now' } }
        ],
        CONTRACT_FIELDS
      ),
      businessUpdate(
        entities.drafts,
        'draft',
        'updated_draft',
        [{ field: 'status', value: businessLiteral('contracted') }, contractRevision('draft')],
        QUOTE_DRAFT_FIELDS
      ),
      contractHistory(entities, 'confirmation_recorded', 'active', true)
    ],
    { resultName: 'contract', fields: CONTRACT_FIELDS }
  )
}
