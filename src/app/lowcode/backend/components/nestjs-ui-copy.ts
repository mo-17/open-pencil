const english = {
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
    'NestJS applies these rules in the API. Public read exposes all readable rows and fields of this entity through its resources. Published-only conditions are not supported; a frontend filter is not an access rule.',
  roleHint:
    'Configure the verified JWT openpencil_roles array with the exact role IDs below. Display names do not grant access.',
  roleId: 'Role ID',
  relationHint:
    'NestJS accepts restrict or no-action deletion. A reference to private data requires an owner-scoped foreign key; a simple foreign key is allowed only when the target permits public read. Unsupported relations remain visible and must pass validation before saving.'
}

const chinese: typeof english = {
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
    'NestJS 在 API 中执行这些规则。公开读取会公开该实体各资源的全部可读行和字段；目前不支持“仅已发布”等条件，前端筛选不能用作权限控制。',
  roleHint: '请在已验证 JWT 的 openpencil_roles 数组中配置下方精确角色 ID。显示名称不会授予权限。',
  roleId: '角色 ID',
  relationHint:
    'NestJS 仅支持 restrict 或 no-action 删除策略。引用私有数据需要包含所有者的外键；目标允许公开读取时可使用普通外键。不支持的关系会保留，并须在保存前通过校验。'
}

export function nestJSUICopy(locale: string): typeof english {
  return locale.startsWith('zh') ? chinese : english
}
