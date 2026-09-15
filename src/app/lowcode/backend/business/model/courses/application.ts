import type { BackendHttpAPIOIDCAuthenticationIRV1 } from '@open-pencil/lowcode/backend'

import { createBusinessBase, finishBusinessApplication } from '../base'
import { courseCatalogCommands } from './catalog'
import { courseLearningCommands } from './learning'
import { COURSE_ROLE, createCourseEntities } from './schema'

export function createCoursesApplication(
  applicationId: string,
  authentication: BackendHttpAPIOIDCAuthenticationIRV1
) {
  const application = createBusinessBase(applicationId, authentication, [
    COURSE_ROLE,
    'course-student'
  ])
  const entities = createCourseEntities(application)
  application.commands?.commands.push(
    ...courseCatalogCommands(entities),
    ...courseLearningCommands(entities)
  )
  return finishBusinessApplication(application)
}
