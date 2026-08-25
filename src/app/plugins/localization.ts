import type { Locale } from '@open-pencil/vue'

export interface AppPluginLocalizedContributionText {
  readonly name: string
  readonly description: string
}

export interface AppPluginLocalizedText extends AppPluginLocalizedContributionText {
  readonly contributions: Readonly<Record<string, AppPluginLocalizedContributionText>>
}

export interface AppPluginModuleEditorText {
  readonly addItem: string
  readonly removeItem: string
  readonly identifier: string
  readonly title: string
  readonly content: string
  readonly newTab: string
  readonly newSection: string
  count(current: number, maximum: number): string
  item(index: number): string
}

const contribution = (name: string, description: string): AppPluginLocalizedContributionText =>
  Object.freeze({ name, description })

const plugin = (
  name: string,
  description: string,
  contributions: Readonly<Record<string, AppPluginLocalizedContributionText>>
): AppPluginLocalizedText =>
  Object.freeze({
    name,
    description,
    contributions: Object.freeze({ ...contributions })
  })

/**
 * Host-owned Simplified Chinese copy for bundled plugins.
 *
 * Signed publisher manifests remain byte-for-byte unchanged. Remote plugins therefore keep their
 * signed publisher copy, while app-bundled identities may opt into reviewed local presentation.
 */
