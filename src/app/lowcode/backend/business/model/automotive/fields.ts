import type { PublishingProfile } from '../publishing/types'

export const AUTOMOTIVE_ROLES = ['auto-editor', 'auto-publisher'] as const
export const AUTOMOTIVE_PROFILE: PublishingProfile = {
  prefix: 'auto',
  authorRole: 'auto-editor',
  publisherRole: 'auto-publisher',
  roles: AUTOMOTIVE_ROLES,
  automotive: true
}
