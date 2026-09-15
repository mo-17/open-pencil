import type {
  BackendCommandAccessIR,
  BackendCommandStepIR,
  BackendCommandValueIR
} from '@open-pencil/lowcode/backend'

import {
  businessAssert,
  businessLiteral,
  businessParameter,
  businessRead,
  businessResult
} from '../commands'
import { COURSE_FIELDS, COURSE_ROLE, type CourseEntities } from './schema'

export const courseVersionParameter = () => ({
  name: 'expectedVersion',
  type: 'integer' as const,
  required: true as const,
  min: 0,
  max: 2147483646
})
export function courseRevision(record: string): BackendCommandValueIR {
  return {
    field: 'version',
    value: {
      kind: 'integer-arithmetic',
      operator: 'add',
      left: businessResult(record, 'version'),
      right: businessLiteral(1)
    }
  }
}
export const expectCourseRevision = (record: string) =>
  businessAssert(
    'current_version',
    businessResult(record, 'version'),
    businessParameter('expectedVersion')
  )
export function courseOwnerAccess(entities: CourseEntities): BackendCommandAccessIR {
  return {
    kind: 'row-policy',
    entityId: entities.courses.id,
    parameter: 'courseId',
    policyIds: ['own-courses'],
    roleId: COURSE_ROLE
  }
}
export function readCourse(entities: CourseEntities): BackendCommandStepIR {
  return businessRead(entities.courses, 'course', businessParameter('courseId'), [
    'owner_id',
    ...COURSE_FIELDS
  ])
}
export const expectCourseState = (state: string) =>
  businessAssert('course_state', businessResult('course', 'status'), businessLiteral(state))
