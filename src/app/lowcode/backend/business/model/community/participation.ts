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
import { COMMUNITY_FOLLOW_FIELDS, COMMUNITY_REPORT_FIELDS, type CommunityEntities } from './fields'
import { communityNonempty, communityPostAccess, communityStatus, readCommunityPost } from './steps'

export function communityFollowCommands(entities: CommunityEntities) {
  const fields = COMMUNITY_FOLLOW_FIELDS
  const read = () =>
    businessRead(entities.follows, 'follow', businessParameter('followId'), fields, 'owner')
  const update = (active: boolean) =>
    businessUpdate(
      entities.follows,
      'follow',
      'updated',
      [{ field: 'active', value: businessLiteral(active) }],
      fields
    )
  return [
    businessCommand(
      'create-community-follow',
      'Privately follow a public post once',
      communityPostAccess(entities),
      [businessUUIDParameter('postId')],
      [
        readCommunityPost(entities),
        businessInsert(
          entities.follows,
          'follow',
          [
            { field: 'owner_id', value: businessCaller() },
            { field: 'post_id', value: businessResult('post', 'id') }
          ],
          fields
        )
      ],
      { resultName: 'follow', fields }
    ),
    businessCommand(
      'cancel-community-follow',
      'Cancel my private follow',
      {
        kind: 'row-policy',
        entityId: entities.follows.id,
        parameter: 'followId',
        policyIds: ['own-community-follows']
      },
      [businessUUIDParameter('followId')],
      [read(), update(false)],
      { resultName: 'updated', fields }
    ),
    businessCommand(
      'restore-community-follow',
      'Restore my original follow after checking the public post',
      communityPostAccess(entities),
      [businessUUIDParameter('postId'), businessUUIDParameter('followId')],
      [
        readCommunityPost(entities),
        read(),
        businessAssert(
          'follow_post_matches',
          businessResult('follow', 'post_id'),
          businessResult('post', 'id')
        ),
        update(true)
      ],
      { resultName: 'updated', fields }
    )
  ]
}
export function communityReportCommands(entities: CommunityEntities) {
  const fields = COMMUNITY_REPORT_FIELDS
  return [
    businessCommand(
      'create-community-report',
      'Privately report a public post to moderators',
      communityPostAccess(entities),
      [businessUUIDParameter('postId'), businessStringParameter('reason', 2000)],
      [
        readCommunityPost(entities),
        communityNonempty('reason'),
        businessInsert(
          entities.reports,
          'report',
          [
            { field: 'owner_id', value: businessCaller() },
            { field: 'post_id', value: businessResult('post', 'id') },
            { field: 'reason', value: businessParameter('reason') }
          ],
          fields
        )
      ],
      { resultName: 'report', fields }
    ),
    businessCommand(
      'resolve-community-report',
      'Record a private report outcome without automatically altering content',
      { kind: 'role', roleId: 'community-moderator' },
      [businessUUIDParameter('reportId'), businessStringParameter('resolution', 2000)],
      [
        businessRead(entities.reports, 'report', businessParameter('reportId'), fields),
        communityStatus('report', 'open'),
        communityNonempty('resolution'),
        businessUpdate(
          entities.reports,
          'report',
          'resolved',
          [
            { field: 'status', value: businessLiteral('resolved') },
            { field: 'resolution', value: businessParameter('resolution') },
            { field: 'resolved_at', value: { kind: 'server-now' } },
            { field: 'resolved_by', value: businessCaller() }
          ],
          fields
        )
      ],
      { resultName: 'resolved', fields }
    )
  ]
}
