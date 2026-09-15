import { CONTRACTS_ROLES } from '@/app/lowcode/backend/business/model/contracts/fields'
import {
  businessText as t,
  type BusinessTemplateDefinition
} from '@/app/lowcode/backend/business/types'

import { accountSetupPage } from '../shared'
import { contractDeliveriesPage, contractsPage } from './fulfillment'
import { contractPartiesPage } from './parties'
import { quoteDraftsPage, quoteVersionsPage } from './quotes'

export function quoteContractsDefinition(): BusinessTemplateDefinition {
  return {
    id: 'quote-contracts',
    title: t('Quotations and contract fulfillment', '报价与合同履约'),
    description: t(
      'Private counterparty records, single-line quotes, immutable versions and internally recorded external confirmation, followed by sequential delivery and acceptance. Electronic signatures, real collection and CRM synchronization require development after export.',
      '私人对方资料、单行报价、不可变版本及内部登记外部确认，衔接按序交付和验收。电子签名、真实回款及 CRM 同步需导出后开发。'
    ),
    entryPage: 'quote-drafts',
    roles: CONTRACTS_ROLES,
    pages: [
      accountSetupPage(CONTRACTS_ROLES),
      contractPartiesPage(),
      quoteDraftsPage(),
      quoteVersionsPage(),
      contractsPage(),
      contractDeliveriesPage()
    ]
  }
}
