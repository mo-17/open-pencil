import type { BackendHttpAPIOIDCAuthenticationIRV1 } from '@open-pencil/lowcode/backend'

import { createBusinessBase, finishBusinessApplication } from '../base'
import { bookingCatalogCommands } from './catalog'
import { bookingReservationCommands } from './reservations'
import { BOOKING_ROLE, createBookingEntities } from './schema'

export function createBookingApplication(
  applicationId: string,
  authentication: BackendHttpAPIOIDCAuthenticationIRV1
) {
  const application = createBusinessBase(applicationId, authentication, [BOOKING_ROLE])
  const entities = createBookingEntities(application)
  application.commands?.commands.push(
    ...bookingCatalogCommands(entities),
    ...bookingReservationCommands(entities)
  )
  return finishBusinessApplication(application)
}
