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
import { hrEmployeeKeys, hrEmployeeRead } from './employees'
import { HR_CHECKLIST_FIELDS, HR_EMPLOYEE_FIELDS, type RecruitmentEntities } from './fields'
import {
  hrHistory,
  hrIncrement,
  hrPositionAccess,
  hrReadChild,
  hrRequired,
  hrVersion,
  hrVersionParameter,
  hrWorkingPhase
} from './steps'

export function recruitmentChecklistCommands(entities: RecruitmentEntities) {
  return [
    businessCommand(
      'add-hr-checklist-item',
      'Add a required item to the current onboarding or offboarding phase',
      hrPositionAccess(entities),
      [
        ...hrEmployeeKeys(),
        businessStringParameter('title', 200),
        businessStringParameter('description', 1000),
        businessStringParameter('note', 500)
      ],
      [
        ...hrEmployeeRead(entities),
        hrVersion('employee'),
        ...hrWorkingPhase(),
        hrRequired('title'),
        businessAssert(
          'bounded_checklist',
          businessResult('employee', 'checklist_total'),
          businessLiteral(99),
          'lte'
        ),
        businessInsert(
          entities.checklist,
          'item',
          [
            { field: 'owner_id', value: businessResult('position', 'owner_id') },
            { field: 'position_id', value: businessResult('position', 'id') },
            { field: 'employee_id', value: businessResult('employee', 'id') },
            { field: 'phase', value: businessResult('employee', 'status') },
            { field: 'title', value: businessParameter('title') },
            { field: 'description', value: businessParameter('description') }
          ],
          HR_CHECKLIST_FIELDS
        ),
        businessUpdate(
          entities.employees,
          'employee',
          'updated',
          [hrIncrement('employee', 'checklist_total'), hrIncrement('employee')],
          HR_EMPLOYEE_FIELDS
        ),
        hrHistory(entities, 'employee', 'employee', 'add-checklist-item', false, 'item')
      ],
      { resultName: 'updated', fields: HR_EMPLOYEE_FIELDS }
    ),
    businessCommand(
      'complete-hr-checklist-item',
      'Record manual completion once without performing external work',
      hrPositionAccess(entities),
      [
        businessUUIDParameter('positionId'),
        businessUUIDParameter('employeeId'),
        businessUUIDParameter('itemId'),
        hrVersionParameter(),
        businessStringParameter('note', 500)
      ],
      [
        ...hrEmployeeRead(entities),
        ...hrWorkingPhase(),
        ...hrReadChild(entities.checklist, 'item', HR_CHECKLIST_FIELDS),
        hrVersion('item'),
        businessAssert(
          'same_employee',
          businessResult('item', 'employee_id'),
          businessResult('employee', 'id')
        ),
        businessAssert(
          'current_phase',
          businessResult('item', 'phase'),
          businessResult('employee', 'status')
        ),
        businessAssert(
          'not_completed',
          businessResult('item', 'completed'),
          businessLiteral(false)
        ),
        hrRequired('note'),
        businessUpdate(
          entities.checklist,
          'item',
          'completed_item',
          [
            { field: 'completed', value: businessLiteral(true) },
            { field: 'completed_by', value: businessCaller() },
            { field: 'completed_at', value: { kind: 'server-now' } },
            hrIncrement('item')
          ],
          HR_CHECKLIST_FIELDS
        ),
        businessUpdate(
          entities.employees,
          'employee',
          'updated_employee',
          [hrIncrement('employee', 'checklist_completed'), hrIncrement('employee')],
          HR_EMPLOYEE_FIELDS
        ),
        hrHistory(entities, 'employee', 'employee', 'complete-checklist-item', false, 'item')
      ],
      { resultName: 'completed_item', fields: HR_CHECKLIST_FIELDS }
    )
  ]
}
