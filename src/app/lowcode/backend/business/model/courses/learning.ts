import type { BackendCommandDefinitionIR } from '@open-pencil/lowcode/backend'

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
  businessUUIDParameter,
  businessUpdate
} from '../commands'
import { ENROLLMENT_FIELDS, LESSON_FIELDS, PROGRESS_FIELDS, type CourseEntities } from './schema'
import {
  courseOwnerAccess,
  courseRevision,
  courseVersionParameter,
  expectCourseRevision,
  expectCourseState,
  readCourse
} from './steps'

export function courseLearningCommands(entities: CourseEntities): BackendCommandDefinitionIR[] {
  return [
    businessCommand(
      'enroll-course',
      'Enroll in a published course',
      { kind: 'role', roleId: 'course-student' },
      [businessUUIDParameter('courseId'), businessStringParameter('studentName', 100)],
      [
        readCourse(entities),
        expectCourseState('published'),
        businessAssert(
          'student_name_required',
          businessParameter('studentName'),
          businessLiteral(''),
          'neq'
        ),
        businessInsert(
          entities.enrollments,
          'enrollment',
          [
            { field: 'owner_id', value: businessResult('course', 'owner_id') },
            { field: 'student_subject', value: businessCaller() },
            { field: 'course_id', value: businessResult('course', 'id') },
            { field: 'title', value: businessResult('course', 'title') },
            { field: 'student_name', value: businessParameter('studentName') }
          ],
          ENROLLMENT_FIELDS
        )
      ],
      { resultName: 'enrollment', fields: ENROLLMENT_FIELDS }
    ),
    businessCommand(
      'revoke-course-enrollment',
      'Revoke access for a student in my course',
      courseOwnerAccess(entities),
      [
        businessUUIDParameter('courseId'),
        businessUUIDParameter('enrollmentId'),
        courseVersionParameter()
      ],
      [
        readCourse(entities),
        businessRead(
          entities.enrollments,
          'enrollment',
          businessParameter('enrollmentId'),
          ENROLLMENT_FIELDS
        ),
        businessAssert(
          'enrollment_course',
          businessResult('enrollment', 'course_id'),
          businessResult('course', 'id')
        ),
        expectCourseRevision('enrollment'),
        businessAssert(
          'active_enrollment',
          businessResult('enrollment', 'active'),
          businessLiteral(true)
        ),
        businessUpdate(
          entities.enrollments,
          'enrollment',
          'updated',
          [{ field: 'active', value: businessLiteral(false) }, courseRevision('enrollment')],
          ENROLLMENT_FIELDS
        )
      ],
      { resultName: 'updated', fields: ENROLLMENT_FIELDS }
    ),
    businessCommand(
      'submit-course-lesson',
      'Record lesson completion and submit an answer',
      {
        kind: 'row-policy',
        entityId: entities.courses.id,
        parameter: 'courseId',
        policyIds: ['enrolled-courses']
      },
      [
        businessUUIDParameter('courseId'),
        businessUUIDParameter('enrollmentId'),
        businessUUIDParameter('lessonId'),
        businessStringParameter('answer', 4000)
      ],
      [
        readCourse(entities),
        businessRead(entities.enrollments, 'enrollment', businessParameter('enrollmentId'), [
          'owner_id',
          'student_subject',
          ...ENROLLMENT_FIELDS
        ]),
        businessAssert(
          'own_enrollment',
          businessResult('enrollment', 'student_subject'),
          businessCaller()
        ),
        businessAssert(
          'enrollment_course',
          businessResult('enrollment', 'course_id'),
          businessResult('course', 'id')
        ),
        businessAssert(
          'active_enrollment',
          businessResult('enrollment', 'active'),
          businessLiteral(true)
        ),
        businessRead(entities.lessons, 'lesson', businessParameter('lessonId'), LESSON_FIELDS),
        businessAssert(
          'lesson_course',
          businessResult('lesson', 'course_id'),
          businessResult('course', 'id')
        ),
        businessAssert('nonempty_answer', businessParameter('answer'), businessLiteral(''), 'neq'),
        businessInsert(
          entities.progress,
          'submission',
          [
            { field: 'owner_id', value: businessResult('course', 'owner_id') },
            { field: 'student_subject', value: businessCaller() },
            { field: 'course_id', value: businessResult('course', 'id') },
            { field: 'enrollment_id', value: businessResult('enrollment', 'id') },
            { field: 'lesson_id', value: businessResult('lesson', 'id') },
            { field: 'title', value: businessResult('lesson', 'title') },
            { field: 'student_name', value: businessResult('enrollment', 'student_name') },
            { field: 'answer', value: businessParameter('answer') }
          ],
          PROGRESS_FIELDS
        )
      ],
      { resultName: 'submission', fields: PROGRESS_FIELDS }
    ),
    businessCommand(
      'grade-course-submission',
      'Grade a submission in my course once',
      courseOwnerAccess(entities),
      [
        businessUUIDParameter('courseId'),
        businessUUIDParameter('submissionId'),
        courseVersionParameter(),
        { name: 'score', type: 'integer', required: true, min: 0, max: 100 },
        businessStringParameter('feedback', 2000)
      ],
      [
        readCourse(entities),
        businessRead(entities.progress, 'submission', businessParameter('submissionId'), [
          'student_subject',
          ...PROGRESS_FIELDS
        ]),
        businessAssert(
          'submission_course',
          businessResult('submission', 'course_id'),
          businessResult('course', 'id')
        ),
        businessAssert(
          'independent_grading',
          businessResult('submission', 'student_subject'),
          businessCaller(),
          'neq'
        ),
        businessAssert(
          'not_graded',
          businessResult('submission', 'status'),
          businessLiteral('submitted')
        ),
        expectCourseRevision('submission'),
        businessUpdate(
          entities.progress,
          'submission',
          'updated',
          [
            { field: 'score', value: businessParameter('score') },
            { field: 'feedback', value: businessParameter('feedback') },
            { field: 'status', value: businessLiteral('graded') },
            courseRevision('submission')
          ],
          PROGRESS_FIELDS
        )
      ],
      { resultName: 'updated', fields: PROGRESS_FIELDS }
    )
  ]
}
