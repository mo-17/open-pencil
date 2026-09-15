import { ASSET_ROLES } from '@/app/lowcode/backend/business/model/assets/fields'
import {
  businessText as t,
  type BusinessTemplateDefinition
} from '@/app/lowcode/backend/business/types'

import { accountSetupPage } from '../shared'
import { assetAuditPage, assetManagementPage } from './management'
import { assetCatalogPage, assetRequestsPage } from './requests'

export function assetManagementDefinition(): BusinessTemplateDefinition {
  return {
    id: 'asset-management',
    title: t('Asset management', '资产管理'),
    description: t(
      'Manage individual tagged assets, personal requests, administrative handovers, returns, repair and retirement with an immutable audit trail.',
      '管理逐台带标签资产、本人申请、管理员交付、归还、维修与报废，并保留审计记录。'
    ),
    entryPage: 'assets',
    roles: ASSET_ROLES,
    pages: [
      accountSetupPage(ASSET_ROLES),
      assetCatalogPage(),
      assetRequestsPage(),
      assetManagementPage(),
      assetRequestsPage(true),
      assetAuditPage()
    ]
  }
}
