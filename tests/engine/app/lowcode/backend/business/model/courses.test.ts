import { expect, test } from 'bun:test'

import { parseBackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import { createCoursesApplication } from '@/app/lowcode/backend/business/model/courses/application'

import { modelFiles } from '#tests/engine/compiler/backend/nestjs/model-capabilities/helpers'

import { MODULE_AUTHENTICATION } from '../installation/helpers'

const application = () => createCoursesApplication('courses-test', MODULE_AUTHENTICATION)

test('course export preserves enrollment authority, private submissions and SQL uniqueness', () => {
  const app = application()
  expect(parseBackendApplicationSpecV1(app).diagnostics).toEqual([])
  expect(app.commands?.commands).toHaveLength(11)
  expect(app.dataModel.entities).toHaveLength(5)
  const resources = app.httpApi?.resources ?? []
  for (const resource of resources) {
    expect(resource.operations).toEqual(['list', 'read'])
    expect(resource.readFields).not.toContain('owner_id')
    expect(resource.readFields).not.toContain('student_subject')
  }
  expect(
    app.auth.rowAccess.find((policy) => policy.id === 'enrolled-course-lessons')
  ).toMatchObject({
    principal: {
      kind: 'related-member',
      identityFieldId: 'student_subject',
      conditions: [{ fieldId: 'active', value: true }]
    }
  })
  expect(resources.find((entry) => entry.id === 'course-submissions')?.readPolicyIds).toEqual([
    'teacher-course-progress'
  ])
  expect(resources.find((entry) => entry.id === 'course-progress')?.readPolicyIds).toEqual([
    'student-course-progress'
  ])
  const sql = modelFiles(app).get('backend/nestjs/migrations/001-initial.sql')
  expect(sql).toContain('UNIQUE ("course_id", "student_subject")')
  expect(sql).toContain('UNIQUE ("enrollment_id", "lesson_id")')
  expect(sql).toContain('FOREIGN KEY ("enrollment_id", "owner_id")')
})

test('publishing freezes lessons and grading cannot replace a submitted score or grade oneself', () => {
  const app = application()
  const commands = app.commands?.commands ?? []
  for (const id of ['create-course-lesson', 'update-course-lesson', 'update-course']) {
    const command = commands.find((entry) => entry.id === id)
    expect(command?.access).toMatchObject({
      roleId: 'course-instructor',
      policyIds: ['own-courses']
    })
    expect(command?.steps).toContainEqual(
      expect.objectContaining({ id: 'course_state', right: { kind: 'literal', value: 'draft' } })
    )
  }
  const grade = commands.find((entry) => entry.id === 'grade-course-submission')
  expect(grade?.parameters).toContainEqual({
    name: 'score',
    type: 'integer',
    required: true,
    min: 0,
    max: 100
  })
  expect(grade?.steps).toContainEqual(
    expect.objectContaining({
      id: 'independent_grading',
      operator: 'neq',
      right: { kind: 'caller-sub' }
    })
  )
  expect(grade?.steps).toContainEqual(
    expect.objectContaining({ id: 'not_graded', right: { kind: 'literal', value: 'submitted' } })
  )
  expect(grade?.steps).toContainEqual(expect.objectContaining({ id: 'current_version' }))
  const submit = commands.find((entry) => entry.id === 'submit-course-lesson')
  expect(submit?.access).toMatchObject({
    entityId: 'business-courses',
    parameter: 'courseId',
    policyIds: ['enrolled-courses']
  })
  expect(
    submit?.steps.filter((step) => step.kind === 'data.read').map((step) => step.resultName)
  ).toEqual(['course', 'enrollment', 'lesson'])
  for (const id of ['own_enrollment', 'active_enrollment', 'lesson_course', 'enrollment_course'])
    expect(submit?.steps.some((step) => step.id === id)).toBe(true)
  const revoke = commands.find((entry) => entry.id === 'revoke-course-enrollment')
  expect(
    revoke?.steps.filter((step) => step.kind === 'data.read').map((step) => step.resultName)
  ).toEqual(['course', 'enrollment'])
  for (const command of commands) expect(command.idempotency.kind).toBe('required')
})