const ZH_CN_BUNDLED_PLUGIN_TEXT: Readonly<Partial<Record<string, AppPluginLocalizedText>>> =
  Object.freeze({
    'open-pencil.map': plugin(
      'OpenPencil 地图',
      '可编辑地图模块，生成的 Web 项目使用经过审核的 MapLibre 适配器。',
      {
        map: contribution('地图', '添加可编辑地图，并配置样式、中心点、缩放级别、标记与图层。')
      }
    ),
    'open-pencil.chart': plugin('OpenPencil 图表', '用于展示有界结构化数据的可编辑图表模块。', {
      chart: contribution('图表', '添加可配置类型、标签、数值和颜色的图表。')
    }),
    'open-pencil.rich-text': plugin('OpenPencil 富文本', '使用有界文档模型编辑和输出富文本内容。', {
      'rich-text': contribution('富文本', '添加支持标题、列表、链接、引用与代码块的可编辑富文本。')
    }),
    'open-pencil.html': plugin('</> HTML', '在严格沙箱和内容安全策略中展示已编辑的 HTML。', {
      html: contribution('</> HTML', '添加不执行脚本的 HTML 内容模块。')
    }),
    'open-pencil.video': plugin(
      'OpenPencil 视频',
      '播放用户明确配置的公共 HTTPS 视频，并提供受控播放选项。',
      {
        video: contribution('视频', '添加视频源、封面、播放控件、循环、静音与尺寸适配。')
      }
    ),
    'open-pencil.table': plugin('OpenPencil 表格', '编辑并展示有界的纯文本行列数据。', {
      table: contribution('表格', '添加可配置表头、斑马纹和颜色的静态表格。')
    }),
    'open-pencil.slide-menu': plugin('OpenPencil 滑出菜单', '从上下左右弹出边缘菜单或模态窗口。', {
      'slide-menu': contribution('滑出菜单', '添加带安全跳转项、遮罩和关闭行为的弹出菜单。')
    }),
    'open-pencil.dropdown-menu': plugin(
      'OpenPencil 下拉菜单',
      '提供可配置触发方式、弹出位置、项目状态与安全链接的无障碍下拉菜单。',
      {
        'dropdown-menu': contribution(
          '下拉菜单',
          '添加支持键盘、分隔线、快捷键提示、禁用项和危险项的扁平菜单。'
        )
      }
    ),
    'open-pencil.upload-button': plugin(
      'OpenPencil 上传按钮',
      '仅在用户设备上选择并校验文件，不会上传或持久化。',
      {
        'upload-button': contribution('上传按钮', '添加支持类型、数量和大小校验的本地文件选择器。')
      }
    ),
    'open-pencil.modal': plugin(
      'OpenPencil 模态弹窗',
      '打开可配置关闭规则、底部操作和响应式宽度的无障碍对话框。',
      {
        modal: contribution('模态弹窗', '添加有界纯文本标题、正文、遮罩、关闭按钮与底部操作。')
      }
    ),
    'open-pencil.lottie': plugin(
      'OpenPencil Lottie 动画',
      '展示受限的内嵌 Lottie JSON 或经确认加载的公共 HTTPS 动画。',
      {
        lottie: contribution('Lottie 动画', '添加不含表达式、外部图片、音频或外部字体的矢量动画。')
      }
    ),
    'open-pencil.carousel': plugin(
      'OpenPencil 轮播',
      '具有键盘操作、指示点、箭头和可暂停自动播放的无障碍轮播。',
      {
        carousel: contribution('轮播', '添加最多十二张幻灯片及安全链接和可选远程图片。')
      }
    ),
    'open-pencil.data-grid': plugin(
      'OpenPencil 高级数据表格',
      '对有界类型化数据提供排序、筛选、分页和行选择。',
      {
        'data-grid': contribution(
          '高级数据表格',
          '添加最多十六列、二百行和两千个单元格的交互数据表格。'
        )
      }
    ),
    'open-pencil.clipboard-toolkit': plugin(
      '剪贴板工具箱',
      '通过宿主审核的命令复制当前选择内容。',
      {
        'copy-as-text': contribution('复制为文本', '将选中图层中的文本复制到系统剪贴板。'),
        'copy-as-svg': contribution('复制为 SVG', '将选中的矢量内容复制为 SVG 源码。'),
        'copy-as-jsx': contribution('复制为 JSX', '将选中的设计复制为 OpenPencil JSX 源码。'),
        'copy-as-png': contribution('复制为 PNG', '以 2 倍分辨率渲染选择内容并复制为 PNG。')
      }
    ),
    'open-pencil.compiler-preview-popout': plugin(
      '编译器预览悬浮窗',
      '由宿主在独立窗口中打开当前编译器预览。',
      {
        'open-compiler-preview-popout': contribution(
          '打开独立预览窗口',
          '不向插件开放 URL、窗口标签或原生窗口参数，仅由宿主打开当前预览。'
        )
      }
    ),
    'open-pencil.ai-popout': plugin('AI 独立窗口', '由宿主在独立窗口中打开当前 AI 对话。', {
      'open-ai-popout': contribution(
        '打开 AI 独立窗口',
        '不向插件开放对话内容、窗口标签或原生窗口参数，仅由宿主打开当前 AI 对话。'
      )
    }),
    'open-pencil.tauri-react-exporter': plugin(
      'Tauri React 导出器',
      '将当前文档打包为 Tauri 2 与 React 源码项目。',
      {
        'tauri-react-source': contribution(
          '导出 Tauri React 源码',
          '生成源码 ZIP，不安装依赖、不运行 Cargo，也不执行生成代码。'
        )
      }
    ),
    'open-pencil.expo-react-native-exporter': plugin(
      'Expo React Native 导出器',
      '将支持的静态设计子集打包为 Expo React Native 源码项目。',
      {
        'expo-react-native-source': contribution(
          '导出 Expo React Native 源码',
          '生成原生组件源码 ZIP，并明确记录尚不支持的 Web 行为。'
        )
      }
    ),
    'open-pencil.flutter-exporter': plugin(
      'Flutter 导出器',
      '将支持的静态设计子集打包为 Dart 与 Flutter 源码项目。',
      {
        'flutter-source': contribution(
          '导出 Flutter 源码',
          '生成 Flutter Widget 源码 ZIP，不调用 Flutter 构建工具。'
        )
      }
    ),
    'open-pencil.accessibility-audit': plugin(
      '静态无障碍审计',
      '运行有资源上限的静态设计检查；不等同于完整 WCAG 认证。',
      {
        'run-static-accessibility-audit': contribution(
          '运行静态无障碍审计',
          '检查对比度、文字尺寸、触控目标和动效等可静态分析的问题。'
        )
      }
    ),
    'open-pencil.design-tokens-exporter': plugin(
      '设计令牌导出器',
      '确定性导出可发布变量、集合、模式、类型、描述、值和别名。',
      {
        'design-tokens-json': contribution(
          '导出设计令牌 JSON',
          '排除隐藏变量，并对缺失别名、循环别名或模式值错误进行失败保护。'
        )
      }
    ),
    'open-pencil.figma-projection-exporter': plugin(
      'Figma 可编辑投影导出器',
      '创建由 Figma 原生可编辑图层组成的派生 .fig 投影。',
      {
        'figma-editable-projection': contribution(
          '导出 Figma 可编辑投影',
          '不会修改当前文档，也不承诺保留 OpenPencil 运行时行为。'
        )
      }
    ),
    'open-pencil.tabs': plugin('OpenPencil 标签页', '在一个有界模块中组织多个可切换内容面板。', {
      tabs: contribution('标签页', '添加支持横向或纵向布局、自动或手动激活的无障碍标签页。')
    }),
    'open-pencil.accordion': plugin(
      'OpenPencil 手风琴',
      '使用单开或多开模式组织可展开的内容项目。',
      {
        accordion: contribution('手风琴', '添加支持键盘操作、分隔线和初始展开状态的折叠面板。')
      }
    ),
    'open-pencil.qr-barcode': plugin(
      'OpenPencil 二维码与条形码',
      '从纯文本生成二维码或 Code 128 条形码，不访问网络。',
      {
        'qr-barcode': contribution(
          '二维码与条形码',
          '添加可配置容错级别、静区、说明文字和颜色的编码图形。'
        )
      }
    ),
    'open-pencil.markdown': plugin(
      'OpenPencil Markdown',
      '安全展示 CommonMark 或 GFM 文本，不执行原始 HTML。',
      {
        markdown: contribution('Markdown', '添加标题、段落、列表、引用、代码和安全链接等文档内容。')
      }
    ),
    'open-pencil.code-block': plugin(
      'OpenPencil 代码块',
      '展示有界纯文本代码并提供主题、换行、行号和复制控制。',
      {
        'code-block': contribution('代码块', '添加不会执行代码或解释 HTML 的纯文本代码展示区域。')
      }
    ),
    'open-pencil.pdf-viewer': plugin(
      'OpenPencil PDF 查看器',
      '在生成的项目中展示用户配置的安全 PDF 来源。',
      {
        'pdf-viewer': contribution(
          'PDF 查看器',
          '添加页码、适配方式、工具栏和下载控制；画布不会请求 PDF。'
        )
      }
    ),
    'open-pencil.audio-player': plugin(
      'OpenPencil 音频播放器',
      '播放用户配置的安全音频来源并提供受控播放行为。',
      {
        'audio-player': contribution(
          '音频播放器',
          '添加标题、作者、音量、速度、预加载和循环选项；画布不会请求音频。'
        )
      }
    ),
    'open-pencil.design-system-audit': plugin(
      '设计系统审计',
      '检查设计令牌、组件变体、间距和字体使用的一致性。',
      {
        'run-design-system-audit': contribution(
          '运行设计系统审计',
          '生成有界静态报告与定位信息，不会自动修改文档。'
        )
      }
    ),
    'open-pencil.nextjs-exporter': plugin(
      'Next.js 导出器',
      '将当前文档打包为 Next.js 与 React 源码项目。',
      {
        'nextjs-source': contribution(
          '导出 Next.js 源码',
          '生成源码 ZIP，不安装依赖、不启动服务器，也不执行生成代码。'
        )
      }
    ),
    'open-pencil.capacitor-exporter': plugin(
      'Capacitor 导出器',
      '将生成的 Web 应用打包为 Capacitor 源码项目。',
      {
        'capacitor-source': contribution(
          '导出 Capacitor 源码',
          '生成可继续开发的源码 ZIP，不添加平台二进制或调用原生构建工具。'
        )
      }
    ),
    'open-pencil.electron-exporter': plugin(
      'Electron 导出器',
      '将当前文档打包为 Electron 与 React 源码项目。',
      {
        'electron-source': contribution(
          '导出 Electron 源码',
          '生成最小权限的源码 ZIP，不安装依赖或运行 Electron。'
        )
      }
    ),
    'open-pencil.vue-exporter': plugin(
      'Vue 导出器',
      '将当前文档打包为 Vite、Vue 3 与 TypeScript 源码项目。',
      {
        'vue-source': contribution(
          '导出 Vue 源码',
          '生成源码 ZIP，不安装依赖、不启动服务器，也不执行生成代码；降级项会写入导出警告。'
        )
      }
    ),
    'open-pencil.wechat-miniprogram-exporter': plugin(
      '微信小程序导出器',
      '将当前文档打包为原生微信小程序源码项目。',
      {
        'wechat-miniprogram-source': contribution(
          '导出微信小程序源码',
          '生成 WXML、WXSS、JavaScript 与配置文件 ZIP，不调用微信开发者工具，也不写入 AppID。'
        )
      }
    ),
    'open-pencil.taro-exporter': plugin(
      'Taro 导出器',
      '将当前文档打包为 Taro React 小程序源码项目。',
      {
        'taro-source': contribution(
          '导出 Taro 源码',
          '生成可继续开发的源码 ZIP，不安装依赖、不运行构建，也不执行生成代码。'
        )
      }
    ),
    'open-pencil.uni-app-exporter': plugin(
      'uni-app 导出器',
      '将当前文档打包为 Vue 与 uni-app 源码项目。',
      {
        'uni-app-source': contribution(
          '导出 uni-app 源码',
          '生成可导入开发工具的源码 ZIP，并明确记录不支持或需要人工适配的行为。'
        )
      }
    ),
    'open-pencil.mpx-exporter': plugin('Mpx 导出器', '将当前文档打包为 Mpx 小程序源码项目。', {
      'mpx-source': contribution(
        '导出 Mpx 源码',
        '生成 .mpx 组件与配置源码 ZIP，不安装依赖、不运行构建，也不写入 AppID。'
      )
    }),
    'open-pencil.supabase-schema-inspector': plugin(
      'Supabase 架构检查器',
      '通过受审核的只读连接器读取 Supabase 项目的有界数据库架构，不会修改数据。',
      {
        'supabase.schema-inspector': contribution(
          'Supabase 架构检查器',
          '使用固定的 Supabase Management API 域名读取表、字段和关系。'
        ),
        'inspect-schema': contribution(
          '检查数据库架构',
          '读取一个项目和 schema 的有界结构目录；需要单独配置 Supabase 个人访问令牌。'
        ),
        'management-pat': contribution(
          'Supabase 个人访问令牌',
          '由中央凭据存储保管，仅在调用 Supabase Management API 时由宿主注入。'
        )
      }
    ),
    'open-pencil.airtable': plugin(
      'Airtable 记录',
      '通过受审核的只读连接器读取一页有界 Airtable 记录，不会创建、更新或删除记录。',
      {
        'airtable.records': contribution(
          'Airtable 记录',
          '使用固定的 Airtable API 域名按 Base ID 与 Table ID 读取记录。'
        ),
        'list-records': contribution(
          '列出 Airtable 记录',
          '最多读取一百条记录，并将字段转换为有界名称和值列表。'
        ),
        'access-token': contribution(
          'Airtable 个人访问令牌',
          '由中央凭据存储保管，仅在调用固定 Airtable API 时由宿主注入。'
        )
      }
    ),
    'open-pencil.supabase-business': plugin(
      'Supabase 数据表',
      '通过受审核的连接器查询或修改 Supabase 数据表，并遵守项目的 RLS 与会话权限。',
      {
        'supabase.tables': contribution(
          'Supabase 数据表',
          '项目域名由严格的 projectRef 模板生成；密钥和访问令牌只由宿主在运行时注入。'
        ),
        'query-rows': contribution('查询数据行', '使用有界列、筛选、排序和数量限制查询数据行。'),
        'insert-rows': contribution(
          '新增数据行',
          '向指定数据表新增有界字段；每次执行都需要人工确认。'
        ),
        'update-rows': contribution(
          '更新数据行',
          '只在提供非空筛选条件时更新数据行；每次执行都需要人工确认。'
        ),
        'delete-rows': contribution(
          '删除数据行',
          '只在提供非空筛选条件时删除数据行；每次执行都需要人工确认。'
        ),
        'publishable-key': contribution(
          'Supabase 可发布密钥',
          '由中央凭据存储保管，并作为经过审核的 apikey 请求头由宿主注入。'
        ),
        'access-token': contribution(
          'Supabase 访问令牌',
          '由中央凭据存储保管，并在运行时作为 Bearer 令牌由宿主注入。'
        )
      }
    ),
    'open-pencil.stripe': plugin(
      'Stripe 结账与计费',
      '通过受审核的连接器读取商品和价格，或在每次确认后创建托管结账会话。',
      {
        'stripe.billing': contribution(
          'Stripe 结账与计费',
          '仅访问固定 Stripe API，密钥由宿主在运行时注入，不进入设计文档。'
        ),
        'get-product': contribution('读取 Stripe 商品', '按商品 ID 读取有界商品摘要。'),
        'get-price': contribution('读取 Stripe 价格', '按价格 ID 读取有界价格与周期摘要。'),
        'create-checkout-session': contribution(
          '创建 Stripe 结账会话',
          '使用固定字段创建托管结账会话；每次执行都需要人工确认。'
        ),
        'secret-key': contribution(
          'Stripe 密钥',
          '由中央凭据存储保管，仅在调用固定 Stripe API 时由宿主注入。'
        )
      }
    ),
    'open-pencil.resend-email': plugin(
      'Resend 邮件',
      '通过受审核的连接器查询或发送有界邮件；发送操作每次都需要人工确认。',
      {
        'resend.email': contribution(
          'Resend 邮件',
          '仅访问固定 Resend API，API 密钥由宿主在运行时注入。'
        ),
        'get-email': contribution('查询邮件', '按 Resend 邮件 ID 查询已发送邮件的有界摘要。'),
        'send-email': contribution(
          '发送邮件',
          '发送文本或 HTML 邮件，不允许附件、自定义请求头或自定义网络地址。'
        ),
        'api-key': contribution(
          'Resend API 密钥',
          '由中央凭据存储保管，仅在调用固定 Resend API 时由宿主注入。'
        )
      }
    ),
    'open-pencil.neon-postgres': plugin(
      'Neon Postgres 项目',
      '通过受审核的只读连接器列出或搜索一页有界的 Neon 项目，不会更改数据库资源。',
      {
        'neon.projects': contribution('Neon 项目', '使用固定的 Neon API 域名读取有界项目列表。'),
        'list-projects': contribution(
          '列出 Neon 项目',
          '列出或搜索一页 Neon 项目，不会创建、修改或删除数据库资源。'
        ),
        'api-key': contribution(
          'Neon API 密钥',
          '请在 Neon 创建个人、组织或项目级 API 密钥并粘贴一次；无需额外 scope。密钥由中央凭据存储保管，仅在调用固定 Neon API 时注入。'
        )
      }
    ),
    'open-pencil.sentry': plugin(
      'Sentry 问题',
      '通过受审核的只读连接器列出指定 Sentry 组织的问题摘要。',
      {
        'sentry.issues': contribution(
          'Sentry 问题',
          '使用固定的 Sentry API 域名读取指定组织的有界问题列表。'
        ),
        'list-issues': contribution(
          '列出组织问题',
          '按组织标识列出一页问题摘要，不会读取事件载荷。'
        ),
        'access-token': contribution(
          'Sentry 身份验证令牌',
          '请粘贴仅具事件读取权限的 Sentry 内部集成令牌；最小 scope：event:read。令牌由中央凭据存储保管，仅在调用固定 Sentry API 时注入。'
        )
      }
    ),
    'open-pencil.hubspot': plugin(
      'HubSpot 联系人',
      '通过受审核的只读连接器读取 HubSpot CRM 联系人的基本信息。',
      {
        'hubspot.contacts': contribution(
          'HubSpot 联系人',
          '使用固定的 HubSpot API 域名读取有界联系人列表。'
        ),
        'list-contacts': contribution(
          '列出联系人',
          '列出一页仅包含基本身份字段的 HubSpot 联系人。'
        ),
        'access-token': contribution(
          'HubSpot 访问令牌',
          '请使用 HubSpot 私有应用令牌或 OAuth 访问令牌；最小 scope：crm.objects.contacts.read。令牌由中央凭据存储保管，仅在调用固定 HubSpot API 时注入。'
        )
      }
    ),
    'open-pencil.apollo': plugin(
      'Apollo 名单',
      '通过受审核的只读连接器读取 Apollo 中已保存的联系人和账户名单。',
      {
        'apollo.lists': contribution('Apollo 名单', '使用固定的 Apollo API 域名读取有界名单列表。'),
        'list-lists': contribution(
          '列出 Apollo 名单',
          '列出已保存的 Apollo 名单，不会消耗数据补全额度。'
        ),
        'api-key': contribution(
          'Apollo API 密钥',
          '请创建仅具名单读取权限的 Apollo API 密钥并粘贴一次；最小 OAuth scope：tags_list。密钥由中央凭据存储保管，仅作为 x-api-key 调用固定 Apollo API。'
        )
      }
    ),
    'open-pencil.posthog': plugin(
      'PostHog 洞察（美国区）',
      '通过受审核的只读连接器列出一个 PostHog 美国云项目中已保存的洞察。',
      {
        'posthog.insights-us': contribution(
          'PostHog 洞察（美国区）',
          '仅访问固定的 PostHog 美国云 API，不授予欧洲区或自托管域名网络权限。'
        ),
        'list-insights': contribution(
          '列出洞察',
          '列出指定 PostHog 美国云项目的一页缓存洞察元数据。'
        ),
        'personal-api-key': contribution(
          'PostHog 个人 API 密钥',
          '请粘贴 PostHog 个人 API 密钥；最小 scope：insight:read。此连接器仅适用于美国云，欧洲区和自托管来源需要单独审核。'
        )
      }
    ),
    'open-pencil.asana': plugin(
      'Asana 工作区',
      '通过受审核的只读连接器列出当前 Asana 用户可见的工作区。',
      {
        'asana.workspaces': contribution(
          'Asana 工作区',
          '使用固定的 Asana API 域名读取有界工作区列表。'
        ),
        'list-workspaces': contribution('列出工作区', '列出一页有界的 Asana 工作区标识和名称。'),
        'access-token': contribution(
          'Asana 访问令牌',
          '请粘贴具工作区读取权限的 Asana OAuth 令牌或个人访问令牌；最小 scope：workspaces:read。令牌仅在调用固定 Asana API 时注入。'
        )
      }
    ),
    'open-pencil.zotero': plugin(
      'Zotero 顶层条目',
      '通过受审核的只读连接器列出指定 Zotero 用户文库中的顶层书目条目。',
      {
        'zotero.top-items': contribution(
          'Zotero 顶层条目',
          '使用固定的 Zotero API 域名读取有界书目条目列表。'
        ),
        'list-top-items': contribution(
          '列出顶层条目',
          '列出一页最近修改的顶层书目条目，不读取子笔记或附件。'
        ),
        'api-key': contribution(
          'Zotero API 密钥',
          '请创建专用的只读 Zotero API 密钥，并单独填写数字用户 ID；最小 scope：library:read。密钥仅作为 Zotero-API-Key 调用固定 API。'
        )
      }
    ),
    'open-pencil.heygen': plugin(
      'HeyGen 虚拟人',
      '通过受审核的只读连接器列出当前 HeyGen 账户可用的虚拟人，不会启动视频生成。',
      {
        'heygen.avatars': contribution(
          'HeyGen 虚拟人',
          '使用固定的 HeyGen API 域名读取有界虚拟人目录。'
        ),
        'list-avatars': contribution(
          '列出虚拟人',
          '列出当前 HeyGen 账户可用的虚拟人目录，不会创建视频。'
        ),
        'api-key': contribution(
          'HeyGen API 密钥',
          '请粘贴 HeyGen API 密钥；无需额外 scope。此连接器只列出可用虚拟人，密钥仅作为 x-api-key 调用固定 HeyGen API。'
        )
      }
    ),
    'open-pencil.linear': plugin(
      'Linear 问题',
      '通过宿主审核的固定只读 GraphQL 查询列出 Linear 问题。',
      {
        'linear.issues': contribution(
          'Linear 问题',
          '仅向固定的 Linear GraphQL API 提交宿主审核的只读查询。'
        ),
        'list-issues': contribution(
          '列出问题',
          '通过固定的只读 GraphQL 文档列出一页 Linear 问题摘要。'
        ),
        'access-token': contribution(
          'Linear OAuth 访问令牌',
          '请使用 Linear OAuth 访问令牌，以确保 Authorization Bearer 格式明确；最小 scope：read。令牌由中央凭据存储保管。'
        )
      }
    ),
    'open-pencil.openai-developers': plugin(
      'OpenAI 模型',
      '通过受审核的只读连接器列出一个 OpenAI API 项目密钥可用的模型。',
      {
        'openai.models': contribution('OpenAI 模型', '仅访问固定的 OpenAI API 模型列表端点。'),
        'list-models': contribution('列出模型', '列出模型标识和基本所有权元数据，不发起模型推理。'),
        'api-key': contribution(
          'OpenAI API 密钥',
          '请粘贴 OpenAI 项目 API 密钥；最小权限：models.read。此连接器只调用模型列表端点，密钥由中央凭据存储保管。'
        )
      }
    ),
    'open-pencil.box': plugin(
      'Box 根目录项目',
      '通过受审核的只读连接器列出已授权 Box 根目录中的文件、文件夹和网页链接。',
      {
        'box.root-items': contribution(
          'Box 根目录项目',
          '使用固定的 Box API 域名读取根文件夹中的有界项目列表。'
        ),
        'list-root-items': contribution(
          '列出根目录项目',
          '从 Box 文件夹 0 列出一页使用标记分页的项目。'
        ),
        'access-token': contribution(
          'Box OAuth 访问令牌',
          '请手动完成 Box OAuth，并粘贴具根目录读取权限的访问令牌；最小 scope：root_readonly。令牌仅在调用固定 Box API 时注入。'
        )
      }
    ),
    'open-pencil.slack': plugin(
      'Slack 公开频道',
      '通过受审核的只读连接器列出 Slack 公开频道，不会读取消息或私密会话。',
      {
        'slack.public-channels': contribution(
          'Slack 公开频道',
          '使用固定的 Slack API 域名读取公开频道列表。'
        ),
        'list-public-channels': contribution(
          '列出公开频道',
          '列出一页明确为公开且未归档的 Slack 频道。'
        ),
        'access-token': contribution(
          'Slack 机器人或用户令牌',
          '请手动安装具 channels:read 权限的 Slack 应用，并粘贴机器人或用户令牌；最小 scope：channels:read。令牌仅在调用固定 Slack API 时注入。'
        )
      }
    ),
    'open-pencil.google-calendar': plugin(
      'Google 日历事件',
      '通过受审核的只读连接器列出 Google 主日历中时间范围明确的事件元数据。',
      {
        'google-calendar.events': contribution(
          'Google 日历事件',
          '使用固定的 Google Calendar API 域名读取主日历事件。'
        ),
        'list-events': contribution(
          '列出事件',
          '在明确的时间窗口内列出一页展开后的主日历事件实例。'
        ),
        'access-token': contribution(
          'Google 日历 OAuth 访问令牌',
          '请手动完成生产 OAuth 同意流程和敏感 scope 验证后粘贴访问令牌；最小 scope：https://www.googleapis.com/auth/calendar.events.readonly。发布验证仍是人工 TODO。'
        )
      }
    ),
    'open-pencil.sharepoint': plugin(
      'SharePoint 根站点',
      '通过受审核的只读连接器读取 Microsoft Graph 中 SharePoint 根站点的基本元数据。',
      {
        'sharepoint.root-site': contribution(
          'SharePoint 根站点',
          '仅使用固定的 Microsoft Graph API 读取租户根站点身份。'
        ),
        'get-root-site': contribution('读取根站点', '读取租户根站点的基本身份，不遍历文档库。'),
        'access-token': contribution(
          'Microsoft Graph 访问令牌',
          '请手动完成 Microsoft Entra 应用注册和租户同意后粘贴令牌；最小 scope：Sites.Read.All。首版仅读取根站点元数据。'
        )
      }
    ),
    'open-pencil.outlook-email': plugin(
      'Outlook 邮件文件夹',
      '通过受审核的只读连接器列出 Outlook 邮件文件夹元数据，不会读取或发送邮件正文。',
      {
        'outlook.mail-folders': contribution(
          'Outlook 邮件文件夹',
          '使用固定的 Microsoft Graph API 读取顶层邮件文件夹。'
        ),
        'list-mail-folders': contribution(
          '列出邮件文件夹',
          '列出当前用户的顶层邮件文件夹及有界数量元数据。'
        ),
        'access-token': contribution(
          'Microsoft Graph 访问令牌',
          '请粘贴 Microsoft Graph OAuth 访问令牌；最小 scope：Mail.ReadBasic。首版仅列出文件夹元数据，邮件正文和发送能力不会进入 MCP。'
        )
      }
    ),
    'open-pencil.outlook-calendar': plugin(
      'Outlook 日历事件',
      '通过受审核的只读连接器列出明确时间窗口内的 Outlook 基本事件实例。',
      {
        'outlook-calendar.events': contribution(
          'Outlook 日历事件',
          '使用固定的 Microsoft Graph API 读取默认日历事件。'
        ),
        'list-events': contribution('列出日历事件', '列出一页默认日历中的基本事件实例。'),
        'access-token': contribution(
          'Microsoft Graph 访问令牌',
          '请粘贴 Microsoft Graph OAuth 访问令牌；最小 scope：Calendars.ReadBasic。更丰富的日历内容不在此连接器授权范围内。'
        )
      }
    ),
    'open-pencil.teams': plugin(
      'Microsoft Teams 团队',
      '通过受审核的只读连接器列出当前工作或学校账户直接加入的团队。',
      {
        'teams.joined-teams': contribution(
          'Microsoft Teams 团队',
          '使用固定的 Microsoft Graph API 读取当前用户直接加入的团队。'
        ),
        'list-joined-teams': contribution('列出已加入团队', '列出当前用户直接加入的团队基本身份。'),
        'access-token': contribution(
          'Microsoft Graph 访问令牌',
          '请使用工作或学校 Microsoft 账户完成委托授权并粘贴令牌；最小 scope：Team.ReadBasic.All。此 scope 不适用于个人 Microsoft 账户。'
        )
      }
    ),
    'open-pencil.google-drive-storage': plugin(
      'Google Drive 存储',
      '通过宿主审核的 Google Drive 适配器保存和同步 OpenPencil 文档。',
      {
        'google-drive': contribution(
          'Google Drive',
          '读取、写入和删除文档，并支持变更跟踪与可恢复上传；OAuth 和网络请求仅由宿主管理。'
        )
      }
    ),
    'open-pencil.onedrive-storage': plugin(
      'OneDrive 存储',
      '通过宿主审核的 Microsoft OneDrive 适配器保存和同步 OpenPencil 文档。',
      {
        onedrive: contribution(
          'OneDrive',
          '读取、写入和移入回收站，并支持可恢复上传；OAuth 和网络请求仅由宿主管理。'
        )
      }
    ),
    'open-pencil.aliyun-drive-storage': plugin(
      '阿里云盘存储',
      '通过宿主审核的阿里云盘适配器保存和同步 OpenPencil 文档。',
      {
        'aliyun-drive': contribution(
          '阿里云盘',
          '读取、写入和移入回收站，并支持可恢复上传；OAuth 和网络请求仅由宿主管理。'
        )
      }
    ),
    'open-pencil.baidu-netdisk-storage': plugin(
      '百度网盘存储',
      '通过宿主审核的百度网盘适配器保存和同步 OpenPencil 文档。',
      {
        'baidu-netdisk': contribution(
          '百度网盘',
          '读取、写入和移入回收站，并支持可恢复上传；OAuth 和网络请求仅由宿主管理。'
        )
      }
    )
  })

