import { COMPOSITION_DEFINITIONS } from './combinations/metadata'
import { componentTemplateLimitations } from './limitations'

export const COMPONENT_TEMPLATE_IDS = [
  'button',
  'input',
  'textarea',
  'select',
  'checkbox',
  'switch',
  'radio',
  'datepicker',
  'card',
  'divider',
  'upload',
  'data-grid',
  'slider',
  'range-slider',
  'rating',
  'stepper',
  'breadcrumb',
  'alert',
  'progress',
  'circular-progress',
  'chip',
  'avatar',
  'badge',
  'dot-badge',
  'timeline',
  'tooltip',
  'skeleton',
  'empty-state',
  'empty-search',
  'bar-chart',
  'line-chart',
  'area-chart',
  'pie-chart',
  'donut-chart',
  'markdown-note',
  'markdown-table',
  'code-block',
  'multi-select',
  'autocomplete',
  'time-picker',
  'date-range',
  'tree',
  'tree-select',
  'popover',
  'popconfirm',
  'date-time-picker',
  'number-input',
  'password-input',
  'color-picker',
  'descriptions',
  'pagination',
  'org-chart',
  'walktour',
  'cascader',
  'search-toolbar',
  'validated-form',
  'settings-card',
  'dialog-form',
  'tabs-details',
  'filterable-table',
  'accordion-faq',
  'paginated-list',
  'stepper-form',
  'tree-details',
  'drawer-details',
  'admin-shell'
] as const

export type ComponentTemplateId = (typeof COMPONENT_TEMPLATE_IDS)[number]
export type ComponentTemplateKind = 'basic' | 'combination'
export interface ComponentTemplateModule {
  readonly pluginId: string
  readonly moduleType: string
}
export interface ComponentTemplateItem {
  readonly id: ComponentTemplateId
  readonly kind: ComponentTemplateKind
  readonly category: 'input' | 'content' | 'data' | 'feedback' | 'navigation'
  readonly name: string
  readonly description: string
  readonly keywords: readonly string[]
  readonly targets: readonly ['react', 'vue']
  readonly limitations: readonly string[]
  readonly requiredModules: readonly ComponentTemplateModule[]
}

