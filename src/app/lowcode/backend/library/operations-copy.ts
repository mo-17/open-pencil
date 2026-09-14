import { commerceOperationsCopy } from '../commerce/operations/copy'

export function operationsTemplateCopy(locale: string, multi: boolean) {
  const zh = locale.startsWith('zh')
  const c = commerceOperationsCopy(locale)
  const names = zh
    ? ['单商户电商 · 购物车与履约', '多商户电商 · 购物车与履约']
    : ['Single-merchant commerce', 'Multi-merchant commerce']
  const modes = zh
    ? ['全应用唯一店铺', '多店铺、服务端拆单']
    : ['One store in the entire application', 'Multiple stores with server-owned order splitting']
  return {
    name: names[multi ? 1 : 0],
    mode: modes[multi ? 1 : 0],
    description: zh
      ? '服务端购物车、拆单结账、模拟支付、手动物流、退款审批和结算记录。'
      : 'Saved carts, split checkout, simulated payment, manual shipping, refund review and settlement records.',
    tags: zh
      ? ['购物车', '模拟支付', '物流', '退款', '分账', 'NestJS']
      : ['Cart', 'Simulated payment', 'Shipping', 'Refunds', 'Settlement', 'NestJS'],
    roles: zh
      ? [
          '买家：购物车、采购单、收货与未发货整单退款',
          'merchant：拥有一家店铺、管理商品、发货和查看结算',
          'commerce-operator：审批退款、记录已核对的结算凭证'
        ]
      : [
          'Buyer: cart, purchases, delivery and whole-order refunds before shipment',
          'merchant: own one store, manage products, ship and inspect settlements',
          'commerce-operator: review refunds and record verified settlement references'
        ],
    features: [c.cartHint, c.checkoutHint, c.deliveryHint, c.settlementHint],
    requirements: zh
      ? [
          '启用 NestJS，配置 PostgreSQL 与 OIDC；使用无后端或登录声明的新文档。',
          '身份服务分别授予 merchant 和 commerce-operator；安装不创建账号、店铺或角色。',
          multi ? c.storeHint : c.storeHint + ' ' + c.singleHint,
          c.paymentHint,
          c.settlementHint,
          '佣金可按整数基点设置，默认 0；收货后默认等待 7 天才可记录结算。',
          '主动退款限已付款、未发货的整份店铺订单；未接入真实收款、快递查询或银行转账。',
          '此为独立扩展版，不自动升级旧模板或迁移已有数据库。'
        ]
      : [
          'Enable NestJS, configure PostgreSQL and OIDC, and use a fresh document without Backend or login declarations.',
          'Grant merchant and commerce-operator separately in the identity service; installation creates no accounts, stores or roles.',
          multi ? c.storeHint : c.storeHint + ' ' + c.singleHint,
          c.paymentHint,
          c.settlementHint,
          'Commission uses integer basis points, default 0; settlement becomes eligible 7 days after delivery by default.',
          'Voluntary refunds cover an entire paid store order before shipment. No live payment, carrier tracking or bank transfer integration.',
          'This separate edition never upgrades existing starters or migrates an existing database automatically.'
        ],
    pages: (
      [
        'shop',
        'cart',
        'checkout',
        'purchases',
        'orders',
        'merchantOrders',
        'settlements',
        'operator',
        'stores',
        'myStore',
        'login',
        'admin'
      ] as const
    ).map((key) => c[key])
  }
}
