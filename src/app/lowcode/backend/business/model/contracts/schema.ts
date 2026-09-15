import type { BackendApplicationSpecV1, DataFieldIR } from '@open-pencil/lowcode/backend'

import { addBusinessUsers } from '../directory'
import {
  addBusinessEntity,
  businessEnum,
  businessEnumField,
  businessField as field,
  linkBusinessOwner
} from '../entities'
import { businessGrant, businessOwnerGrant, businessReadResource } from '../permissions'
import {
  CONTRACT_DELIVERY_FIELDS,
  CONTRACT_FIELDS,
  CONTRACT_HISTORY_FIELDS,
  CONTRACT_PARTY_FIELDS,
  CONTRACTS_ROLES,
  QUOTE_DRAFT_FIELDS,
  QUOTE_VERSION_FIELDS,
  type ContractEntities
} from './fields'

function quoteContent(): DataFieldIR[] {
  return [
    field('party_id', 'uuid'),
    ...['party_title', 'party_contact', 'title', 'item_title', 'description'].map((name) =>
      field(name, 'string')
    ),
    ...['quantity', 'unit_price_cents', 'total_cents'].map((name) => field(name, 'integer')),
    field('currency', 'string', 'CNY')
  ]
}

export function createContractEntities(app: BackendApplicationSpecV1): ContractEntities {
  addBusinessUsers(app, [])
  for (const [name, values] of Object.entries({
    'quote-draft-status': ['draft', 'contracted'],
    'contract-status': ['active', 'closed', 'cancelled'],
    'contract-delivery-status': ['submitted', 'accepted']
  }))
    businessEnum(app, name, values)
  const parties = addBusinessEntity(app, 'contract_parties', [
    ...['title', 'contact', 'description'].map((name) => field(name, 'string')),
    field('active', 'boolean', true),
    field('version', 'integer', 0)
  ])
  const drafts = addBusinessEntity(app, 'quote_drafts', [
    ...quoteContent(),
    businessEnumField('status', 'quote-draft-status', 'draft'),
    field('publication_count', 'integer', 0),
    field('version', 'integer', 0)
  ])
  const versions = addBusinessEntity(app, 'quote_versions', [
    field('draft_id', 'uuid'),
    ...quoteContent(),
    field('revision', 'integer'),
    field('draft_version', 'integer')
  ])
  const contracts = addBusinessEntity(app, 'contracts', [
    field('draft_id', 'uuid'),
    field('quote_version_id', 'uuid'),
    ...quoteContent(),
    field('quote_revision', 'integer'),
    field('confirmation_reference', 'string'),
    field('confirmation_note', 'string'),
    field('confirmed_at', 'datetime'),
    businessEnumField('status', 'contract-status', 'active'),
    ...['delivered_quantity', 'accepted_quantity', 'version'].map((name) =>
      field(name, 'integer', 0)
    ),
    field('next_delivery_sequence', 'integer', 1),
    field('next_accept_sequence', 'integer', 1)
  ])
  const deliveries = addBusinessEntity(app, 'contract_deliveries', [
    field('contract_id', 'uuid'),
    field('title', 'string'),
    ...['sequence', 'quantity', 'amount_cents'].map((name) => field(name, 'integer')),
    field('reference', 'string'),
    field('note', 'string'),
    businessEnumField('status', 'contract-delivery-status', 'submitted'),
    field('submitted_by', 'uuid'),
    field('accepted_by', 'uuid', null, true),
    field('acceptance_reference', 'string', ''),
    field('acceptance_note', 'string', ''),
    field('accepted_at', 'datetime', null, true),
    field('version', 'integer', 0)
  ])
  const history = addBusinessEntity(app, 'contract_history', [
    field('contract_id', 'uuid'),
    field('actor_subject', 'uuid'),
    ...['action', 'note', 'reference'].map((name) => field(name, 'string')),
    businessEnumField('before_status', 'contract-status', 'active'),
    businessEnumField('after_status', 'contract-status', 'active'),
    field('before_version', 'integer'),
    field('after_version', 'integer')
  ])
  for (const child of [drafts, versions, contracts]) linkBusinessOwner(child, 'party_id', parties)
  for (const child of [versions, contracts]) linkBusinessOwner(child, 'draft_id', drafts)
  linkBusinessOwner(contracts, 'quote_version_id', versions)
  for (const child of [deliveries, history]) linkBusinessOwner(child, 'contract_id', contracts)
  versions.uniques?.push({ id: 'draft-revision', fields: ['draft_id', 'revision'] })
  contracts.uniques?.push(
    { id: 'one-per-draft', fields: ['draft_id'] },
    { id: 'one-per-quote', fields: ['quote_version_id'] }
  )
  deliveries.uniques?.push({ id: 'contract-sequence', fields: ['contract_id', 'sequence'] })
  history.uniques?.push({ id: 'contract-revision', fields: ['contract_id', 'after_version'] })
  const entities = { parties, drafts, versions, contracts, deliveries, history }
  const resources = [
    ['parties', 'contract-parties', CONTRACT_PARTY_FIELDS, ['active'], ['title', 'contact']],
    [
      'drafts',
      'quote-drafts',
      QUOTE_DRAFT_FIELDS,
      ['party_id', 'status'],
      ['title', 'item_title', 'party_title']
    ],
    [
      'versions',
      'quote-versions',
      QUOTE_VERSION_FIELDS,
      ['draft_id', 'party_id'],
      ['title', 'item_title', 'party_title']
    ],
    [
      'contracts',
      'contracts',
      CONTRACT_FIELDS,
      ['party_id', 'status'],
      ['title', 'item_title', 'party_title']
    ],
    [
      'deliveries',
      'contract-deliveries',
      CONTRACT_DELIVERY_FIELDS,
      ['contract_id', 'status', 'sequence'],
      ['title', 'reference']
    ],
    ['history', 'contract-history', CONTRACT_HISTORY_FIELDS, ['contract_id', 'action'], []]
  ] as const
  for (const [key, id, fields, filters, search] of resources) {
    const entity = entities[key]
    // Commands name the owner grant explicitly; HTTP reads also require the current role.
    businessOwnerGrant(app, entity)
    const reader = businessGrant(app, entity, `contract-reader-${id}`, {
      kind: 'related-member',
      entityFieldId: 'id',
      membershipEntityId: entity.id,
      membershipFieldId: 'id',
      identityFieldId: 'owner_id',
      roleId: CONTRACTS_ROLES[0]
    })
    businessReadResource(app, entity, id, fields, [reader]).query = {
      filterFields: [...filters],
      searchFields: [...search],
      sortFields: ['created_at']
    }
  }
  return entities
}
