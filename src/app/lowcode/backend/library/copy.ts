import type { PluginBackendProviderCapabilityV1 } from '@open-pencil/plugin-contracts'

interface EntryCopy {
  readonly name: string
  readonly description: string
  readonly tags: readonly string[]
  readonly requirements: readonly string[]
}
interface TemplateCopy extends EntryCopy {
  readonly features: readonly string[]
  readonly pages: readonly string[]
}
export interface BackendLibraryCopy {
  readonly unavailableRequirement: string
  readonly genericProviderDescription: string
  readonly genericProviderRequirement: string
  readonly capabilities: Readonly<Record<PluginBackendProviderCapabilityV1, string>>
  readonly providers: Readonly<Record<'supabase' | 'nestjs', EntryCopy>>
  readonly templates: Readonly<Record<'personal-notes' | 'single-sku-shop', TemplateCopy>>
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
    'personal-notes': {
      name: 'Personal notes',
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
    'personal-notes': {
      name: '个人笔记',
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