/**
 * Host-owned Simplified Chinese copy for bundled module property fields and select options.
 *
 * These keys are presentation-only and deliberately live outside signed plugin manifests. Select
 * option keys include their field identity so values such as `none` cannot acquire an unrelated
 * meaning in another module.
 */
const ZH_CN_BUNDLED_MODULE_PROPERTY_TEXT: Readonly<Partial<Record<string, string>>> = Object.freeze(
  {
    'lowcodeModuleFieldModalFooterAlign:left': '左对齐',
    'lowcodeModuleFieldModalFooterAlign:center': '居中对齐',
    'lowcodeModuleFieldModalFooterAlign:right': '右对齐',

    lowcodeModuleFieldDropdownMenuTriggerLabel: '触发文字',
    lowcodeModuleFieldDropdownMenuShowTriggerLabel: '显示触发文字',
    lowcodeModuleFieldDropdownMenuShowTriggerChevron: '显示触发箭头',
    lowcodeModuleFieldDropdownMenuTriggerMode: '触发方式',
    lowcodeModuleFieldDropdownMenuPlacement: '弹出位置',
    lowcodeModuleFieldDropdownMenuItems: '菜单条目',
    lowcodeModuleFieldDropdownMenuCloseOnSelect: '选择后关闭',
    lowcodeModuleFieldDropdownMenuCloseOnEscape: '按 Escape 关闭',
    lowcodeModuleFieldDropdownMenuCloseOnOutsidePress: '点击外部关闭',
    lowcodeModuleFieldDropdownMenuMenuWidth: '菜单宽度',
    lowcodeModuleFieldDropdownMenuTriggerBackground: '触发按钮背景',
    lowcodeModuleFieldDropdownMenuTriggerTextColor: '触发按钮文字颜色',
    lowcodeModuleFieldDropdownMenuMenuBackground: '菜单背景',
    lowcodeModuleFieldDropdownMenuItemTextColor: '菜单项文字颜色',
    lowcodeModuleFieldDropdownMenuAccentColor: '强调颜色',
    lowcodeModuleFieldDropdownMenuDangerColor: '危险项颜色',
    lowcodeModuleFieldUploadButtonTriggerLabel: '触发文字',
    lowcodeModuleFieldUploadButtonShowTriggerIcon: '显示触发图标',
    lowcodeModuleFieldUploadButtonShowTriggerLabel: '显示触发文字',
    lowcodeModuleFieldUploadButtonAccept: '允许的文件类型',
    lowcodeModuleFieldUploadButtonMultiple: '允许多个文件',
    lowcodeModuleFieldUploadButtonMaxFiles: '最大文件数',
    lowcodeModuleFieldUploadButtonMaxFileBytes: '单文件最大字节数',
    lowcodeModuleFieldUploadButtonAllowDrop: '允许拖放',
    lowcodeModuleFieldUploadButtonShowFileList: '显示已选文件',
    lowcodeModuleFieldUploadButtonHelperText: '帮助文字',
    lowcodeModuleFieldUploadButtonButtonBackground: '按钮背景',
    lowcodeModuleFieldUploadButtonButtonTextColor: '按钮文字颜色',
    lowcodeModuleFieldUploadButtonAccentColor: '强调颜色',
    lowcodeModuleFieldUploadButtonErrorColor: '错误颜色',

    'lowcodeModuleFieldDropdownMenuTriggerMode:click': '点击',
    'lowcodeModuleFieldDropdownMenuTriggerMode:hover': '悬停',
    'lowcodeModuleFieldDropdownMenuPlacement:bottomLeft': '下方左对齐',
    'lowcodeModuleFieldDropdownMenuPlacement:bottom': '下方居中',
    'lowcodeModuleFieldDropdownMenuPlacement:bottomRight': '下方右对齐',
    'lowcodeModuleFieldDropdownMenuPlacement:topLeft': '上方左对齐',
    'lowcodeModuleFieldDropdownMenuPlacement:top': '上方居中',
    'lowcodeModuleFieldDropdownMenuPlacement:topRight': '上方右对齐',
    'lowcodeModuleFieldDropdownMenuPlacement:leftTop': '左侧顶部对齐',
    'lowcodeModuleFieldDropdownMenuPlacement:left': '左侧居中',
    'lowcodeModuleFieldDropdownMenuPlacement:leftBottom': '左侧底部对齐',
    'lowcodeModuleFieldDropdownMenuPlacement:rightTop': '右侧顶部对齐',
    'lowcodeModuleFieldDropdownMenuPlacement:right': '右侧居中',
    'lowcodeModuleFieldDropdownMenuPlacement:rightBottom': '右侧底部对齐',

    lowcodeModuleFieldTabsLabel: '无障碍标签',
    lowcodeModuleFieldTabsItems: '标签页项目',
    lowcodeModuleFieldTabsInitialTab: '初始标签页',
    lowcodeModuleFieldTabsOrientation: '排列方向',
    lowcodeModuleFieldTabsActivation: '激活方式',
    lowcodeModuleFieldTabsDivider: '显示分隔线',
    lowcodeModuleFieldTabsBackground: '背景颜色',
    lowcodeModuleFieldTabsTextColor: '文字颜色',
    lowcodeModuleFieldTabsAccentColor: '强调颜色',
    lowcodeModuleFieldTabsFontSize: '字号',

    lowcodeModuleFieldAccordionLabel: '无障碍标签',
    lowcodeModuleFieldAccordionItems: '折叠面板项目',
    lowcodeModuleFieldAccordionMultiple: '允许同时展开多项',
    lowcodeModuleFieldAccordionInitialOpen: '初始展开项目',
    lowcodeModuleFieldAccordionDividers: '显示分隔线',
    lowcodeModuleFieldAccordionBackground: '背景颜色',
    lowcodeModuleFieldAccordionTextColor: '文字颜色',
    lowcodeModuleFieldAccordionAccentColor: '强调颜色',
    lowcodeModuleFieldAccordionFontSize: '字号',

    lowcodeModuleFieldQrBarcodeFormat: '编码格式',
    lowcodeModuleFieldQrBarcodeValue: '编码内容',
    lowcodeModuleFieldQrBarcodeCaption: '说明文字',
    lowcodeModuleFieldQrBarcodeShowCaption: '显示说明文字',
    lowcodeModuleFieldQrBarcodeErrorCorrection: '容错级别',
    lowcodeModuleFieldQrBarcodeQuietZone: '静区宽度',
    lowcodeModuleFieldQrBarcodeForeground: '前景颜色',
    lowcodeModuleFieldQrBarcodeBackground: '背景颜色',

    lowcodeModuleFieldMarkdownSource: 'Markdown 内容',
    lowcodeModuleFieldMarkdownFlavor: '语法规范',
    lowcodeModuleFieldMarkdownLinkTarget: '链接打开方式',
    lowcodeModuleFieldMarkdownBackground: '背景颜色',
    lowcodeModuleFieldMarkdownTextColor: '文字颜色',
    lowcodeModuleFieldMarkdownHeadingColor: '标题颜色',
    lowcodeModuleFieldMarkdownAccentColor: '强调颜色',
    lowcodeModuleFieldMarkdownFontSize: '字号',
    lowcodeModuleFieldMarkdownLineHeight: '行高',

    lowcodeModuleFieldCodeBlockLabel: '无障碍标签',
    lowcodeModuleFieldCodeBlockCode: '代码内容',
    lowcodeModuleFieldCodeBlockLanguage: '代码语言',
    lowcodeModuleFieldCodeBlockTheme: '显示主题',
    lowcodeModuleFieldCodeBlockLineNumbers: '显示行号',
    lowcodeModuleFieldCodeBlockWrapLines: '自动换行',
    lowcodeModuleFieldCodeBlockCopyButton: '显示复制按钮',
    lowcodeModuleFieldCodeBlockFontSize: '字号',
    lowcodeModuleFieldCodeBlockTabSize: '制表符宽度',
    lowcodeModuleFieldCodeBlockBackground: '背景颜色',
    lowcodeModuleFieldCodeBlockTextColor: '文字颜色',
    lowcodeModuleFieldCodeBlockAccentColor: '强调颜色',

    lowcodeModuleFieldPdfViewerSource: 'PDF 来源',
    lowcodeModuleFieldPdfViewerTitle: '文档标题',
    lowcodeModuleFieldPdfViewerInitialPage: '初始页码',
    lowcodeModuleFieldPdfViewerPageCount: '预计总页数',
    lowcodeModuleFieldPdfViewerFit: '适配方式',
    lowcodeModuleFieldPdfViewerToolbar: '显示工具栏',
    lowcodeModuleFieldPdfViewerDownload: '允许下载',
    lowcodeModuleFieldPdfViewerBackground: '背景颜色',
    lowcodeModuleFieldPdfViewerAccentColor: '强调颜色',

    lowcodeModuleFieldAudioPlayerSource: '音频来源',
    lowcodeModuleFieldAudioPlayerTitle: '音频标题',
    lowcodeModuleFieldAudioPlayerArtist: '艺术家',
    lowcodeModuleFieldAudioPlayerControls: '显示播放控件',
    lowcodeModuleFieldAudioPlayerAutoplay: '自动播放',
    lowcodeModuleFieldAudioPlayerLoop: '循环播放',
    lowcodeModuleFieldAudioPlayerMuted: '默认静音',
    lowcodeModuleFieldAudioPlayerPreload: '预加载方式',
    lowcodeModuleFieldAudioPlayerVolume: '初始音量',
    lowcodeModuleFieldAudioPlayerPlaybackRate: '播放速度',
    lowcodeModuleFieldAudioPlayerBackground: '背景颜色',
    lowcodeModuleFieldAudioPlayerTextColor: '文字颜色',
    lowcodeModuleFieldAudioPlayerAccentColor: '强调颜色',

    'lowcodeModuleFieldTabsOrientation:horizontal': '横向排列',
    'lowcodeModuleFieldTabsOrientation:vertical': '纵向排列',
    'lowcodeModuleFieldTabsActivation:automatic': '自动激活',
    'lowcodeModuleFieldTabsActivation:manual': '手动激活',
    'lowcodeModuleFieldQrBarcodeFormat:qr': '二维码（QR）',
    'lowcodeModuleFieldQrBarcodeFormat:code128': 'Code 128 条形码',
    'lowcodeModuleFieldQrBarcodeErrorCorrection:low': '低容错',
    'lowcodeModuleFieldQrBarcodeErrorCorrection:medium': '中等容错',
    'lowcodeModuleFieldQrBarcodeErrorCorrection:quartile': '较高容错',
    'lowcodeModuleFieldQrBarcodeErrorCorrection:high': '高容错',
    'lowcodeModuleFieldMarkdownFlavor:commonmark': 'CommonMark（标准语法）',
    'lowcodeModuleFieldMarkdownFlavor:gfm': 'GFM（GitHub 扩展语法）',
    'lowcodeModuleFieldMarkdownLinkTarget:same-tab': '当前标签页',
    'lowcodeModuleFieldMarkdownLinkTarget:new-tab': '新标签页',
    'lowcodeModuleFieldCodeBlockLanguage:plaintext': '纯文本',
    'lowcodeModuleFieldCodeBlockLanguage:javascript': 'JavaScript（脚本）',
    'lowcodeModuleFieldCodeBlockLanguage:typescript': 'TypeScript（类型脚本）',
    'lowcodeModuleFieldCodeBlockLanguage:json': 'JSON（数据）',
    'lowcodeModuleFieldCodeBlockLanguage:html': 'HTML（网页标记）',
    'lowcodeModuleFieldCodeBlockLanguage:css': 'CSS（样式表）',
    'lowcodeModuleFieldCodeBlockLanguage:bash': 'Bash（命令行）',
    'lowcodeModuleFieldCodeBlockLanguage:python': 'Python（脚本）',
    'lowcodeModuleFieldCodeBlockLanguage:rust': 'Rust（系统语言）',
    'lowcodeModuleFieldCodeBlockLanguage:dart': 'Dart（应用语言）',
    'lowcodeModuleFieldCodeBlockTheme:light': '浅色主题',
    'lowcodeModuleFieldCodeBlockTheme:dark': '深色主题',
    'lowcodeModuleFieldPdfViewerFit:width': '适应宽度',
    'lowcodeModuleFieldPdfViewerFit:page': '适应整页',
    'lowcodeModuleFieldAudioPlayerPreload:none': '不预加载',
    'lowcodeModuleFieldAudioPlayerPreload:metadata': '仅预加载元数据'
  }
)

