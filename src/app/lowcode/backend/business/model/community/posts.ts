import {
  businessAssert,
  businessCaller,
  businessCommand,
  businessInsert,
  businessLiteral,
  businessParameter,
  businessResult,
  businessStringParameter,
  businessUpdate,
  businessUUIDParameter
} from '../commands'
import {
  COMMUNITY_MODERATION_FIELDS,
  COMMUNITY_POST_FIELDS,
  type CommunityEntities
} from './fields'
import {
  communityNonempty,
  communityRevision,
  communityStatus,
  communityVersionCheck,
  communityVersionParameter,
  moderationValues,
  readCommunityPost
} from './steps'

export function communityPostCommands(entities: CommunityEntities) {
  const fields = [...COMMUNITY_POST_FIELDS, ...COMMUNITY_MODERATION_FIELDS]
  const parameters = () => [
    businessStringParameter('title', 200),
    businessStringParameter('body', 8192)
  ]
  const content = () =>
    ['title', 'body'].map((field) => ({ field, value: businessParameter(field) }))
  const statuses = { publish: 'published', reject: 'rejected', close: 'closed' }
  const moderated = (operation: 'publish' | 'reject' | 'close') =>
    businessCommand(
      `${operation}-community-post`,
      `${operation} a community post`,
      { kind: 'role', roleId: 'community-moderator' },
      [
        businessUUIDParameter('postId'),
        communityVersionParameter(),
        businessStringParameter('note', 1000)
      ],
      [
        readCommunityPost(entities),
        communityVersionCheck('post'),
        communityStatus('post', operation === 'close' ? 'published' : 'pending'),
        businessUpdate(
          entities.posts,
          'post',
          'updated',
          [...moderationValues(statuses[operation], true), communityRevision('post')],
          fields
        )
      ],
      { resultName: 'updated', fields }
    )
  return [
    businessCommand(
      'create-community-post',
      'Submit a plain-text post for moderation',
      { kind: 'authenticated' },
      parameters(),
      [
        communityNonempty('title'),
        communityNonempty('body'),
        businessInsert(
          entities.posts,
          'post',
          [{ field: 'owner_id', value: businessCaller() }, ...content()],
          fields
        )
      ],
      { resultName: 'post', fields }
    ),
    businessCommand(
      'update-community-post',
      'Edit my pending or rejected post and request review',
      {
        kind: 'row-policy',
        entityId: entities.posts.id,
        parameter: 'postId',
        policyIds: ['own-community-posts']
      },
      [businessUUIDParameter('postId'), communityVersionParameter(), ...parameters()],
      [
        readCommunityPost(entities),
        communityVersionCheck('post'),
        ...['published', 'closed'].map((status) =>
          businessAssert(
            `not_${status}`,
            businessResult('post', 'status'),
            businessLiteral(status),
            'neq'
          )
        ),
        communityNonempty('title'),
        communityNonempty('body'),
        businessUpdate(
          entities.posts,
          'post',
          'updated',
          [...content(), ...moderationValues('pending', false), communityRevision('post')],
          fields
        )
      ],
      { resultName: 'updated', fields }
    ),
    moderated('publish'),
    moderated('reject'),
    moderated('close')
  ]
}
