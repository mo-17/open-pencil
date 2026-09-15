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
import { COURSE_FIELDS, COURSE_ROLE, LESSON_FIELDS, type CourseEntities } from './schema'
import {
  courseOwnerAccess,
  courseRevision,
  courseVersionParameter,
  expectCourseRevision,
  expectCourseState,
  readCourse
} from './steps'

export function courseCatalogCommands(entities: CourseEntities): BackendCommandDefinitionIR[] {
  const textParameters = () => [
    businessStringParameter('title', 200),
    businessStringParameter('description', 2000)
  ]
  const textValues = () =>
    ['title', 'description'].map((field) => ({ field, value: businessParameter(field) }))
  const commands = [
    businessCommand(
      'create-course',
      'Create a course draft',
      { kind: 'role', roleId: COURSE_ROLE },
      textParameters(),
      [
        businessInsert(
          entities.courses,
          'course',
          [{ field: 'owner_id', value: businessCaller() }, ...textValues()],
          COURSE_FIELDS
        )
      ],
      { resultName: 'course', fields: COURSE_FIELDS }
    ),
    businessCommand(
      'update-course',
      'Edit my course draft',
      courseOwnerAccess(entities),
      [businessUUIDParameter('courseId'), courseVersionParameter(), ...textParameters()],
      [
        readCourse(entities),
        expectCourseRevision('course'),
        expectCourseState('draft'),
        businessUpdate(
          entities.courses,
          'course',
          'updated',
          [...textValues(), courseRevision('course')],
          COURSE_FIELDS
        )
      ],
      { resultName: 'updated', fields: COURSE_FIELDS }
    )
  ]
  for (const [id, before, after] of [
    ['publish-course', 'draft', 'published'],
    ['close-course', 'published', 'closed']
  ] as const)
    commands.push(
      businessCommand(
        id,
        id,
        courseOwnerAccess(entities),
        [businessUUIDParameter('courseId'), courseVersionParameter()],
        [
          readCourse(entities),
          expectCourseRevision('course'),
          expectCourseState(before),
          ...(after === 'published'
            ? [
                businessAssert(
                  'course_has_lessons',
                  businessResult('course', 'lesson_count'),
                  businessLiteral(1),
                  'gte'
                ),
                businessAssert(
                  'course_has_title',
                  businessResult('course', 'title'),
                  businessLiteral(''),
                  'neq'
                )
              ]
            : []),
          businessUpdate(
            entities.courses,
            'course',
            'updated',
            [{ field: 'status', value: businessLiteral(after) }, courseRevision('course')],
            COURSE_FIELDS
          )
        ],
        { resultName: 'updated', fields: COURSE_FIELDS }
      )
    )
  for (const edit of [false, true]) {
    const values = ['title', 'body', 'question', 'position'].map((field) => ({
      field,
      value: businessParameter(field)
    }))
    commands.push(
      businessCommand(
        edit ? 'update-course-lesson' : 'create-course-lesson',
        edit ? 'Edit a draft lesson' : 'Add a draft lesson',
        courseOwnerAccess(entities),
        [
          businessUUIDParameter('courseId'),
          ...(edit ? [businessUUIDParameter('lessonId'), courseVersionParameter()] : []),
          businessStringParameter('title', 200),
          businessStringParameter('body', 8192),
          businessStringParameter('question', 2000),
          { name: 'position', type: 'integer', required: true, min: 1, max: 1000 }
        ],
        [
          readCourse(entities),
          expectCourseState('draft'),
          businessAssert(
            'lesson_has_title',
            businessParameter('title'),
            businessLiteral(''),
            'neq'
          ),
          ...(edit
            ? [
                businessRead(
                  entities.lessons,
                  'lesson',
                  businessParameter('lessonId'),
                  LESSON_FIELDS
                ),
                businessAssert(
                  'lesson_course',
                  businessResult('lesson', 'course_id'),
                  businessResult('course', 'id')
                ),
                expectCourseRevision('lesson'),
                businessUpdate(
                  entities.lessons,
                  'lesson',
                  'updated',
                  [...values, courseRevision('lesson')],
                  LESSON_FIELDS
                )
              ]
            : [
                businessAssert(
                  'lesson_count_bounded',
                  businessResult('course', 'lesson_count'),
                  businessLiteral(999),
                  'lte'
                ),
                businessInsert(
                  entities.lessons,
                  'updated',
                  [
                    { field: 'owner_id', value: businessResult('course', 'owner_id') },
                    { field: 'course_id', value: businessResult('course', 'id') },
                    ...values
                  ],
                  LESSON_FIELDS
                ),
                businessUpdate(
                  entities.courses,
                  'course',
                  'counted',
                  [
                    {
                      field: 'lesson_count',
                      value: {
                        kind: 'integer-arithmetic',
                        operator: 'add',
                        left: businessResult('course', 'lesson_count'),
                        right: businessLiteral(1)
                      }
                    },
                    courseRevision('course')
                  ],
                  COURSE_FIELDS
                )
              ])
        ],
        { resultName: 'updated', fields: LESSON_FIELDS }
      )
    )
  }
  return commands
}
