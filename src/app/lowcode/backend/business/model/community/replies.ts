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
import {
  COMMUNITY_MODERATION_FIELDS,
  COMMUNITY_REPLY_FIELDS,
  type CommunityEntities
} from './fields'
import {
  communityNonempty,
  communityPostAccess,
  communityRevision,
  communityStatus,
  communityVersionCheck,
  communityVersionParameter,
  moderationValues,
  readCommunityPost
} from './steps'

/** Every reply command locks its post before its reply, including current-publication authorization. */
export function communityReplyCommands(entities: CommunityEntities) {
  const fields = [...COMMUNITY_REPLY_FIELDS, ...COMMUNITY_MODERATION_FIELDS]
  const keys = () => [
    businessUUIDParameter('postId'),
    businessUUIDParameter('replyId'),
    communityVersionParameter()
  ]
  const reply = (owner = false) =>
    businessRead(
      entities.replies,
      'reply',
      businessParameter('replyId'),
      fields,
      owner ? 'owner' : 'command'
    )
  const matches = () =>
    businessAssert(
      'reply_post_matches',
      businessResult('reply', 'post_id'),
      businessResult('post', 'id')
    )
  const moderate = (publish: boolean) =>
    businessCommand(
      `${publish ? 'publish' : 'remove'}-community-reply`,
      `${publish ? 'Publish' : 'Remove'} a moderated reply`,
      { kind: 'role', roleId: 'community-moderator' },
      [...keys(), businessStringParameter('note', 1000)],
      [
        readCommunityPost(entities),
        reply(),
        matches(),
        communityVersionCheck('reply'),
        publish
          ? communityStatus('reply', 'pending')
          : businessAssert(
              'reply_not_removed',
              businessResult('reply', 'status'),
              businessLiteral('removed'),
              'neq'
            ),
        businessUpdate(
          entities.replies,
          'reply',
          'updated',
          [
            ...moderationValues(publish ? 'published' : 'removed', true),
            communityRevision('reply')
          ],
          fields
        )
      ],
      { resultName: 'updated', fields }
    )
  return [
    businessCommand(
      'create-community-reply',
      'Submit a reply for review while discussion is open',
      communityPostAccess(entities, true),
      [businessUUIDParameter('postId'), businessStringParameter('body', 4000)],
      [
        readCommunityPost(entities),
        communityStatus('post', 'published'),
        communityNonempty('body'),
        businessInsert(
          entities.replies,
          'reply',
          [
            { field: 'owner_id', value: businessCaller() },
            { field: 'post_id', value: businessResult('post', 'id') },
            { field: 'body', value: businessParameter('body') }
          ],
          fields
        )
      ],
      { resultName: 'reply', fields }
    ),
    businessCommand(
      'update-community-reply',
      'Edit my pending or removed reply and request review in an open discussion',
      communityPostAccess(entities, true),
      [...keys(), businessStringParameter('body', 4000)],
      [
        readCommunityPost(entities),
        communityStatus('post', 'published'),
        reply(true),
        matches(),
        communityVersionCheck('reply'),
        businessAssert(
          'reply_not_published',
          businessResult('reply', 'status'),
          businessLiteral('published'),
          'neq'
        ),
        communityNonempty('body'),
        businessUpdate(
          entities.replies,
          'reply',
          'updated',
          [
            { field: 'body', value: businessParameter('body') },
            ...moderationValues('pending', false),
            communityRevision('reply')
          ],
          fields
        )
      ],
      { resultName: 'updated', fields }
    ),
    moderate(true),
    moderate(false)
  ]
}
