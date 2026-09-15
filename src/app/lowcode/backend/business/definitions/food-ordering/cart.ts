import {
  businessText as t,
  type BusinessPageDefinition
} from '@/app/lowcode/backend/business/types'

import { formAction, selectedParameter, textInput } from '../shared'
import { foodLineColumns, foodNote, foodQuantity } from './fields'

export function foodCartPage(): BusinessPageDefinition {
  return {
    id: 'food-cart',
    path: '/cart',
    title: t('My food cart', '点餐购物车'),
    description: t(
      'Review your saved dish quantities. Select a line to change its total quantity or remove it. Go to Confirm food order to review the server subtotal and submit.',
      '核对本人保存的菜品数量，选择明细后修改总数量或移除。前往确认下单页面核对服务器汇总并提交。'
    ),
    listing: {
      resourceId: 'food-cart-items',
      columns: foodLineColumns
    },
    details: [...foodLineColumns, { field: 'active', label: t('In cart', '购物车内') }],
    actions: [
      formAction({
        id: 'food.cart.set',
        en: 'Update dish quantity',
        zh: '修改菜品数量',
        inputs: [foodQuantity(true)],
        parameters: { menuItemId: selectedParameter('menu_item_id') },
        when: { field: 'active', values: [true] },
        description: t(
          'Replace the selected dish’s total cart quantity with a whole number from 1 to 99. To restore a removed dish, select it in the menu and save a quantity again.',
          '用 1–99 的整数替换该菜品在购物车内的总数量。恢复已移除菜品时，请返回菜单选择并重新保存数量。'
        )
      }),
      formAction({
        id: 'food.cart.remove',
        en: 'Remove dish',
        zh: '移除菜品',
        inputs: [],
        parameters: { itemId: selectedParameter() },
        when: { field: 'active', values: [true] },
        description: t(
          'Remove this line from your cart. This does not cancel any previously submitted order.',
          '从本人购物车移除此明细，不影响已经提交的订单。'
        )
      })
    ]
  }
}

export function foodCheckoutPage(): BusinessPageDefinition {
  const inputs = [
    textInput('contactName', 'Contact name', '联系人', 100),
    { ...textInput('phone', 'Phone (optional)', '电话（可选）', 64), required: false },
    foodNote()
  ]
  const parameters = { cartRevision: selectedParameter('version') }
  return {
    id: 'food-checkout',
    path: '/checkout',
    title: t('Confirm food order', '确认下单'),
    description: t(
      'Select the cart summary and review its dishes and subtotal before submitting. The server verifies the cart revision, prices and availability atomically. If a price changes, save that dish’s quantity again to accept its current price, then refresh and review the cart. No payment is collected.',
      '选中购物车汇总并核对菜品、金额后提交。服务器在事务中核验购物车版本、价格及可点状态。价格变化时，须重新保存该菜品数量以接受现价，再刷新核对购物车。本流程不收款。'
    ),
    listing: {
      resourceId: 'food-carts',
      columns: [
        { field: 'subtotal', label: t('Subtotal (minor units)', '合计（分）') },
        { field: 'item_count', label: t('Dish lines', '菜品种数') },
        { field: 'version', label: t('Cart revision', '购物车版本') }
      ]
    },
    related: [
      {
        resourceId: 'food-cart-items',
        foreignKey: 'cart_id',
        title: t('Cart lines', '购物车明细'),
        columns: [
          ...foodLineColumns,
          { field: 'active', label: t('Included in cart', '计入购物车') }
        ]
      }
    ],
    actions: [
      formAction({
        id: 'food.checkout.dine-in',
        en: 'Submit dine-in order',
        zh: '提交堂食订单',
        inputs: [textInput('tableNumber', 'Table number', '桌号', 32), ...inputs],
        parameters,
        description: t(
          'Enter the restaurant’s table number and your contact name. Confirm the selected cart before submitting; table identity and payment are not verified by this template.',
          '填写店内桌号与联系人，核对选中的购物车后提交。本模板不验证桌号身份，也不处理付款。'
        )
      }),
      formAction({
        id: 'food.checkout.pickup',
        en: 'Submit pickup order',
        zh: '提交自取订单',
        inputs,
        parameters,
        description: t(
          'Enter the contact name for collection and optional phone and note. This is restaurant pickup, without delivery dispatch or automatic pickup messages.',
          '填写取餐联系人，可补充电话和备注。本流程为到店自取，不派送，也不会自动发送取餐通知。'
        )
      })
    ]
  }
}
