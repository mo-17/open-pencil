import type { BackendCommandParameterIR } from '@open-pencil/lowcode/backend'

import {
  businessCaller,
  businessCommand,
  businessInsert,
  businessParameter,
  businessStringParameter,
  businessUpdate,
  businessUUIDParameter
} from '../commands'
import { HR_POSITION_FIELDS, type RecruitmentEntities } from './fields'
import {
  hrHistory,
  hrIncrement,
  hrPositionAccess,
  hrReadPosition,
  hrRequired,
  hrVersion,
  hrVersionParameter
} from './steps'

export function recruitmentPositionCommands(entities: RecruitmentEntities) {
  const parameters = (): BackendCommandParameterIR[] => [
    businessStringParameter('title', 200),
    businessStringParameter('department', 100),
    businessStringParameter('description', 2000),
    { name: 'active', type: 'boolean', required: true }
  ]
  const values = () =>
    ['title', 'department', 'description', 'active'].map((field) => ({
      field,
      value: businessParameter(field)
    }))
  return [
    businessCommand(
      'create-hr-position',
      'Create my private recruitment position',
      { kind: 'role', roleId: 'recruitment-hr' },
      parameters(),
      [
        hrRequired('title'),
        hrRequired('department'),
        businessInsert(
          entities.positions,
          'position',
          [{ field: 'owner_id', value: businessCaller() }, ...values()],
          ['owner_id', ...HR_POSITION_FIELDS]
        ),
        hrHistory(entities, 'position', 'position', 'create-position', true)
      ],
      { resultName: 'position', fields: HR_POSITION_FIELDS }
    ),
    businessCommand(
      'update-hr-position',
      'Edit or close my position without deleting records',
      hrPositionAccess(entities),
      [
        businessUUIDParameter('positionId'),
        hrVersionParameter(),
        ...parameters(),
        businessStringParameter('note', 500)
      ],
      [
        hrReadPosition(entities),
        hrVersion('position'),
        hrRequired('title'),
        hrRequired('department'),
        businessUpdate(
          entities.positions,
          'position',
          'updated',
          [...values(), hrIncrement('position')],
          HR_POSITION_FIELDS
        ),
        hrHistory(entities, 'position', 'position', 'update-position')
      ],
      { resultName: 'updated', fields: HR_POSITION_FIELDS }
    )
  ]
}
