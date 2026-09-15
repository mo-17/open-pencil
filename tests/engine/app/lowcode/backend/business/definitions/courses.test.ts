import { expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'

import { onlineCoursesDefinition } from '@/app/lowcode/backend/business/definitions/courses'
import { createCoursesApplication } from '@/app/lowcode/backend/business/model/courses/application'
import {
  prepareBusinessModulePages,
  renderBusinessModulePages
} from '@/app/lowcode/backend/business/pages/module'
import { preflightBusinessPages } from '@/app/lowcode/backend/business/pages/preflight'

import { MODULE_AUTHENTICATION } from '../installation/helpers'

test('all learning commands have exact bindings, enrollment selection and complete grade details', () => {
  const app = createCoursesApplication('course-pages', MODULE_AUTHENTICATION)
  const definition = onlineCoursesDefinition()
  expect(() => preflightBusinessPages(app, definition)).not.toThrow()
  const actions = definition.pages.flatMap((page) => page.actions)
  expect(actions.map((action) => action.commandId).sort()).toEqual(
    app.commands?.commands.map((command) => command.id).sort()
  )
  const submit = actions.find((action) => action.id === 'submit-course-lesson')
  expect(submit?.inputs[0].relation?.filters).toEqual({
    course_id: { kind: 'selection', field: 'course_id' },
    active: { kind: 'literal', value: true }
  })
  expect(
    definition.pages
      .find((page) => page.id === 'course-lessons')
      ?.details?.find((column) => column.field === 'body')?.multiline
  ).toBe(true)
})

for (const locale of ['en', 'zh-CN'])
  test(`renders editable ${locale} course pages with learning and grading routes`, () => {
    const editor = createEditor()
    const app = createCoursesApplication('course-pages', MODULE_AUTHENTICATION)
    const plan = prepareBusinessModulePages(editor, app, 'online-courses', locale)
    const result = renderBusinessModulePages(editor, plan)
    expect(result.pageIds.length).toBeGreaterThanOrEqual(8)
    expect(
      editor.graph.getPages().some((page) => page.lowcodeRoutePattern === '/courses/grading')
    ).toBe(true)
  })
