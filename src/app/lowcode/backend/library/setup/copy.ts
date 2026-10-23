const english = {
  title: 'Template setup',
  failure: 'Template setup could not be completed',
  description:
    'Choose an existing application template, configure its public login, then review what remains before running.',
  close: 'Close template setup',
  template: '1. Choose a template',
  connection: '2. Provider and sign-in',
  review: '3. Review and create',
  readiness: 'Application readiness',
  next: 'Continue',
  back: 'Back',
  create: 'Create application',
  provider: 'Template backend provider',
  providerHint:
    'These templates require NestJS. This selection uses an enabled provider and preserves its verified package identity.',
  missingProvider: 'Enable the NestJS provider in Plugins before creating a template.',
  changedProvider:
    'The reviewed provider is no longer available. Return to the connection step and select an available provider.',
  createHint:
    'Creates editable pages and the backend declaration in one undoable operation. It does not start services or change the database.',
  localOnly:
    'Configuration is checked locally. Database connectivity, OIDC discovery, sign-in, roles and deployment still need runtime verification.',
  created: 'Application created',
  saved: 'Saved application configuration',
  draft: 'Save the current Backend draft to include its changes in this review.',
  existing:
    'This document already has a Backend model. Review its readiness below; existing pages and authentication are preserved.',
  unsupported:
    'The setup wizard creates NestJS templates. Continue configuring this document with its current provider in the Backend editor.',
  configured: 'Configured locally',
  missing: 'Needs configuration',
  unverified: 'Not verified',
  count: 'Routed pages',
  data: 'Data models',
  publicOnly:
    'Only public OIDC settings belong here. Configure database credentials and server secrets in the existing runtime settings.',
  environment: 'Before running',
  desktop:
    'Open compiler preview, choose External or Managed NestJS, then review its connection settings and any proposed database changes before starting.',
  browser:
    'NestJS preview requires the desktop app. Use compiler preview to export the complete React or Vue application and follow its generated backend run instructions.',
  identity:
    'Register the callback for the frontend origin in your identity service, verify the issuer and server JWT settings, and assign the required roles separately.',
  database:
    'Prepare a dedicated PostgreSQL database and review the generated schema or migration before applying it. Template creation does not apply SQL.',
  roles: 'Roles described by this template',
  rolesHint: 'Creating pages or an account profile does not grant these roles.',
  checks: {
    provider: 'Saved backend provider',
    model: 'Saved model and draft',
    login: 'Public sign-in configuration',
    pages: 'Application routes',
    runtime: 'Database, identity service and runtime'
  },
  actions: {
    plugins: 'Manage plugins',
    model: 'Edit and save Backend model',
    login: 'Edit sign-in configuration',
    pages: 'Review application pages',
    preview: 'Open compiler preview'
  }
}

const chinese: typeof english = {
  title: '模板配置向导',
  failure: '未能完成模板配置',
  description: '选择已有应用模板，配置公开登录信息，再核对运行前还缺少哪些条件。',
  close: '关闭模板配置向导',
  template: '1. 选择模板',
  connection: '2. 后端与登录',
  review: '3. 核对并创建',
  readiness: '应用运行准备',
  next: '继续',
  back: '返回',
  create: '创建应用',
  provider: '模板后端提供方',
  providerHint: '这些模板使用 NestJS。选择已启用的提供方，并保留其已验证的软件包身份。',
  missingProvider: '请先在插件中启用 NestJS 提供方，再创建模板。',
  changedProvider: '已核对的提供方现已不可用。请返回配置步骤，重新选择可用提供方。',
  createHint: '一次创建可编辑页面和后端声明，支持整体撤销；不会启动服务或更改数据库。',
  localOnly: '此处仅检查本地配置。数据库连接、OIDC 发现、真实登录、角色与部署仍需运行时验证。',
  created: '应用已创建',
  saved: '已保存的应用配置',
  draft: '请保存当前后端草稿，再将这些修改纳入检查。',
  existing: '当前文档已有后端模型。下方检查其运行准备情况，保留已有页面与登录流程。',
  unsupported: '此向导创建 NestJS 模板。请在后端编辑器中继续使用当前提供方配置此文档。',
  configured: '已在本地配置',
  missing: '待配置',
  unverified: '未验证',
  count: '已配置路由的页面',
  data: '数据模型',
  publicOnly: '这里只填写公开 OIDC 信息。数据库凭据与服务端密钥仍在现有运行环境设置中配置。',
  environment: '运行前准备',
  desktop: '打开编译预览，选择外部或托管 NestJS，核对连接设置和拟执行的数据库变更后再启动。',
  browser:
    'NestJS 预览需要桌面应用。可在编译预览中导出完整 React 或 Vue 应用，并按照生成的后端运行说明启动。',
  identity:
    '在身份服务中登记前端来源对应的回调，核对 issuer 与服务端 JWT 配置，并单独分配所需角色。',
  database: '准备独立 PostgreSQL 数据库，应用前核对生成的结构或迁移；创建模板不会执行 SQL。',
  roles: '模板说明的角色',
  rolesHint: '创建页面或账号资料不会授予这些角色。',
  checks: {
    provider: '已保存后端的提供方',
    model: '已保存模型与草稿',
    login: '公开登录配置',
    pages: '应用页面路由',
    runtime: '数据库、身份服务与运行环境'
  },
  actions: {
    plugins: '管理插件',
    model: '编辑并保存后端模型',
    login: '编辑登录配置',
    pages: '检查应用页面',
    preview: '打开编译预览'
  }
}

export function templateSetupCopy(locale: string): typeof english {
  return locale.toLowerCase().startsWith('zh') ? chinese : english
}