const DEFAULT_MODULE_EDITOR_TEXT: AppPluginModuleEditorText = Object.freeze({
  addItem: 'Add item',
  removeItem: 'Remove',
  identifier: 'Identifier',
  title: 'Title',
  content: 'Content',
  newTab: 'New tab',
  newSection: 'New section',
  count: (current: number, maximum: number) => `${current}/${maximum}`,
  item: (index: number) => `Item ${index}`
})

const ZH_CN_MODULE_EDITOR_TEXT: AppPluginModuleEditorText = Object.freeze({
  addItem: '添加项目',
  removeItem: '删除',
  identifier: '标识符',
  title: '标题',
  content: '内容',
  newTab: '新标签页',
  newSection: '新分区',
  count: (current: number, maximum: number) => `${current}/${maximum} 项`,
  item: (index: number) => `第 ${index} 项`
})

export function localizedAppPluginText(
  pluginId: string,
  locale: Locale | 'en-US'
): AppPluginLocalizedText | undefined {
  return locale === 'zh-CN' ? ZH_CN_BUNDLED_PLUGIN_TEXT[pluginId] : undefined
}

export function localizedAppPluginContributionText(
  pluginId: string,
  contributionId: string,
  locale: Locale | 'en-US'
): AppPluginLocalizedContributionText | undefined {
  return localizedAppPluginText(pluginId, locale)?.contributions[contributionId]
}

export function bundledPluginLocalizedSearchText(pluginId: string): string {
  const text = ZH_CN_BUNDLED_PLUGIN_TEXT[pluginId]
  if (!text) return ''
  return [
    text.name,
    text.description,
    ...Object.values(text.contributions).flatMap((item) => [item.name, item.description])
  ].join('\n')
}

export function appPluginModuleEditorText(locale: Locale): AppPluginModuleEditorText {
  return locale === 'zh-CN' ? ZH_CN_MODULE_EDITOR_TEXT : DEFAULT_MODULE_EDITOR_TEXT
}

export function localizedAppPluginModulePropertyText(
  key: string,
  locale: Locale
): string | undefined {
  return locale === 'zh-CN' ? ZH_CN_BUNDLED_MODULE_PROPERTY_TEXT[key] : undefined
}
