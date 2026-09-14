import { commerceCopy } from '../copy'
import type { CommerceMerchantMode } from './types'

const english = {
  singleShop: 'Single-merchant shop',
  multiShop: 'Marketplace',
  merchantOrders: 'Merchant orders',
  stores: 'Store directory',
  openStore: 'My store',
  storeTitle: 'Store name',
  createStore: 'Open my store',
  manageStore: 'Manage this store',
  visitStore: 'Visit store',
  allProducts: 'All products',
  storeHint: 'Browse independent stores. Each order belongs to one store and contains one product.',
  openStoreHint:
    'The platform must grant the merchant role in your identity service first. Each account can create one store. Your verified identity owns it.',
  existingStore: 'Find my existing store',
  createStoreHint:
    'If a previous request was interrupted, check your existing store before trying again. Opening a store does not create products.',
  storeCreated: 'Store created. Continue to product management.',
  catalogHint:
    'Requires the merchant role and access to the selected store. Open My store first to select your store. Prices use integer minor units.',
  ordersHint:
    'Review pending orders and mark completed work. This does not collect payment, create shipping labels or track delivery.',
  complete: 'Mark completed',
  chooseOrder: 'Select order',
  completed: 'Completed',
  confirmComplete: 'Mark this order completed? The buyer will no longer be able to cancel it.',
  completionSaved: 'Completion recorded',
  newCompletion: 'Start another completion',
  completionRecovery:
    'Have you verified this completion in Merchant orders? Clearing a saved attempt does not undo it.',
  noStore: 'Select your store in My store before managing products or orders.',
  singleHint:
    'The catalog-manager role manages this shop’s products and orders. Buyers see only their own orders.'
}

const chinese: typeof english = {
  singleShop: '单商户商城',
  multiShop: '多商户商城',
  merchantOrders: '商家订单',
  stores: '店铺目录',
  openStore: '我的店铺',
  storeTitle: '店铺名称',
  createStore: '创建我的店铺',
  manageStore: '管理这家店铺',
  visitStore: '进入店铺',
  allProducts: '全部商品',
  storeHint: '浏览不同商家的店铺。每笔订单归属一家店铺，包含一种商品。',
  openStoreHint:
    '请先由平台在身份服务中授予 merchant 角色。每个账号可创建一家店铺，归属由服务端验证的身份决定。',
  existingStore: '查找已有店铺',
  createStoreHint: '如果上次请求中断，请先查找已有店铺再重试。创建店铺不会自动添加商品。',
  storeCreated: '店铺已创建，可以继续管理商品。',
  catalogHint:
    '需要 merchant 角色和当前店铺的访问权限。请先到“我的店铺”选择店铺。金额使用整数最小货币单位。',
  ordersHint: '查看待处理订单并标记已完成。此操作不收款、不创建运单，也不跟踪物流。',
  complete: '标记已完成',
  chooseOrder: '选择订单',
  completed: '已完成',
  confirmComplete: '确认将这笔订单标记为已完成？完成后买家不能再取消。',
  completionSaved: '完成状态已记录',
  newCompletion: '处理另一笔订单',
  completionRecovery: '是否已在商家订单中核实本次完成操作？清除本地记录不会撤销完成状态。',
  noStore: '请先在“我的店铺”选择店铺，再管理商品或订单。',
  singleHint: 'catalog-manager 角色可管理本商城商品和订单。买家只能查看自己的订单。'
}

export function commerceMerchantCopy(locale: string, mode: CommerceMerchantMode) {
  const labels = locale.toLowerCase().startsWith('zh') ? chinese : english
  return {
    ...labels,
    base: {
      ...commerceCopy(locale),
      shop: mode === 'multi-merchant' ? labels.multiShop : labels.singleShop,
      adminHint: mode === 'multi-merchant' ? labels.catalogHint : labels.singleHint
    }
  }
}