type Definition = readonly [
  ComponentTemplateItem['category'],
  string,
  string,
  string,
  string,
  string?
]
const DEFINITIONS: Record<ComponentTemplateId, Definition> = {
  ...COMPOSITION_DEFINITIONS,
  walktour: [
    'navigation',
    'Guided Tour',
    '操作引导',
    'Start a local guided tour over three editable content cards.',
    '手动启动本地引导，依次介绍三张可编辑内容卡片。',
    'walktour'
  ],
  'org-chart': [
    'data',
    'Organization chart',
    '组织架构图',
    'Edit a local team hierarchy and fold its branches in preview.',
    '编辑本地团队层级，在预览中折叠分支。',
    'org-chart'
  ],
  pagination: [
    'navigation',
    'Pagination',
    '分页',
    'Change a numeric page state with local page controls.',
    '通过分页控件改变本地数字页码状态。',
    'pagination'
  ],
  'paginated-list': [
    'data',
    'Paginated list',
    '分页列表',
    'Browse local editable records through a shared page state.',
    '通过共享页码状态浏览可编辑的本地记录。',
    'pagination'
  ],
  button: [
    'input',
    'Action button',
    '操作按钮',
    'Click updates a local counter.',
    '点击更新本地计数。'
  ],
  input: [
    'input',
    'Text field',
    '单行输入',
    'Editable field, label and current value.',
    '可编辑字段、标签与当前值。'
  ],
  textarea: [
    'input',
    'Multiline field',
    '多行输入',
    'A bounded note with value feedback.',
    '有长度限制的备注与值反馈。'
  ],
  select: [
    'input',
    'Select field',
    '下拉选择',
    'Separate labels and values, including a disabled option.',
    '分离标签与值，包含禁用选项。'
  ],
  checkbox: [
    'input',
    'Checkbox',
    '复选框',
    'A controlled boolean with visible feedback.',
    '受控布尔状态与可见反馈。'
  ],
  switch: [
    'input',
    'Switch',
    '开关',
    'A controlled setting with visible on/off state.',
    '受控设置与可见开关状态。'
  ],
  radio: [
    'input',
    'Radio group',
    '单选组',
    'Named exclusive options and selected value.',
    '有名称的互斥选项与当前选择。'
  ],
  datepicker: [
    'input',
    'Date field',
    '日期选择',
    'Native date input with a bounded example range.',
    '带示例日期范围的原生日期输入。'
  ],
  card: [
    'content',
    'Content card',
    '内容卡片',
    'Editable title, description and supporting text.',
    '可编辑标题、说明与辅助文本。'
  ],
  divider: [
    'content',
    'Section divider',
    '分区标题与分隔线',
    'A heading, separator and explanatory text.',
    '标题、分隔线与说明文本。'
  ],
  upload: [
    'input',
    'Local file picker',
    '本地文件选择',
    'Select, validate, clear and disable local files.',
    '本地文件选择、校验、清空与禁用。',
    'upload-button'
  ],
  'data-grid': [
    'data',
    'Local data grid',
    '本地数据表格',
    'Sort, filter and select a small sample dataset.',
    '对少量示例数据排序、筛选和选择。',
    'data-grid'
  ],
  slider: [
    'input',
    'Slider',
    '滑块',
    'A numeric slider with bounds, keyboard control and page-state feedback.',
    '可设置范围、支持键盘操作与本地值反馈的数值滑块。',
    'slider'
  ],
  'range-slider': [
    'input',
    'Range slider',
    '范围滑块',
    'Two bounded handles for an independent local range.',
    '两个滑块选择独立的本地区间。',
    'slider'
  ],
  rating: [
    'input',
    'Star rating',
    '星级评分',
    'Half-star input, keyboard control and a clear action.',
    '支持半星、键盘操作与清空的评分控件。',
    'rating'
  ],
  stepper: [
    'navigation',
    'Stepper',
    '步骤条',
    'A bound current step with previous, next and reset buttons.',
    '当前步骤绑定页面状态，包含上一步、下一步与重置按钮。',
    'stepper'
  ],
  breadcrumb: [
    'navigation',
    'Breadcrumb',
    '面包屑',
    'A page hierarchy with editable labels and optional safe links.',
    '可编辑标签与可选安全链接的页面层级。',
    'breadcrumb'
  ],
  alert: [
    'feedback',
    'Status message',
    '提示条',
    'Semantic message with optional dismissal.',
    '带语义色与关闭操作的消息提示。',
    'alert'
  ],
  progress: [
    'feedback',
    'Linear progress',
    '条形进度',
    'Configured progress with a clear percentage.',
    '带百分比的配置进度展示。',
    'progress'
  ],
  'circular-progress': [
    'feedback',
    'Circular progress',
    '环形进度',
    'Compact progress ring with an accessible label.',
    '带无障碍标签的紧凑环形进度。',
    'progress'
  ],
  chip: [
    'feedback',
    'Interactive label',
    '交互标签',
    'A selectable and removable label.',
    '可选择与移除的标签。',
    'chip'
  ],
  avatar: [
    'content',
    'Avatar',
    '头像',
    'Local image or readable initials with an accessible name.',
    '本地图片或姓名回退，支持无障碍名称。',
    'avatar'
  ],
  badge: [
    'feedback',
    'Count badge',
    '数字角标',
    'A text host with an authored count and overflow limit.',
    '文字宿主上的示例数量与溢出上限。',
    'badge'
  ],
  'dot-badge': [
    'feedback',
    'Dot badge',
    '圆点角标',
    'A decorative dot attached to a text host.',
    '文字宿主上的装饰圆点。',
    'badge'
  ],
  timeline: [
    'content',
    'Timeline',
    '时间线',
    'Ordered editable events with time text and status.',
    '按顺序展示可编辑事件、时间文字与状态。',
    'timeline'
  ],
  tooltip: [
    'feedback',
    'Contextual hint',
    '提示说明',
    'Focus or hover the trigger to read a plain-text hint.',
    '聚焦或悬停触发器，查看纯文本补充说明。',
    'tooltip'
  ],
  skeleton: [
    'feedback',
    'Loading placeholder',
    '加载占位',
    'Configurable placeholder lines with reduced-motion support.',
    '可配置占位行，尊重减少动态效果设置。',
    'skeleton'
  ],
  'empty-state': [
    'content',
    'Empty content',
    '内容空状态',
    'An editable illustration, title and explanation.',
    '可编辑的示意图、标题与说明。',
    'empty-state'
  ],
  'empty-search': [
    'content',
    'No search results',
    '搜索无结果',
    'An authored empty-search message; connect visibility to your own data.',
    '预设搜索空状态；按业务数据配置显示条件。',
    'empty-state'
  ],
  'bar-chart': [
    'data',
    'Bar chart',
    '柱状图',
    'Compare local values on a zero baseline.',
    '在零基线上比较本地数值。',
    'chart'
  ],
  'line-chart': [
    'data',
    'Line chart',
    '折线图',
    'Show a local series including positive and negative values.',
    '展示含正负值的本地数据序列。',
    'chart'
  ],
  'area-chart': [
    'data',
    'Area chart',
    '面积图',
    'Fill a local series back to its zero baseline.',
    '将本地序列与零基线之间的区域填色。',
    'chart'
  ],
  'pie-chart': [
    'data',
    'Pie chart',
    '饼图',
    'Compare nonnegative shares with a readable legend.',
    '以清晰图例展示非负数值的占比。',
    'chart'
  ],
  'donut-chart': [
    'data',
    'Donut chart',
    '环形图',
    'A circular local-data summary with a legend.',
    '带图例的本地数据环形汇总。',
    'chart'
  ],
  'markdown-note': [
    'content',
    'Markdown note',
    'Markdown 说明',
    'Editable headings, lists and quotations.',
    '可编辑的标题、列表与引用。',
    'markdown'
  ],
  'markdown-table': [
    'content',
    'Markdown checklist',
    'Markdown 清单',
    'A GFM table and task list with local source.',
    '使用本地源码的 GFM 表格与任务列表。',
    'markdown'
  ],
  'code-block': [
    'content',
    'Code example',
    '代码示例',
    'Copyable code with line numbers and wrapping.',
    '带行号、换行与复制功能的代码展示。',
    'code-block'
  ],
  'multi-select': [
    'input',
    'Multiple select',
    '多选下拉',
    'Searchable choices bound to an independent page-state array.',
    '可搜索的多选项，绑定独立页面数组状态。'
  ],
  autocomplete: [
    'input',
    'Autocomplete',
    '自动完成',
    'Free text with local suggestions and an independent string binding.',
    '自由输入与本地建议，绑定独立字符串状态。'
  ],
  'time-picker': [
    'input',
    'Time picker',
    '时间选择',
    'Local wall-clock time with bounds, step and an independent string binding.',
    '本地时间选择，支持范围、步长与独立字符串绑定。'
  ],
  'date-range': [
    'input',
    'Date range',
    '日期范围',
    'Two page-state calendar values with range checks and a clear action.',
    '两个本地日期值，支持范围校验与清空。',
    'date-range'
  ],
  tree: [
    'navigation',
    'Tree',
    '树形列表',
    'Search, expand and select local items with a page array state.',
    '搜索、展开和多选本地条目，绑定页面数组状态。',
    'tree'
  ],
  cascader: [
    'input',
    'Cascader',
    '级联选择',
    'Choose a leaf from a local hierarchy and bind its complete path.',
    '从本地层级选择叶节点，并将完整路径绑定到页面状态。',
    'cascader'
  ],
  'tree-select': [
    'input',
    'Tree select',
    '树形选择',
    'Choose from a searchable local hierarchy with a page string state.',
    '从可搜索的本地层级单选条目，绑定页面字符串状态。',
    'tree'
  ],
  popover: [
    'feedback',
    'Popover',
    '气泡卡片',
    'A click-open panel with editable supporting text.',
    '点击打开包含可编辑说明的浮层。',
    'popover'
  ],
  popconfirm: [
    'feedback',
    'Local confirmation',
    '气泡确认',
    'Confirm or cancel a local example without business side effects.',
    '确认或取消本地示例，不执行业务操作。',
    'popover'
  ],
  'date-time-picker': [
    'input',
    'Date and time picker',
    '日期时间选择',
    'A local date and time with limits, a second-based step and string binding.',
    '本地日期与时间，支持范围、秒数步长和字符串绑定。'
  ],
  'number-input': [
    'input',
    'Number input',
    '数字输入',
    'An editable quantity with stepper buttons and an empty-friendly string binding.',
    '可编辑数量与增减按钮，字符串绑定保留空输入。'
  ],
  'password-input': [
    'input',
    'Password input',
    '密码输入',
    'An empty password field with an optional reveal button; no credential storage.',
    '空密码字段与可选显隐按钮，不保存凭据。'
  ],
  'color-picker': [
    'input',
    'Color picker',
    '颜色选择',
    'Choose a six-digit color with a native picker and string state.',
    '原生选色器与六位颜色值，支持字符串状态绑定。'
  ],
  descriptions: [
    'content',
    'Descriptions',
    '详情列表',
    'Editable label and value pairs in a responsive detail grid.',
    '可编辑标签与内容，支持自适应分栏的详情网格。',
    'descriptions'
  ],
  'search-toolbar': [
    'data',
    'Search and results',
    '搜索与结果',
    'Exact-name local search, empty state and reset.',
    '本地名称精确搜索、空状态与重置。'
  ],
  'validated-form': [
    'input',
    'Validated form',
    '校验表单',
    'Required name/email, validation and local submit feedback.',
    '必填姓名与邮箱、校验和本地提交反馈。'
  ],
  'settings-card': [
    'input',
    'Preferences card',
    '偏好设置卡片',
    'Independent switches, choices and a local save action.',
    '独立开关、选项与本地保存操作。'
  ],
  'dialog-form': [
    'feedback',
    'Editable dialog',
    '可编辑弹窗表单',
    'A named content slot with a validated form.',
    '命名内容插槽中的可校验表单。',
    'modal'
  ],
  'tabs-details': [
    'navigation',
    'Details with tabs',
    '分栏详情与表单',
    'Two editable content panels with an independent form.',
    '两个可编辑内容面板与独立表单。',
    'tabs'
  ],
  'filterable-table': [
    'data',
    'Table workbench',
    '表格工作区',
    'Selection feedback, column filters, pagination and CSV tools.',
    '选择反馈、列筛选、分页与 CSV 工具。',
    'data-grid'
  ],
  'accordion-faq': [
    'content',
    'Frequently asked questions',
    '常见问题',
    'Editable expandable answers with keyboard navigation.',
    '可编辑的折叠问答，支持键盘操作。',
    'accordion'
  ]
}

export function isComponentTemplateId(value: string): value is ComponentTemplateId {
  return Object.hasOwn(DEFINITIONS, value)
}

/** Bundled recipes are editable local examples, never remote executable libraries. */
export function getComponentTemplates(locale = 'en'): readonly ComponentTemplateItem[] {
  const zh = locale.toLowerCase().startsWith('zh')
  return COMPONENT_TEMPLATE_IDS.map((id, index) => {
    const [category, en, cn, description, translated, moduleType] = DEFINITIONS[id]
    return {
      id,
      kind: index < 54 ? 'basic' : 'combination',
      category,
      name: zh ? cn : en,
      description: zh ? translated : description,
      keywords: [id, en, cn, category],
      targets: ['react', 'vue'],
      limitations: componentTemplateLimitations(id, moduleType, zh),
      requiredModules: moduleType ? [{ pluginId: `open-pencil.${moduleType}`, moduleType }] : []
    }
  })
}
