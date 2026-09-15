import {
  businessText as t,
  type BusinessPageDefinition
} from '@/app/lowcode/backend/business/types'

import { formAction, selectedParameter } from '../shared'
import {
  foodHistoryColumns,
  foodLineColumns,
  foodNote,
  foodOrderColumns,
  foodOrderDetails,
  foodOrderStatuses
} from './fields'

function related(kitchen: boolean) {
  return [
    {
      resourceId: kitchen ? 'food-kitchen-items' : 'food-order-items',
      foreignKey: 'order_id',
      title: t('Order dishes', '订单菜品'),
      columns: foodLineColumns
    },
    {
      resourceId: kitchen ? 'food-kitchen-history' : 'food-order-history',
      foreignKey: 'order_id',
      title: t('Order history', '订单处理记录'),
      columns: foodHistoryColumns
    }
  ]
}

export function foodOrdersPage(): BusinessPageDefinition {
  return {
    id: 'food-orders',
    path: '/food-orders',
    title: t('My food orders', '我的点餐订单'),
    description: t(
      'Read only your own orders and confirmed dish details. Use Refresh list to check the latest status. You can cancel only before the restaurant accepts an order; later changes must be handled by the restaurant.',
      '查看本人的订单和已确认菜品明细，点击刷新列表查看最新进度。仅在餐厅接单前可自行取消，之后的变更请联系餐厅处理。'
    ),
    listing: {
      resourceId: 'food-orders',
      columns: foodOrderColumns,
      filter: { field: 'status', choices: foodOrderStatuses }
    },
    details: foodOrderDetails,
    related: related(false),
    actions: [
      formAction({
        id: 'food.order.cancel',
        en: 'Cancel my pending order',
        zh: '取消本人待接订单',
        inputs: [foodNote()],
        parameters: { orderId: selectedParameter() },
        when: { field: 'status', values: ['pending'] },
        description: t(
          'Cancel this order only while it awaits restaurant acceptance. The server checks ownership and status; this action does not issue a payment refund.',
          '仅在餐厅尚未接单时取消本人的订单。服务器会检查归属与状态，此操作不执行资金退款。'
        )
      })
    ]
  }
}

export function foodKitchenPage(): BusinessPageDefinition {
  const parameters = { orderId: selectedParameter() }
  const transitions = [
    ['accept', 'Accept order', '接单', 'pending'],
    ['prepare', 'Start preparation', '开始制作', 'accepted'],
    ['ready', 'Mark ready', '标记已出餐', 'preparing'],
    ['complete', 'Complete order', '完成订单', 'ready']
  ] as const
  return {
    id: 'food-kitchen',
    path: '/kitchen',
    title: t('Kitchen orders', '厨房订单'),
    description: t(
      'Requires food-manager. Click Refresh list to fetch new orders and current status; this page is not a realtime feed. Review dishes and dining details, accept the order, record preparation and mark it ready or completed. No printer or notification service is connected.',
      '需要 food-manager 角色。点击刷新列表获取新订单与最新状态，本页不提供实时推送。核对菜品和用餐信息后依次接单、制作、出餐并完成；未连接打印机或通知服务。'
    ),
    listing: {
      resourceId: 'food-kitchen-orders',
      columns: foodOrderColumns,
      filter: { field: 'status', choices: foodOrderStatuses }
    },
    details: foodOrderDetails,
    related: related(true),
    actions: [
      ...transitions.map(([operation, en, zh, status]) =>
        formAction({
          id: 'food.order.' + operation,
          en,
          zh,
          inputs: [foodNote()],
          parameters,
          when: { field: 'status', values: [status] },
          description: t(
            'Record the actual handling step after checking the selected order. The server rejects a stale or invalid state transition; this action does not operate kitchen equipment.',
            '核对选中订单后登记实际处理步骤。服务器会拒绝过期或不允许的状态变更，此操作不会控制厨房设备。'
          )
        })
      ),
      formAction({
        id: 'food.order.reject',
        en: 'Cancel as restaurant',
        zh: '餐厅取消订单',
        inputs: [foodNote()],
        parameters,
        when: { field: 'status', values: ['pending', 'accepted', 'preparing', 'ready'] },
        description: t(
          'Record a restaurant cancellation before completion and explain it to the customer separately. No refund, message or stock adjustment is performed.',
          '在订单完成前登记餐厅取消，并另行向顾客解释原因。此操作不退款、不发消息，也不调整库存数量。'
        )
      })
    ]
  }
}
