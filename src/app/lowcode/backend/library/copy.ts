import type { PluginBackendProviderCapabilityV1 } from '@open-pencil/plugin-contracts'

import { businessTemplateCopies } from './business-copy'
import type { BackendLibraryTemplateId } from './catalog'
import { operationsTemplateCopy } from './operations-copy'

interface EntryCopy {
  readonly name: string
  readonly description: string
  readonly tags: readonly string[]
  readonly requirements: readonly string[]
}
interface TemplateCopy extends EntryCopy {
  readonly mode: string
  readonly roles: readonly string[]
  readonly features: readonly string[]
  readonly pages: readonly string[]
}
export interface BackendLibraryCopy {
  readonly unavailableRequirement: string
  readonly genericProviderDescription: string
  readonly genericProviderRequirement: string
  readonly capabilities: Readonly<Record<PluginBackendProviderCapabilityV1, string>>
  readonly providers: Readonly<Record<'supabase' | 'nestjs', EntryCopy>>
  readonly templates: Readonly<Record<BackendLibraryTemplateId, TemplateCopy>>
}

const english: BackendLibraryCopy = {
  unavailableRequirement: 'Enable a compatible provider in plugin management to use it.',
  genericProviderDescription: 'Generate backend artifacts with this available provider.',
  genericProviderRequirement:
    'Review this provider’s configuration and generated artifacts before use.',
  capabilities: {
    'auth.identity': 'User identity',
    'auth.roles': 'Roles',
    'data.read': 'Read data',
    'data.write': 'Write data',
    'migrations.data': 'Data migrations',
    'migrations.schema': 'Schema migrations',
    'policy.row-level': 'Row access policies',
    'realtime.subscribe': 'Realtime subscriptions',
    'server.functions': 'Server functions',
    'server.http': 'HTTP API',
    'storage.objects': 'Object storage',
    'transactions.atomic': 'Atomic transactions'
  },
  providers: {
    supabase: {
      name: 'Supabase',
      description: 'Build a backend for your Supabase project from the application model.',
      tags: ['Supabase', 'PostgreSQL'],
      requirements: [
        'A Supabase project',
        'Configure its connection and apply the reviewed database schema.'
      ]
    },
    nestjs: {
      name: 'NestJS',
      description: 'Generate an editable NestJS backend for PostgreSQL.',
      tags: ['NestJS', 'PostgreSQL', 'TypeScript'],
      requirements: [
        'PostgreSQL and an OIDC identity service',
        'Node.js; Docker for managed desktop preview'
      ]
    }
  },
  templates: {
    ...businessTemplateCopies('en'),
    'single-merchant-commerce': operationsTemplateCopy('en', false),
    'multi-merchant-commerce': operationsTemplateCopy('en', true),
    'personal-notes': {
      name: 'Personal notes',
      mode: 'Private workspace',
      roles: ['Signed-in user: manage your own notes'],
      description: 'A signed-in notes application with private records and editable pages.',
      tags: ['Notes', 'CRUD', 'OIDC', 'NestJS'],
      features: [
        'Sign in and sign out',
        'Create, edit, delete and page through your notes',
        'Owner-only note access'
      ],
      requirements: [
        'The NestJS provider',
        'Configure PostgreSQL and OIDC before running.',
        'Use a document without an existing sign-in flow.'
      ],
      pages: ['Sign-in page', 'Notes page']
    },
    'single-sku-shop': {
      name: 'Single-item checkout',
      mode: 'Single-product order starter',
      roles: [
        'Buyer: place and cancel your own orders',
        'catalog-manager: manage products and stock'
      ],
      description: 'Browse products, place an order for one product and manage your orders.',
      tags: ['Shop', 'Orders', 'Inventory', 'NestJS'],
      features: [
        'Search titles, browse by ascending price and see sold-out products',
        'Review price, stock and estimated total with quantity checks',
        'Confirm orders and cancellations; view recent orders with saved product titles',
        'Manager catalog search, product creation, title/price edits and availability controls',
        'Atomic inventory updates with separate stock additions',
        'Explicit saved-request recovery for orders, cancellations and restocking'
      ],
      requirements: [
        'The NestJS provider, PostgreSQL and OIDC',
        'Use a new document without a backend declaration or sign-in flow.',
        'Existing templates need a new document or an explicit migration to adopt these changes.',
        'Grant catalog-manager in the identity service to edit products and add stock.',
        'Amounts use integer minor units; the server confirms stock and final prices.',
        'Product edits overwrite submitted fields without version comparison.',
        'Product deletion and absolute stock replacement are not included.',
        'This example does not collect payments or provide a multi-item cart.'
      ],
      pages: ['Products', 'My orders', 'Shop sign in', 'Catalog manager']
    },
    'single-merchant-shop': {
      name: 'Single-merchant shop',
      mode: 'One merchant operates the shared catalog',
      description: 'A storefront with buyer orders, product management and a merchant order view.',
      tags: ['Shop', 'Single merchant', 'Orders', 'Inventory', 'NestJS'],
      roles: [
        'Buyer: browse products and manage your own orders',
        'catalog-manager: manage the shared catalog, add stock and view shop orders'
      ],
      features: [
        'Product search, quantity checks and one-product orders',
        'Buyer order history and pending-order cancellation with inventory restoration',
        'Product management, stock additions and merchant order completion',
        'Server-enforced buyer ownership and merchant role checks'
      ],
      requirements: [
        'The NestJS provider, PostgreSQL and OIDC',
        'Use a new document without a backend declaration or sign-in flow.',
        'Grant catalog-manager in the verified JWT openpencil_roles array to the shop operator.',
        'All catalog-manager accounts operate the same catalog; this mode does not isolate stores.',
        'Configure the identity service and database separately; installation does not create accounts or grant roles.',
        'Amounts use integer minor units; the server confirms stock and final prices.',
        'No payments, multi-item cart, shipping or split settlement are included.'
      ],
      pages: [
        'Single-merchant shop',
        'My orders',
        'Shop sign in',
        'Catalog manager',
        'Merchant orders'
      ]
    },
    'multi-merchant-marketplace': {
      name: 'Multi-merchant marketplace',
      mode: 'Independent stores with one store per merchant account',
      description: 'Let approved merchants open a store and manage its products and orders.',
      tags: ['Marketplace', 'Multi merchant', 'Stores', 'Tenant isolation', 'NestJS'],
      roles: [
        'Buyer: browse stores and products and manage your own orders',
        'merchant: open one store, manage its products and view its orders',
        'Identity service operator: grant merchant access outside the generated application'
      ],
      features: [
        'Store directory, store opening and a shared storefront',
        'One-product orders, buyer order history and pending-order cancellation',
        'Store-scoped product management, stock additions and order completion',
        'Server-verified store ownership isolates merchant writes and order access'
      ],
      requirements: [
        'The NestJS provider, PostgreSQL and OIDC',
        'Use a new document without a backend declaration or sign-in flow.',
        'Grant merchant in the verified JWT openpencil_roles array before the user opens a store.',
        'One account owns one store. Membership uses stores.owner_id and stores.id; team memberships and multiple stores per account are not included.',
        'Configure the identity service and database separately; installation does not create accounts, grant roles or create stores.',
        'The store directory and product catalog are public; buyer orders remain private.',
        'Amounts use integer minor units; the server confirms stock and final prices.',
        'No payments, multi-item cart, shipping, split settlement or platform administration page are included.'
      ],
      pages: [
        'Marketplace',
        'My orders',
        'Shop sign in',
        'Catalog manager',
        'Merchant orders',
        'Store directory',
        'My store'
      ]
    }
  }
}

