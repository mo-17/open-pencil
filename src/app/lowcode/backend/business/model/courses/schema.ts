import type { BackendApplicationSpecV1, DataEntityIR } from '@open-pencil/lowcode/backend'

import { addBusinessUsers } from '../directory'
import {
  addBusinessEntity,
  businessEnum,
  businessEnumField,
  businessField,
  linkBusinessOwner
} from '../entities'
import { businessGrant, businessOwnerGrant, businessReadResource } from '../permissions'

export const COURSE_ROLE = 'course-instructor'
export const COURSE_FIELDS = [
  'id',
  'title',
  'description',
  'status',
  'lesson_count',
  'version',
  'created_at'
]
export const LESSON_FIELDS = [
  'id',
  'course_id',
  'title',
  'body',
  'position',
  'question',
  'version',
  'created_at'
]
export const ENROLLMENT_FIELDS = [
  'id',
  'course_id',
  'title',
  'student_name',
  'active',
  'version',
  'created_at'
]
export const PROGRESS_FIELDS = [
  'id',
  'course_id',
  'enrollment_id',
  'lesson_id',
  'title',
  'student_name',
  'answer',
  'score',
  'feedback',
  'status',
  'version',
  'created_at'
]
export interface CourseEntities {
  courses: DataEntityIR
  lessons: DataEntityIR
  enrollments: DataEntityIR
  progress: DataEntityIR
}

export function createCourseEntities(application: BackendApplicationSpecV1): CourseEntities {
  addBusinessUsers(application, [])
  businessEnum(application, 'course-status', ['draft', 'published', 'closed'])
  businessEnum(application, 'course-progress-status', ['submitted', 'graded'])
  const courses = addBusinessEntity(application, 'courses', [
    businessField('title', 'string'),
    businessField('description', 'string'),
    businessEnumField('status', 'course-status', 'draft'),
    businessField('lesson_count', 'integer', 0),
    businessField('version', 'integer', 0)
  ])
  const lessons = addBusinessEntity(application, 'course_lessons', [
    businessField('course_id', 'uuid'),
    businessField('title', 'string'),
    businessField('body', 'string'),
    businessField('position', 'integer'),
    businessField('question', 'string'),
    businessField('version', 'integer', 0)
  ])
  linkBusinessOwner(lessons, 'course_id', courses)
  lessons.uniques?.push({ id: 'one-position-per-course', fields: ['course_id', 'position'] })
  const enrollments = addBusinessEntity(application, 'course_enrollments', [
    businessField('course_id', 'uuid'),
    businessField('student_subject', 'uuid'),
    businessField('student_name', 'string'),
    businessField('title', 'string'),
    businessField('active', 'boolean', true),
    businessField('version', 'integer', 0)
  ])
  enrollments.uniques?.push({
    id: 'one-enrollment-per-student',
    fields: ['course_id', 'student_subject']
  })
  const progress = addBusinessEntity(application, 'course_progress', [
    businessField('course_id', 'uuid'),
    businessField('enrollment_id', 'uuid'),
    businessField('lesson_id', 'uuid'),
    businessField('student_subject', 'uuid'),
    businessField('student_name', 'string'),
    businessField('title', 'string'),
    businessField('answer', 'string'),
    businessField('score', 'integer', null, true),
    businessField('feedback', 'string', ''),
    businessEnumField('status', 'course-progress-status', 'submitted'),
    businessField('version', 'integer', 0)
  ])
  linkBusinessOwner(progress, 'enrollment_id', enrollments)
  for (const entity of [enrollments, progress]) linkBusinessOwner(entity, 'course_id', courses)
  linkBusinessOwner(progress, 'lesson_id', lessons)
  progress.uniques?.push({
    id: 'one-submission-per-lesson',
    fields: ['enrollment_id', 'lesson_id']
  })
  const entities = { courses, lessons, enrollments, progress }
  for (const entity of Object.values(entities)) businessOwnerGrant(application, entity)
  for (const entity of [enrollments, progress])
    businessGrant(application, entity, `teacher-${entity.name.replaceAll('_', '-')}`, {
      kind: 'related-member',
      entityFieldId: 'course_id',
      membershipEntityId: courses.id,
      membershipFieldId: 'id',
      identityFieldId: 'owner_id',
      roleId: COURSE_ROLE
    })
  for (const entity of [courses, lessons])
    businessGrant(
      application,
      entity,
      entity === courses ? 'enrolled-courses' : 'enrolled-course-lessons',
      {
        kind: 'related-member',
        entityFieldId: entity === courses ? 'id' : 'course_id',
        membershipEntityId: enrollments.id,
        membershipFieldId: 'course_id',
        identityFieldId: 'student_subject',
        conditions: [{ fieldId: 'active', value: true }]
      }
    )
  for (const entity of [enrollments, progress])
    businessGrant(application, entity, `student-${entity.name.replaceAll('_', '-')}`, {
      kind: 'related-member',
      entityFieldId: entity === enrollments ? 'id' : 'enrollment_id',
      membershipEntityId: enrollments.id,
      membershipFieldId: 'id',
      identityFieldId: 'student_subject'
    })
  application.auth.rowAccess.push({
    id: 'published-courses',
    entityId: courses.id,
    effect: 'allow',
    operations: ['select'],
    principal: { kind: 'anonymous' },
    conditions: [{ fieldId: 'status', value: 'published' }]
  })
  for (const [entity, id, fields, policies, filters] of [
    [courses, 'courses', COURSE_FIELDS, ['published-courses'], ['id']],
    [courses, 'course-management', COURSE_FIELDS, ['own-courses'], ['status']],
    [
      lessons,
      'course-lessons',
      LESSON_FIELDS,
      ['own-course-lessons', 'enrolled-course-lessons'],
      ['course_id']
    ],
    [
      enrollments,
      'course-enrollments',
      ENROLLMENT_FIELDS,
      ['student-course-enrollments'],
      ['course_id', 'active']
    ],
    [
      enrollments,
      'course-students',
      ENROLLMENT_FIELDS,
      ['teacher-course-enrollments'],
      ['course_id', 'active']
    ],
    [
      progress,
      'course-progress',
      PROGRESS_FIELDS,
      ['student-course-progress'],
      ['course_id', 'enrollment_id', 'lesson_id', 'status']
    ],
    [
      progress,
      'course-submissions',
      PROGRESS_FIELDS,
      ['teacher-course-progress'],
      ['course_id', 'lesson_id', 'status']
    ]
  ] as const) {
    const resource = businessReadResource(application, entity, id, fields, policies)
    resource.query = {
      filterFields: [...filters],
      searchFields: ['title'],
      sortFields: ['created_at']
    }
  }
  return entities
}
