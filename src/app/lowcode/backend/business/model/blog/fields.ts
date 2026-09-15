import type { PublishingProfile } from '../publishing/types'

export const BLOG_ROLES = ['blog-author'] as const
export const BLOG_PROFILE: PublishingProfile = {
  prefix: 'blog',
  authorRole: 'blog-author',
  publisherRole: 'blog-author',
  roles: BLOG_ROLES,
  automotive: false
}
