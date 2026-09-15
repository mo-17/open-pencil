import type { DataEntityIR } from '@open-pencil/lowcode/backend'

export const ASSET_ROLES = ['asset-manager'] as const
export const ASSET_STATUSES = ['available', 'in_use', 'repair', 'retired'] as const
export type AssetStatus = (typeof ASSET_STATUSES)[number]
export const ASSET_REQUEST_STATUSES = [
  'requested',
  'issued',
  'returned',
  'cancelled',
  'rejected'
] as const
export type AssetRequestStatus = (typeof ASSET_REQUEST_STATUSES)[number]
export const ASSET_FIELDS = [
  'id',
  'tag',
  'title',
  'category',
  'location',
  'description',
  'status',
  'version',
  'created_at'
] as const
export const ASSET_MANAGEMENT_FIELDS = [
  ...ASSET_FIELDS,
  'registered_by',
  'custodian_subject',
  'current_request_id'
] as const
export const ASSET_REQUEST_FIELDS = [
  'id',
  'asset_id',
  'asset_tag',
  'asset_title',
  'borrower_name',
  'kind',
  'purpose',
  'due_at',
  'status',
  'issued_at',
  'returned_at',
  'fulfillment_note',
  'version',
  'created_at'
] as const
export const ASSET_HISTORY_FIELDS = [
  'id',
  'asset_id',
  'request_id',
  'actor_subject',
  'action',
  'note',
  'before_status',
  'after_status',
  'before_version',
  'after_version',
  'before_request_status',
  'after_request_status',
  'request_version',
  'created_at'
] as const
export interface AssetEntities {
  assets: DataEntityIR
  requests: DataEntityIR
  history: DataEntityIR
}
