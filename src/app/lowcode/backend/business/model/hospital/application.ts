import type { BackendHttpAPIOIDCAuthenticationIRV1 } from '@open-pencil/lowcode/backend'

import { createBusinessBase, finishBusinessApplication } from '../base'
import { hospitalAppointmentCommands } from './appointments'
import { hospitalCatalogCommands } from './catalog'
import { HOSPITAL_ROLES } from './fields'
import { hospitalPatientCommands } from './patients'
import { createHospitalEntities } from './schema'
import { hospitalSlotCommands } from './slots'

export function createHospitalApplication(
  applicationId: string,
  authentication: BackendHttpAPIOIDCAuthenticationIRV1
) {
  const application = createBusinessBase(applicationId, authentication, HOSPITAL_ROLES)
  const entities = createHospitalEntities(application)
  application.commands?.commands.push(
    ...hospitalCatalogCommands(entities),
    ...hospitalSlotCommands(entities),
    ...hospitalPatientCommands(entities),
    ...hospitalAppointmentCommands(entities)
  )
  return finishBusinessApplication(application)
}
