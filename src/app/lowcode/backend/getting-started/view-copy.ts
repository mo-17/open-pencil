const english = {
  title: 'Start using your application',
  description: 'Review sign-in, prepare your first records, then preview or export the whole app.',
  open: 'Getting started',
  close: 'Close getting started',
  saved: 'Saved configuration',
  unverified: 'Service connection and sign-in have not been checked here.',
  unsaved: 'Your draft has unsaved changes. This guide describes the saved application.',
  identity: '1. Configure sign-in and roles',
  issuer: 'OIDC issuer',
  clientId: 'Public client ID',
  callback: 'Callback path',
  roles: 'Required business roles',
  noRoles: 'No template business roles are referenced by the saved model.',
  roleHint:
    'Assign roles in your identity service. Creating an application or an account profile does not grant them.',
  configure: 'Edit sign-in configuration',
  prepare: '2. Prepare your first records',
  modules: 'Add business modules',
  run: '3. Preview and export',
  preview:
    'On desktop, open the compiler preview on the right and choose External or Managed NestJS preview. Review its setup and database changes before starting. Browser-only NestJS preview is unavailable.',
  export:
    'Export the complete application with the React or Vue source exporter, including sign-in, account and business pages. Follow the generated NestJS README.md and LOCAL-RUN.md to start the backend, then the frontend.',
  combined:
    'A combined application runs one NestJS backend and shares its database and identity configuration.',
  pages: 'Current routed pages',
  pagesHint:
    'Use these pages to review the export scope. This list does not select pages in the exporter.',
  missingPages:
    'No routed pages remain. Restore or configure the application pages before exporting.',
  pageUnavailable: 'This application page is no longer available.',
  savedOnly: 'Changes to your draft take effect after you save them.'
}

const chinese: typeof english = {
  title: '开始使用应用',
  description: '核对登录配置，准备首批业务数据，再预览或导出完整应用。',
  open: '开始使用',
  close: '关闭使用指南',
  saved: '已保存的配置',
  unverified: '此处尚未检查服务连接和真实登录。',
  unsaved: '草稿有未保存的修改。此指南展示的是已保存的应用。',
  identity: '1. 配置登录与角色',
  issuer: 'OIDC issuer',
  clientId: '公开 Client ID',
  callback: '回调路径',
  roles: '所需业务角色',
  noRoles: '已保存模型未引用模板业务角色。',
  roleHint: '请在身份服务中分配角色。创建应用或账号资料不会授予这些角色。',
  configure: '编辑登录配置',
  prepare: '2. 准备首批业务数据',
  modules: '添加业务模块',
  run: '3. 预览与导出',
  preview:
    '桌面端可打开右侧编译预览，选择外部或托管 NestJS 预览，核对配置及数据库变更后再启动。纯浏览器端暂不支持 NestJS 预览。',
  export:
    '使用 React 或 Vue 源码导出器导出完整应用，包含登录、账号和业务页面。按照生成的 NestJS README.md 和 LOCAL-RUN.md 启动后端，再启动前端。',
  combined: '组合应用只运行一个 NestJS 后端，共享数据库和身份配置。',
  pages: '当前已配置路由的页面',
  pagesHint: '可用这些页面核对导出范围；此列表不会替你勾选导出页面。',
  missingPages: '当前没有已配置路由的页面。请先恢复或配置应用页面，再导出。',
  pageUnavailable: '此应用页面已不可用。',
  savedOnly: '草稿修改需要保存后才会生效。'
}

export function backendGettingStartedViewCopy(locale: string): typeof english {
  return locale.toLowerCase().startsWith('zh') ? chinese : english
}
