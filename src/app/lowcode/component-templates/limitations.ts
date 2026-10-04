type LocalizedLimitation = readonly [english: string, chinese: string]
const BASE: readonly LocalizedLimitation[] = [
  [
    'Local runtime example only; no account, backend or persistence.',
    '仅本次运行的本地示例；未连接账户、后端或持久化。'
  ],
  [
    'Insert on an ordinary page or editable frame, outside component masters and instances.',
    '插入普通页面或可编辑框架；不能直接插入组件主组件或实例内部。'
  ]
]
const MODULE_LIMITATIONS: Readonly<Record<string, LocalizedLimitation>> = {
  stepper: [
    'Current step is writable numeric page state, starting from 0. Step changes do not validate, submit, navigate or run a workflow; review state references before moving across pages.',
    '当前步骤为可写数字页面状态，从 0 开始。切换不校验、提交、跳转或执行工作流；跨页移动前请检查状态引用。'
  ],
  cascader: [
    'Up to 128 local items and 6 levels. Selecting a leaf writes a complete path array; no remote loading, multiple selection or automatic submission.',
    '最多 128 个本地条目、6 层；选择叶节点后写入完整路径数组，不远程加载、不支持多选、不自动提交。'
  ],
  walktour: [
    'Starts manually and targets only uniquely named direct children. Missing or hidden targets use a centered overview with a notice. No remote data, completion persistence or FORM submission.',
    '手动启动，仅定位名称唯一的直属子图层；目标缺失或隐藏时居中显示并提示。不获取远程数据，不持久化完成状态或提交表单。'
  ],
  'org-chart': [
    'Static local hierarchy, up to 64 items and 8 levels. Branch folding is runtime-only; no remote data, business-state binding or FORM submission.',
    '固定本地层级，最多 64 项、8 层；折叠仅保留在本次运行，未连接远程数据、业务状态绑定或表单提交。'
  ],
  pagination: [
    'Controls a numeric page state. Total and page size may read state or expressions; no fetching, server pagination or FORM submission.',
    '控制数字页码状态；总数和每页条数可读取状态或表达式，不获取数据、不执行服务端分页或表单提交。'
  ],
  descriptions: [
    'Authored display text only; no field binding, data fetching or form submission.',
    '仅展示编写的文本；未绑定业务字段，不获取数据或提交表单。'
  ],
  chart: [
    'Static single series, up to 64 points; no remote data. Pie and donut require nonnegative values.',
    '静态单序列，最多 64 项；未连接远程数据。饼图和环形图仅接受非负数。'
  ],
  markdown: [
    'Canvas is a static summary; use compiled preview for full CommonMark/GFM layout. HTML is inert and images do not load automatically.',
    '画布为静态摘要；完整 CommonMark/GFM 排版请查看编译预览。HTML 不执行，图片不自动加载。'
  ],
  'code-block': [
    'Displays source without execution; copying requires browser clipboard permission.',
    '只展示源码，不执行；复制需要浏览器剪贴板权限。'
  ],
  'upload-button': ['Selects files; does not upload.', '只选择文件，不自动上传。'],
  tree: [
    'Static local hierarchy, up to 128 items and 6 levels; selection is independent without parent-child cascading or remote loading.',
    '固定本地层级，最多 128 项、6 层；多选彼此独立，不级联选中父子节点，也不远程加载。'
  ],
  popover: [
    'Confirmation only changes the local status; it does not delete, save, request the network or submit a business form.',
    '确认只改变本次运行的提示状态；不会删除、保存、请求网络或提交业务表单。'
  ]
}
const INPUT_LIMITATIONS: Readonly<Partial<Record<string, LocalizedLimitation>>> = {
  'color-picker': [
    'Six-digit hexadecimal RGB only; no alpha or wide-gamut colors. Native picker appearance varies by browser.',
    '仅支持六位十六进制颜色，不含透明度或广色域；原生选色器外观随浏览器不同。'
  ],
  autocomplete: [
    'Suggestions are local; free text is allowed. No remote search or location service.',
    '建议来自本地列表，允许自由输入；未连接远程搜索或定位服务。'
  ],
  'time-picker': [
    'A local wall-clock string, without a date or timezone conversion; native picker appearance varies by browser.',
    '本地时刻字符串，不含日期或时区转换；原生选择器外观随浏览器不同。'
  ],
  'date-time-picker': [
    'A local date-time string without timezone conversion; native picker appearance varies by browser.',
    '本地日期时间字符串，不做时区转换；原生选择器外观随浏览器不同。'
  ],
  'number-input': [
    'This template binds a string so empty input stays empty. Numeric bindings retain their existing conversion rules.',
    '此模板绑定字符串，清空后保留空值；数字类型绑定沿用既有转换规则。'
  ],
  'password-input': [
    'Starts empty, without a plaintext value summary. A form field is not a credential vault; do not store real passwords in the design.',
    '初值为空，不展示明文值摘要。普通表单字段不是凭据保险库，请勿在设计文档中保存真实密码。'
  ]
}
const COMPOSITION_LIMITATIONS: Readonly<Partial<Record<string, LocalizedLimitation>>> = {
  'stepper-form': [
    'Each visible form validates before advancing. Back preserves the draft; Start again explicitly clears it. Completion does not revalidate hidden steps or save to a server.',
    '可见步骤由自己的表单校验后推进；返回保留草稿，开始重填明确清空草稿。完成时不重新校验隐藏步骤，也不保存到服务器。'
  ],
  'drawer-details': [
    'The editable drawer form changes local draft state. Reset restores authored defaults; closing preserves the draft and does not save it. Submission stays open.',
    '可编辑抽屉表单只修改本地草稿；重置恢复编写的初值，关闭保留草稿且不保存。提交后抽屉保持打开。'
  ],
  'admin-shell': [
    'Local section switching and sample members only; configure real routes, access control and data services separately.',
    '仅切换本地区域并展示示例成员；真实路由、权限与数据服务需另外配置。'
  ]
}
export function componentTemplateLimitations(
  id: string,
  moduleType: string | undefined,
  zh: boolean
): string[] {
  const localized = (copy: LocalizedLimitation) => copy[zh ? 1 : 0]
  const result = BASE.map(localized)
  const module = moduleType ? MODULE_LIMITATIONS[moduleType] : undefined
  if (module) result.push(localized(module))
  if (
    ['validated-form', 'dialog-form', 'tabs-details', 'stepper-form', 'drawer-details'].includes(id)
  )
    result.push(
      localized([
        'Contains a form; cannot be nested inside an existing form.',
        '含表单，不能嵌入已有表单内部。'
      ])
    )
  const composition = COMPOSITION_LIMITATIONS[id]
  if (composition) result.push(localized(composition))
  const input = INPUT_LIMITATIONS[id]
  if (input) result.push(localized(input))
  if (id === 'multi-select')
    result.push(
      localized([
        'Selections are a page-state array; review references before moving across pages or creating a component.',
        '多选值存为页面状态数组；跨页或转为组件前请检查状态引用。'
      ])
    )
  if (['slider', 'range-slider', 'rating', 'date-range'].includes(id))
    result.push(
      localized([
        'Values use independent page state. Configure FORM validation and submission separately; no remote data or persistence.',
        '各端点绑定独立页面状态；FORM 校验和提交需另外配置，不连接远程数据或持久化。'
      ])
    )
  return result
}
