import { RENTAL_ROLES } from '@/app/lowcode/backend/business/model/rental/fields'
import {
  businessText as t,
  type BusinessTemplateDefinition
} from '@/app/lowcode/backend/business/types'

import { accountSetupPage } from '../shared'
import { rentalManagementPage, rentalPublicPage, rentalSlotsPage } from './properties'
import { rentalViewingsPage } from './viewings'

export function rentalViewingDefinition(): BusinessTemplateDefinition {
  return {
    id: 'rental-viewing',
    title: t('Rental homes and viewings', '租房与预约看房'),
    description: t(
      'Property publication, 360 tours, capacity-checked viewing appointments and private follow-up.',
      '房源上下架、360全景、名额校验的预约看房与私密跟进。'
    ),
    entryPage: 'rental-properties',
    roles: RENTAL_ROLES,
    pages: [
      accountSetupPage(RENTAL_ROLES),
      rentalPublicPage(),
      rentalViewingsPage(),
      rentalManagementPage(),
      rentalSlotsPage()
    ]
  }
}
