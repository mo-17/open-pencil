import { FOOD_ORDERING_ROLES } from '@/app/lowcode/backend/business/model/food-ordering/fields'
import {
  businessText as t,
  type BusinessTemplateDefinition
} from '@/app/lowcode/backend/business/types'

import { accountSetupPage } from '../shared'
import { foodCartPage, foodCheckoutPage } from './cart'
import { foodMenuManagementPage, foodMenuPage } from './menu'
import { foodKitchenPage, foodOrdersPage } from './orders'

export function foodOrderingDefinition(): BusinessTemplateDefinition {
  return {
    id: 'food-ordering',
    title: t('Restaurant ordering', '餐厅点餐'),
    description: t(
      'Single-restaurant menu, account cart, dine-in or pickup checkout and kitchen handling. Payments, printing and notifications are connected after export.',
      '单店菜单、账号购物车、堂食／自取下单及厨房处理流程。支付、打印和通知在导出后接入。'
    ),
    entryPage: 'food-menu',
    roles: FOOD_ORDERING_ROLES,
    pages: [
      accountSetupPage(FOOD_ORDERING_ROLES),
      foodMenuPage(),
      foodCartPage(),
      foodCheckoutPage(),
      foodOrdersPage(),
      foodKitchenPage(),
      foodMenuManagementPage()
    ]
  }
}
