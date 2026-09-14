const english = {
  modelHint:
    'NestJS generates API access from the declared public, owner, role and supported tenant policies. New entities start with a protected UUID key, owner field and owner permissions.',
  httpHint:
    'Choose exposed operations and fields. The API enforces the resource’s declared access policies; public access, ownership, roles and store membership have different scopes.',
  providerRecovery:
    'If NestJS is pinned to an older version, open Settings → Plugins → Browse → NestJS, choose Replace pinned version, and review the old and new digests before confirming. Then return here, select the installed trusted provider again, and choose Save Backend model.',
  query: 'List query options',
  filterFields: 'Exact filters',
  searchFields: 'Text search',
  sortFields: 'Sorting',
  bindings: 'List query bindings',
  filterExpression: 'Filter value expression',
  searchExpression: 'Search expression',
  sortField: 'Sort field',
  sortDirection: 'Sort direction',
  noSort: 'Default order',
  ascending: 'Ascending',
  descending: 'Descending',
  clearQuery: 'Clear query bindings',
  queryHint:
    'Choose readable fields for client queries. Search accepts text fields; sorting requires non-null fields other than free text. Query options never grant access to data.',
  accessHint:
    'NestJS applies these rules in the API. Public read exposes this entity through resources that include that policy; a resource may select a narrower set of read policies. Fixed conditions such as published status are enforced on the server together with principal and membership rules. Frontend filters do not grant access.',
  relatedMember: 'Related member',
  verifiedIdentity: 'Verified account identity',
  compoundPolicyHint:
    'This template rule uses compound authorization or protects a business command. Its full definition is preserved here; customize it in the exported backend.',
  accessReference: 'Access rule reference',
  readPolicies: 'Resource read policies',
  allReadPolicies: 'All applicable entity read policies',
  readPolicyHint:
    'Only these policies authorize list and read requests. Query edits preserve this restriction.',
  roleHint:
    'Configure the verified JWT openpencil_roles array with the exact role IDs below. Display names do not grant access.',
  roleId: 'Role ID',
  tenantRole: 'Required role in addition to membership',
  membershipOnly: 'Membership only',
  commandTenant: 'Verified tenant membership and selector parameter',
  commandRowPolicy: 'Current record permissions and selector parameter',
  tenantHint:
    'NestJS supports a bounded store membership locator: stores.owner_id identifies the signed-in merchant and stores.id identifies their store. Each account owns one store. Configure the matching store field on products and orders; complex membership rules must pass provider validation and are not supported by this preset.',
  relationHint:
    'NestJS accepts restrict or no-action deletion. A reference to private data requires an owner-scoped foreign key; a simple foreign key is allowed only when the target permits public read. Unsupported relations remain visible and must pass validation before saving.'
}

const chinese: typeof english = {
  modelHint:
    'NestJS 根据公开访问、所有者、角色和受支持的租户策略生成 API 权限。新建实体默认包含受保护的 UUID 主键、所有者字段和所有者权限。',
  httpHint:
    '选择公开的操作和字段。API 执行资源声明的访问策略；公开访问、所有者、角色和店铺成员各自的范围不同。',
  providerRecovery:
    '如果 NestJS 固定在旧版本，请到「设置 → 插件 → 浏览 → NestJS」选择「替换已固定版本」，核对旧、新摘要后确认。随后回到此处，重新选择已安装的可信提供方并点击「保存后端模型」。',
  query: '列表查询配置',
  filterFields: '精确筛选',
  searchFields: '文本搜索',
  sortFields: '排序',
  bindings: '列表查询绑定',
  filterExpression: '筛选值表达式',
  searchExpression: '搜索表达式',
  sortField: '排序字段',
  sortDirection: '排序方向',
  noSort: '默认顺序',
  ascending: '升序',
  descending: '降序',
  clearQuery: '清空查询绑定',
  queryHint:
    '选择可读取的查询字段。搜索仅支持文本；排序要求非空且不是自由文本字段。查询条件不会授予数据访问权限。',
  accessHint:
    'NestJS 在 API 中执行这些规则。包含公开读取策略的资源会公开此实体，资源可以选择更窄的读取策略子集；“仅已发布”等固定条件与主体、成员规则一起在服务端执行，前端筛选不会授予访问权限。',
  relatedMember: '关联成员',
  verifiedIdentity: '已验证的账号身份',
  compoundPolicyHint:
    '此模板规则包含复合权限或保护业务操作，此处保留完整定义；如需定制，请在导出的后端中修改。',
  accessReference: '访问规则引用',
  readPolicies: '资源读取策略',
  allReadPolicies: '此实体所有适用的读取策略',
  readPolicyHint: '列表与详情请求仅由这些策略授权；编辑查询配置会保留此限制。',
  roleHint: '请在已验证 JWT 的 openpencil_roles 数组中配置下方精确角色 ID。显示名称不会授予权限。',
  roleId: '角色 ID',
  tenantRole: '成员身份之外还需具备的角色',
  membershipOnly: '仅要求成员身份',
  commandTenant: '服务端验证的租户成员身份与选择参数',
  commandRowPolicy: '当前记录权限与选择参数',
  tenantHint:
    'NestJS 支持受限的店铺成员定位：stores.owner_id 对应登录商家，stores.id 对应其店铺，一账号一店。在商品和订单上配置对应店铺字段；复杂成员规则必须通过提供方校验，此预设不支持。',
  relationHint:
    'NestJS 仅支持 restrict 或 no-action 删除策略。引用私有数据需要包含所有者的外键；目标允许公开读取时可使用普通外键。不支持的关系会保留，并须在保存前通过校验。'
}

export function nestJSUICopy(locale: string): typeof english {
  return locale.startsWith('zh') ? chinese : english
}