const chinese: BackendLibraryCopy = {
  unavailableRequirement: '请在插件管理中启用兼容的后端服务。',
  genericProviderDescription: '通过此可用服务生成后端产物。',
  genericProviderRequirement: '使用前请检查此服务的配置与生成产物。',
  capabilities: {
    'auth.identity': '用户身份',
    'auth.roles': '角色权限',
    'data.read': '读取数据',
    'data.write': '写入数据',
    'migrations.data': '数据迁移',
    'migrations.schema': '结构迁移',
    'policy.row-level': '行访问策略',
    'realtime.subscribe': '实时订阅',
    'server.functions': '服务端函数',
    'server.http': 'HTTP API',
    'storage.objects': '对象存储',
    'transactions.atomic': '原子事务'
  },
  providers: {
    supabase: {
      name: 'Supabase',
      description: '根据应用模型，为 Supabase 项目生成后端。',
      tags: ['Supabase', 'PostgreSQL'],
      requirements: ['准备 Supabase 项目', '配置项目连接并应用已检查的数据库结构。']
    },
    nestjs: {
      name: 'NestJS',
      description: '生成使用 PostgreSQL 的可编辑 NestJS 后端。',
      tags: ['NestJS', 'PostgreSQL', 'TypeScript'],
      requirements: ['准备 PostgreSQL 和 OIDC 身份服务', '安装 Node.js；桌面托管预览还需要 Docker']
    }
  },
  templates: {
    ...businessTemplateCopies('zh-CN'),
    'single-merchant-commerce': operationsTemplateCopy('zh-CN', false),
    'multi-merchant-commerce': operationsTemplateCopy('zh-CN', true),
    'personal-notes': {
      name: '个人笔记',
      mode: '个人私有空间',
      roles: ['登录用户：管理自己的笔记'],
      description: '包含登录、私有笔记和可编辑页面的笔记应用。',
      tags: ['笔记', 'CRUD', 'OIDC', 'NestJS'],
      features: ['登录与退出登录', '新增、编辑、删除笔记和分页浏览', '只能访问自己的笔记'],
      requirements: [
        '启用 NestJS 后端服务',
        '运行前配置 PostgreSQL 与 OIDC。',
        '使用尚未设置登录流程的文档。'
      ],
      pages: ['登录页', '笔记页']
    },
    'single-sku-shop': {
      name: '单商品下单',
      mode: '单商品订单入门模板',
      roles: ['买家：下单和取消自己的订单', 'catalog-manager：管理商品与库存'],
      description: '浏览商品、提交单商品订单，并查看和取消自己的订单。',
      tags: ['商城', '订单', '库存', 'NestJS'],
      features: [
        '按标题搜索、价格升序浏览与售罄提示',
        '展示单价、库存和预计总额，并校验数量',
        '下单与取消需确认，最近订单保留商品标题',
        '管理员搜索商品、新增、编辑标题与价格及上下架',
        '以原子事务更新库存，通过独立操作补库存',
        '下单、取消和补库存均支持显式恢复已保存请求'
      ],
      requirements: [
        '启用 NestJS，配置 PostgreSQL 与 OIDC',
        '使用没有后端声明和登录流程的新文档。',
        '旧模板需新建文档或显式迁移，才能使用这些改进。',
        '在身份服务中授予 catalog-manager 角色以编辑商品和补库存。',
        '金额使用最小货币单位的整数，库存和最终计价由服务器确认。',
        '商品编辑覆盖提交的字段，不比较多管理员修改版本。',
        '不提供商品删除或绝对库存值覆盖。',
        '此示例不收款，也不提供多商品购物车。'
      ],
      pages: ['商品', '我的订单', '商城登录', '商品管理']
    },
    'single-merchant-shop': {
      name: '单商户商城',
      mode: '一个商家经营统一商品目录',
      description: '包含买家下单、商品管理和商家订单查看的完整页面模板。',
      tags: ['商城', '单商户', '订单', '库存', 'NestJS'],
      roles: [
        '买家：浏览商品、管理自己的订单',
        'catalog-manager：管理统一商品目录、补库存和查看商城订单'
      ],
      features: [
        '商品搜索、数量校验与单商品下单',
        '买家订单记录与取消待处理订单后恢复库存',
        '商品管理、补库存与商家标记订单完成',
        '服务端校验买家所有权与商家角色'
      ],
      requirements: [
        '启用 NestJS，配置 PostgreSQL 与 OIDC',
        '使用没有后端声明和登录流程的新文档。',
        '在已验证 JWT 的 openpencil_roles 数组中向商城经营者授予 catalog-manager。',
        '所有 catalog-manager 角色账号共同管理同一商品目录；此模式不隔离店铺。',
        '身份服务和数据库需另行配置；安装不会创建账号或授予角色。',
        '金额使用最小货币单位的整数，库存和最终计价由服务器确认。',
        '不含支付、多商品购物车、物流或分账。'
      ],
      pages: ['单商户商城', '我的订单', '商城登录', '商品管理', '商家订单']
    },
    'multi-merchant-marketplace': {
      name: '多商户平台',
      mode: '独立店铺，每个商家账号只能拥有一家店',
      description: '获准入驻的商家可以开店，并管理自己店铺的商品和订单。',
      tags: ['商城', '多商户', '店铺', '租户隔离', 'NestJS'],
      roles: [
        '买家：浏览店铺和商品、管理自己的订单',
        'merchant：开设一家店铺、管理本店商品和查看本店订单',
        '身份服务管理员：在生成的应用之外授予商家权限'
      ],
      features: [
        '店铺目录、开店与统一商品浏览页面',
        '单商品下单、买家订单记录与取消待处理订单',
        '按店铺管理商品、补库存和标记订单完成',
        '服务端验证店铺所有权，隔离商家写入与订单访问'
      ],
      requirements: [
        '启用 NestJS，配置 PostgreSQL 与 OIDC',
        '使用没有后端声明和登录流程的新文档。',
        '用户开店前，先在已验证 JWT 的 openpencil_roles 数组中授予 merchant。',
        '一账号一店；成员定位使用 stores.owner_id 和 stores.id，不含团队成员或一账号多店。',
        '身份服务和数据库需另行配置；安装不会创建账号、授予角色或创建店铺。',
        '店铺目录与商品目录公开，买家订单保持私有。',
        '金额使用最小货币单位的整数，库存和最终计价由服务器确认。',
        '不含支付、多商品购物车、物流、分账或平台管理页面。'
      ],
      pages: ['多商户商城', '我的订单', '商城登录', '商品管理', '商家订单', '店铺目录', '我的店铺']
    }
  }
}

function freezeCopy(value: object): void {
  for (const child of Object.values(value)) {
    if (child !== null && typeof child === 'object') freezeCopy(child)
  }
  Object.freeze(value)
}
freezeCopy(english)
freezeCopy(chinese)

/** Locale fallback is deterministic; catalog construction never performs translation requests. */
export function backendLibraryCopy(locale: string): BackendLibraryCopy {
  return locale.toLowerCase().startsWith('zh') ? chinese : english
}
