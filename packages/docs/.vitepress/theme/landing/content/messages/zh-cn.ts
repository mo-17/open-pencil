import type { LandingMessages } from './types'

export const zhCn: LandingMessages = {
  hero: {
    title: '自由设计，不受平台束缚。',
    lede: '开源设计编辑器，直接打开 Figma 文件，在本机运行。你和 AI 智能体都能自由操作每一层。',
    open: '体验编辑器导览',
    download: '官方版下载',
    github: 'GitHub'
  },
  loading: '正在加载编辑器',
  features: {
    figma: {
      title: '直接打开已有设计',
      detail:
        'OpenPencil 原生读取 .fig 文件，将页面、组件、实例、变量和自动布局转为可编辑图层，也能保存回 .fig。粘贴 SVG 或打开 HTML 与 CSS，同样能得到按浏览器规则排版的图层。',
      hint: '这里展示的是编辑器自带的导览，一份真实的 .fig 文件。打开图层中的章节，即可探索。'
    },
    design: {
      title: '完整的设计工具',
      detail:
        '自动布局、约束、填充、描边、效果与文字排版，都有对应的编辑控件。组件支持插槽，让实例保留设计并填入自己的内容。所有操作都能撤销，无需等待服务器。',
      hint: '将指针移到选中的封面上，拖动角点调整圆角。其他播放器通过 Artwork 插槽使用各自的封面。'
    },
    interactive: {
      title: '真正可交互的组件',
      detail:
        '为组件添加开关、复选框、滑块、标签页或文本框等行为，预览便会将它作为真实的 Reka UI 控件运行。变体对应交互状态，同一组件还能导出为带可操作控件的 Storybook 故事。',
      hint: '当前画布处于预览模式：点击播放、拖动进度条或切换随机播放。退出预览后即可编辑。'
    },
    tokens: {
      title: '变量就是设计令牌',
      detail:
        '颜色、间距和文字样式存放在支持多模式的集合中，以设计令牌的形式编辑。导出代码将绑定值写为 CSS 自定义属性，让代码与设计使用同一套名称。',
      hint: '两个播放器分别使用 Theme 集合中的不同模式。修改令牌值，两者都会随之更新。'
    },
    shaders: {
      title: '会动的填充',
      detail:
        '着色器也是一种填充：可以在填充面板中选择、叠加效果、调整参数，或粘贴 shaders.com 的预设。文件会保留静态画面，方便在不同环境打开；预览模式则会播放效果。',
      hint: '当前画布处于预览模式，着色器会持续运行。退出预览，选中方块，即可编辑其填充。'
    },
    linting: {
      title: '设计检查',
      detail:
        'OpenPencil 在设计过程中检查对比度、过小的文字、默认名称、隐藏与空图层，以及多余的分组。问题会标在画布上，许多问题可以一键修复；CLI 和智能体也使用同一套规则。',
      hint: '点击画布上的问题标记，或从列表中应用修复。'
    },
    ai: {
      title: '用自己的密钥，让 AI 参与设计',
      detail:
        '用自然语言提出需求，智能体便会使用与你相同的工具编辑文档，并在生成过程中实时显示画布变化。你可以用自己的密钥连接模型提供商，也可以接入已有的编程智能体。',
      hint: '这里通过真实的智能体执行流程重放一轮对话，可以观察画布随生成过程逐步成形。'
    },
    collab: {
      title: '与同事和智能体共同编辑',
      detail:
        '分享链接，即可通过点对点连接共同编辑同一份文档，使用实时光标、跟随模式、图层评论和语音通话。AI 智能体也能加入房间，所有人都能看到它实时构建设计。',
      hint: '两块画布都可以操作。在一侧拖动图层，观察另一侧同步，再试着向智能体提问。'
    },
    code: {
      title: '从设计到代码',
      detail:
        '选区可以导出为 Vue 或 React 组件，以属性表示变体，并用 Reka UI 或 Radix 实现交互；也可以导出 HTML、Tailwind 和设计 JSX，将变量保留为令牌。组件支持导出 Storybook 故事，设计 JSX 则与画布图层关联，编辑代码即可更新画布。',
      hint: '切换到 React、HTML 或设计 JSX，也可以选中其他图层查看对应代码。'
    },
    script: {
      title: '通过脚本操作一切',
      detail:
        'openpencil CLI 既能在不打开应用时处理文件，也能控制正在运行的编辑器。检查文档、通过 XPath 查询、运行检查与导出，或使用 eval 执行 Figma 插件代码。MCP 服务器通过 stdio 或 HTTP 为智能体提供同样的操作能力。',
      hint: '运行命令，观察画布变化。'
    },
    sdk: {
      title: '嵌入自己的产品',
      detail:
        'OpenPencil 既是应用，也是工具包：包含不依赖界面框架的引擎、无头 Vue SDK，以及独立的场景图与文件格式包。你可以嵌入画布、在 CI 中渲染和检查设计，或基于同一引擎构建专用编辑器。本页的每块画布，都是运行在文档站点中的 SDK。',
      hint: '旁边的代码展示了挂载画布所需的全部步骤。'
    }
  },
  agents: {
    heading: '支持的智能体',
    rest: '以及任何 MCP 客户端'
  },
  commands: {
    cli: '{count} 个命令',
    mcp: '{count} 个 MCP 工具',
    mcpDetail: '创建、设置样式、布局、检查与导出，这些操作同样可供内置智能体使用。'
  },
  ownership: {
    title: '你的文件，由你掌控',
    items: [
      {
        title: '本地优先',
        detail: '文档就是磁盘上的文件，无需账号、服务器或网络连接。'
      },
      {
        title: '自己的存储',
        detail: '需要同步时，可以使用自己的 S3 兼容存储桶。'
      },
      {
        title: '开放格式',
        detail: '支持导出 .fig、PDF、PPTX、SVG、HTML 和 JSX，随时可以迁移。'
      },
      {
        title: 'MIT 许可',
        detail: '编辑器、渲染引擎、.fig 编解码器和 CLI 均开放源码。'
      }
    ]
  },
  roadmap: {
    title: '路线图',
    more: '完整路线图',
    shipped: {
      label: '已发布',
      entries: [
        { title: '交互组件与预览' },
        { title: '以变量管理设计令牌' },
        { title: '支持一键修复的设计检查' },
        { title: '支持跟随模式的 AI 协作' },
        { title: '回退、重新生成与编辑 AI 对话轮次' },
        { title: '代码与画布图层关联' },
        { title: '可视化差异与补丁' },
        { title: '共享房间中的评论与语音通话' },
        { title: '代码标签页中的 Vue 和 React 组件' },
        { title: '将 SVG 和 HTML 导入为可编辑图层' },
        { title: '着色器填充' },
        { title: 'W3C 设计令牌' },
        { title: '编辑器交互导览' },
        { title: '任意文字范围的列表与样式' }
      ]
    },
    now: {
      label: '进行中',
      entries: [
        {
          title: '从真实组件生成 Storybook',
          detail: '生成的故事在 Vue 中运行 Reka UI，在 React 中运行 Radix UI。'
        },
        {
          title: '组件创作',
          detail: '更高效地编辑变体，并在画布上选择组件内部内容。'
        }
      ]
    },
    next: {
      label: '下一步',
      lead: {
        title: '自行托管 OpenPencil',
        detail:
          '将整个工作区部署在自己的网络内，实现同步、分享、评论和团队组件库，无需将文件发送给外部服务。',
        features: [
          { title: '自己的存储', detail: '文档保存在自己的存储桶和指定区域。' },
          {
            title: '自己的身份系统',
            detail: '通过 OIDC 或 SSO 提供商登录，并管理角色。'
          },
          {
            title: '自己的网络',
            detail: '在防火墙内运行协作中继。'
          },
          {
            title: '自己的运维',
            detail: '提供部署、升级、备份与保留策略指引。'
          }
        ]
      },
      entries: [
        {
          title: '版本历史',
          detail: '自动快照、命名检查点与恢复。'
        }
      ],
      cloud: {
        title: 'OpenPencil Cloud',
        detail: '为团队托管的工作区，提供实时同步、分享、组件库与 AI，无需自行运维。'
      }
    },
    later: {
      label: '后续',
      entries: [
        { title: '设计系统治理', detail: '提案、审阅、发布与迁移。' },
        {
          title: '可嵌入的编辑器',
          detail: '将本页展示的编辑器嵌入自己的产品。'
        }
      ]
    }
  },
  cloud: {
    badge: '抢先体验',
    title: 'OpenPencil Cloud',
    lede: '为团队托管的设计工作区。所有人实时编辑同一份文件，通过链接分享，并与 AI 一起设计，无需安装或维护服务。文件始终保持开放，随时可以导出为 .fig。',
    features: [
      {
        title: '团队实时同步',
        detail: '每次修改都会实时同步到各个设备上的团队成员。'
      },
      {
        title: '分享链接与评论',
        detail: '通过链接邀请审阅，直接在画布上讨论设计。'
      },
      {
        title: '团队组件库',
        detail: '发布一次组件、样式与令牌，即可在各份文件中复用。'
      },
      { title: '托管 AI', detail: '与智能体共同设计，无需管理 API 密钥。' },
      {
        title: 'SSO 与管理功能',
        detail: '支持单点登录、角色与访问权限管理。'
      }
    ]
  },
  waitlist: {
    label: '电子邮箱',
    placeholder: 'you@example.com',
    submit: '加入候补名单',
    confirmHuman: '请完成人机验证',
    invalid: '请输入有效的电子邮箱地址。',
    joined: '请查看收件箱',
    joinedDetail: '打开我们发送的链接，确认你的邮箱地址。',
    failed: '无法连接候补名单服务，请检查网络后重试。',
    privacy: '我们只会向你发送有关 OpenPencil Cloud 的邮件。',
    refused: '人机验证未通过，请重试。',
    limited: '尝试次数过多，请稍后再试。',
    unavailable: '此页面无法加入候补名单，请前往 openpencil.dev。'
  },
  closing: {
    title: '让设计始终随你同行。',
    download: '下载 OpenPencil 官方版',
    docs: '阅读文档',
    cloud: '加入 Cloud 候补名单'
  },
  clipboard: {
    copy: '复制',
    copied: '已复制'
  },
  stage: {
    activate: '体验实时编辑',
    terminal: {
      tree: '图层树',
      restyle: '修改强调色',
      addPlayer: '添加播放器',
      selection: '选区',
      export: 'Tailwind 导出'
    },
    ai: {
      recorded: '已录制的对话',
      play: '播放',
      replay: '重新播放',
      request: '在播放器旁边添加一个“接下来播放”队列。',
      reasoning:
        '播放器独占头部框架，框架按水平方向排列子元素，因此新卡片会出现在播放器旁边。我会将卡片背景、圆角和文字颜色绑定到播放器使用的 Theme 变量，让它同步切换深浅模式，并列出三首歌曲，每首包含小封面、标题和歌手。',
      reply:
        '已在播放器旁添加包含三首歌曲的**接下来播放**卡片。颜色和圆角取自 Theme 变量，会随播放器同步切换深浅模式。'
    },
    collab: {
      you: '你',
      yourScreen: '你的画布',
      theirScreen: 'Sam 的画布',
      askAgent: '向智能体提问'
    },
    sdk: {
      install: '安装'
    }
  },
  download: {
    title: '下载 OpenPencil 官方版',
    lede: '官方上游为 macOS、Windows 和 Linux 提供的桌面应用，免费开源，无需注册。低代码等本分支扩展请使用本分支源码构建。',
    version: '版本 {version}，发布于 {date}',
    forPlatform: '下载 {platform} 版',
    moreFiles: '{platform} 的更多下载选项',
    releaseNotes: '发布说明',
    yourSystem: '你的系统',
    arch: {
      appleSilicon: 'Apple Silicon',
      intel: 'Intel',
      x64: 'x64',
      arm: 'ARM'
    },
    formats: {
      dmg: '磁盘映像',
      exe: '安装程序',
      msi: '适用于受管安装',
      appimage: '适用于大多数发行版',
      deb: 'Debian、Ubuntu',
      rpm: 'Fedora、openSUSE'
    },
    requirements: '系统要求',
    allTitle: '全部下载',
    checksums: 'SHA-256 校验和',
    onGitHub: 'GitHub 发布页',
    unavailable: '暂时无法加载下载列表，所有文件都可以在 GitHub 发布页获取。',
    others: {
      title: '其他获取方式',
      homebrew: {
        title: 'Homebrew',
        detail:
          '通过官方 cask 获取经过签名的 macOS 应用。Homebrew 会审阅每次更新，因此可能稍晚于此处发布。'
      },
      web: {
        title: '浏览器',
        detail: '无需安装，在 app.openpencil.dev 使用官方上游编辑器。',
        action: '打开 Web 应用'
      },
      cli: {
        title: '命令行',
        detail: '无需打开应用，即可检查、导出、运行设计检查或通过脚本处理 .fig 文件。'
      },
      source: {
        title: '源码构建',
        detail: '使用 Bun 和 Rust 构建。需要本分支扩展时，请使用本分支源码，详见构建说明。',
        action: '构建说明'
      }
    },
    beta: {
      badge: 'Beta',
      title: '体验下一版本',
      lede: 'Beta 版可以提前体验下一版本的功能。',
      caveats: [
        '稳定版应用不会自动更新到 Beta 版，需要单独安装。',
        '在 Linux 上，请先卸载通过 .deb 或 .rpm 安装的 Beta 版，再安装正式版。',
        'CLI 与 SDK 的 Beta 版通过 npm 的 next 标签发布。'
      ],
      notes: '更新内容'
    }
  }
}
