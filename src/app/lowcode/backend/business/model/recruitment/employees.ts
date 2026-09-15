import {
  businessAssert,
  businessCommand,
  businessInsert,
  businessLiteral,
  businessResult,
  businessStringParameter,
  businessUpdate,
  businessUUIDParameter
} from '../commands'
import { hrCandidateKeys, hrCandidateRead } from './candidates'
import { HR_CANDIDATE_FIELDS, HR_EMPLOYEE_FIELDS, type RecruitmentEntities } from './fields'
import {
  hrCandidateReferences,
  hrHistory,
  hrIncrement,
  hrOpenPosition,
  hrPositionAccess,
  hrReadEmployee,
  hrReadPosition,
  hrRequired,
  hrState,
  hrVersion,
  hrVersionParameter
} from './steps'

export const hrEmployeeKeys = () => [
  businessUUIDParameter('positionId'),
  businessUUIDParameter('employeeId'),
  hrVersionParameter()
]
export const hrEmployeeRead = (entities: RecruitmentEntities) => [
  hrReadPosition(entities),
  ...hrReadEmployee(entities)
]

export function recruitmentEmployeeCommands(entities: RecruitmentEntities) {
  return [
    businessCommand(
      'start-hr-onboarding',
      'Convert one offered candidate into one employee record',
      hrPositionAccess(entities),
      [...hrCandidateKeys(), businessStringParameter('note', 500)],
      [
        ...hrCandidateRead(entities),
        hrOpenPosition(),
        hrState('candidate', 'offered'),
        hrRequired('note'),
        businessInsert(
          entities.employees,
          'new_employee',
          [
            ...hrCandidateReferences(),
            { field: 'title', value: businessResult('candidate', 'title') },
            { field: 'contact', value: businessResult('candidate', 'contact') },
            { field: 'position_title', value: businessResult('position', 'title') }
          ],
          HR_EMPLOYEE_FIELDS
        ),
        businessUpdate(
          entities.candidates,
          'candidate',
          'updated_candidate',
          [{ field: 'status', value: businessLiteral('hired') }, hrIncrement('candidate')],
          HR_CANDIDATE_FIELDS
        ),
        hrHistory(entities, 'candidate', 'candidate', 'start-onboarding', false, 'new_employee'),
        hrHistory(entities, 'new_employee', 'employee', 'create-employee', true)
      ],
      { resultName: 'new_employee', fields: HR_EMPLOYEE_FIELDS }
    ),
    ...employeeTransitions(entities)
  ]
}

function employeeTransitions(entities: RecruitmentEntities) {
  return (
    [
      [
        'complete-hr-onboarding',
        'onboarding',
        'active',
        'Complete onboarding after every recorded checklist item'
      ],
      ['start-hr-offboarding', 'active', 'offboarding', 'Start a separate offboarding checklist'],
      [
        'complete-hr-offboarding',
        'offboarding',
        'departed',
        'Record departure after every handover checklist item'
      ]
    ] as const
  ).map(([id, before, after, name]) => {
    const starting = after === 'offboarding'
    const checks = starting
      ? []
      : [
          businessAssert(
            'nonempty_checklist',
            businessResult('employee', 'checklist_total'),
            businessLiteral(1),
            'gte'
          ),
          businessAssert(
            'all_items_completed',
            businessResult('employee', 'checklist_completed'),
            businessResult('employee', 'checklist_total')
          )
        ]
    const counters = starting
      ? ['checklist_total', 'checklist_completed'].map((field) => ({
          field,
          value: businessLiteral(0)
        }))
      : []
    return businessCommand(
      id,
      name,
      hrPositionAccess(entities),
      [...hrEmployeeKeys(), businessStringParameter('note', 500)],
      [
        ...hrEmployeeRead(entities),
        hrVersion('employee'),
        hrState('employee', before),
        hrRequired('note'),
        ...checks,
        businessUpdate(
          entities.employees,
          'employee',
          'updated',
          [
            { field: 'status', value: businessLiteral(after) },
            ...counters,
            hrIncrement('employee')
          ],
          HR_EMPLOYEE_FIELDS
        ),
        hrHistory(entities, 'employee', 'employee', id)
      ],
      { resultName: 'updated', fields: HR_EMPLOYEE_FIELDS }
    )
  })
}
