import {
  businessText as t,
  type BusinessPageDefinition
} from '@/app/lowcode/backend/business/types'

import { formAction, profileInput, selectedParameter } from '../shared'
import { foodAvailability, foodMenuInputs, foodQuantity } from './fields'

const columns = [
  { field: 'title', label: t('Dish', '菜品') },
  { field: 'category', label: t('Category', '分类') },
  { field: 'price', label: t('Price (minor units)', '价格（分）') }
]
const details = [
  ...columns,
  { field: 'description', label: t('Description', '菜品说明'), multiline: true },
  { field: 'image_url', label: t('Image URL', '图片地址') }
]

export function foodMenuPage(): BusinessPageDefinition {
  return {
    id: 'food-menu',
    path: '/menu',
    title: t('Order food', '点餐菜单'),
    public: true,
    description: t(
      'Browse the restaurant menu, sign in and select a dish. Saving a quantity replaces that dish’s quantity in your account cart. All amounts are integer minor currency units; availability is checked again at checkout.',
      '浏览本店菜单，登录后选择菜品。保存数量会替换本人购物车中该菜品的数量。金额以分为单位；下单时服务器重新核验菜品是否可点。'
    ),
    listing: { resourceId: 'food-menu', columns, search: true },
    details,
    actions: [
      formAction({
        id: 'food.cart.set',
        en: 'Save dish quantity',
        zh: '保存点餐数量',
        inputs: [foodQuantity()],
        parameters: { menuItemId: selectedParameter() },
        description: t(
          'Choose the total quantity you want for this dish, from 1 to 99, then review your cart. This does not place an order or collect payment.',
          '填写该菜品希望保留的总数量（1–99），再前往购物车核对。此操作尚未下单，也不会收款。'
        )
      })
    ]
  }
}

export function foodMenuManagementPage(): BusinessPageDefinition {
  return {
    id: 'food-menu-management',
    path: '/menu-management',
    title: t('Manage menu', '菜单管理'),
    description: t(
      'Requires food-manager. Create and edit the restaurant’s menu, prices and availability. Unavailable can represent sold out; this template does not track ingredient or dish inventory quantities. Images are external URLs, not uploads.',
      '需要 food-manager 角色。管理本店菜品、价格及可点餐状态；下架可用于标记售罄，本模板不维护食材或菜品库存数量。图片字段仅保存外部地址，不执行上传。'
    ),
    listing: {
      resourceId: 'food-menu-management',
      columns: [...columns, { field: 'available', label: t('Available', '可点餐') }],
      search: true,
      filter: { field: 'available', choices: foodAvailability }
    },
    details: [...details, { field: 'available', label: t('Available', '可点餐') }],
    actions: [
      formAction({
        id: 'create-food-menu-item',
        en: 'Create menu item',
        zh: '新增菜品',
        inputs: [profileInput('my-profile'), ...foodMenuInputs()],
        description: t(
          'Choose your registered profile and enter the dish details. Select whether customers can order it. Amounts are integer minor units.',
          '选择本人已登记资料并填写菜品信息，明确选择是否允许顾客点餐。价格按分填写整数。'
        )
      }),
      formAction({
        id: 'update-food-menu-item',
        en: 'Edit menu item',
        zh: '编辑菜品',
        inputs: foodMenuInputs(true),
        parameters: { menuItemId: selectedParameter() },
        description: t(
          'Edit the selected dish, including its price and availability. Existing orders retain their confirmed item details; a cart is checked again when submitted.',
          '编辑选中菜品的价格、信息及可点状态。已有订单保留确认时的明细；购物车提交时会重新核验。'
        )
      })
    ]
  }
}
