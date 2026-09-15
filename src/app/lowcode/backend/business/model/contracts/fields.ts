import type { DataEntityIR } from '@open-pencil/lowcode/backend'

export const CONTRACTS_ROLES = ['contract-manager'] as const
export const CONTRACT_MAX_TOTAL = 1_000_000_000
export const CONTRACT_PARTY_FIELDS = [
  'id',
  'title',
  'contact',
  'description',
  'active',
  'version',
  'created_at'
]
export const QUOTE_CONTENT_FIELDS = [
  'party_id',
  'party_title',
  'party_contact',
  'title',
  'item_title',
  'description',
  'quantity',
  'unit_price_cents',
  'total_cents',
  'currency'
]
export const QUOTE_DRAFT_FIELDS = [
  'id',
  ...QUOTE_CONTENT_FIELDS,
  'status',
  'publication_count',
  'version',
  'created_at'
]
export const QUOTE_VERSION_FIELDS = [
  'id',
  'draft_id',
  ...QUOTE_CONTENT_FIELDS,
  'revision',
  'draft_version',
  'created_at'
]
export const CONTRACT_FIELDS = [
  'id',
  'draft_id',
  'quote_version_id',
  ...QUOTE_CONTENT_FIELDS,
  'quote_revision',
  'confirmation_reference',
  'confirmation_note',
  'confirmed_at',
  'status',
  'delivered_quantity',
  'accepted_quantity',
  'next_delivery_sequence',
  'next_accept_sequence',
  'version',
  'created_at'
]
export const CONTRACT_DELIVERY_FIELDS = [
  'id',
  'contract_id',
  'title',
  'sequence',
  'quantity',
  'amount_cents',
  'reference',
  'note',
  'status',
  'submitted_by',
  'accepted_by',
  'acceptance_reference',
  'acceptance_note',
  'accepted_at',
  'version',
  'created_at'
]
export const CONTRACT_HISTORY_FIELDS = [
  'id',
  'contract_id',
  'actor_subject',
  'action',
  'note',
  'reference',
  'before_status',
  'after_status',
  'before_version',
  'after_version',
  'created_at'
]

export interface ContractEntities {
  parties: DataEntityIR
  drafts: DataEntityIR
  versions: DataEntityIR
  contracts: DataEntityIR
  deliveries: DataEntityIR
  history: DataEntityIR
}
