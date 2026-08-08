import type { DefaultTheme } from 'vitepress'

export const ZH_CN_TRANSLATED_ROUTES = [
  '/zh-cn/',
  '/zh-cn/guide/getting-started',
  '/zh-cn/guide/features',
  '/zh-cn/user-guide/',
  '/zh-cn/user-guide/lowcode-apps',
  '/zh-cn/user-guide/plugins',
  '/zh-cn/user-guide/application-runtime',
  '/zh-cn/programmable/ai-chat',
  '/zh-cn/programmable/mcp-server'
] as const

const guideSidebar: DefaultTheme.SidebarItem[] = [
  {
    text: '指南',
    items: [
      { text: '文档首页', link: '/zh-cn/' },
      { text: '快速开始', link: '/zh-cn/guide/getting-started' },
      { text: '功能概览', link: '/zh-cn/guide/features' },
      { text: '架构（英文）', link: '/guide/architecture' },
      { text: '技术栈（英文）', link: '/guide/tech-stack' },
      { text: '产品对比（英文）', link: '/guide/comparison' },
      { text: 'Figma 功能对照（英文）', link: '/guide/figma-comparison' }
    ]
  }
]

const userGuideSidebar: DefaultTheme.SidebarItem[] = [
  {
    text: '用户指南',
    items: [
      { text: '概览', link: '/zh-cn/user-guide/' },
      { text: '画布导航（英文）', link: '/user-guide/canvas-navigation' },
      { text: '选择与操作（英文）', link: '/user-guide/selection-and-manipulation' },
      { text: '上下文菜单（英文）', link: '/user-guide/context-menu' },
      { text: '绘制图形（英文）', link: '/user-guide/drawing-shapes' },
      { text: '文本编辑（英文）', link: '/user-guide/text-editing' },
      { text: '钢笔工具（英文）', link: '/user-guide/pen-tool' },
      { text: '图层与页面（英文）', link: '/user-guide/layers-and-pages' },
      { text: '导出（英文）', link: '/user-guide/exporting' },
      { text: '自动布局（英文）', link: '/user-guide/auto-layout' },
      { text: '组件（英文）', link: '/user-guide/components' },
      { text: '变量（英文）', link: '/user-guide/variables' }
    ]
  },
  {
    text: '低代码与扩展',
    items: [
      { text: '低代码应用', link: '/zh-cn/user-guide/lowcode-apps' },
      { text: '插件市场', link: '/zh-cn/user-guide/plugins' },
      { text: '应用运行时', link: '/zh-cn/user-guide/application-runtime' }
    ]
  }
]

const programmableSidebar: DefaultTheme.SidebarItem[] = [
  {
    text: 'AI 与自动化',
    items: [
      { text: 'AI 对话', link: '/zh-cn/programmable/ai-chat' },
      { text: 'MCP 服务器', link: '/zh-cn/programmable/mcp-server' },
      { text: '自动化概览（英文）', link: '/programmable/' },
      { text: 'CLI（英文）', link: '/reference/cli' },
      { text: '检查文件（英文）', link: '/programmable/cli/inspecting' },
      { text: '导出（英文）', link: '/programmable/cli/exporting' },
      { text: '设计分析（英文）', link: '/programmable/cli/analyzing' },
      { text: '脚本（英文）', link: '/programmable/cli/scripting' },
      { text: 'JSX 渲染器（英文）', link: '/programmable/jsx-renderer' },
      { text: 'Motion Runtime SDK（英文）', link: '/programmable/motion-runtime' },
      { text: '协作（英文）', link: '/programmable/collaboration' }
    ]
  }
]

export function zhCnThemeConfig(): DefaultTheme.Config {
  return {
    nav: [
      { text: '文档首页', link: '/zh-cn/' },
      { text: '指南', link: '/zh-cn/guide/getting-started' },
      { text: '用户指南', link: '/zh-cn/user-guide/' },
      { text: 'AI 与 MCP', link: '/zh-cn/programmable/ai-chat' },
      { text: 'SDK（英文）', link: '/programmable/sdk/' },
      { text: '参考（英文）', link: '/reference/keyboard-shortcuts' },
      { text: '开发（英文）', link: '/development/contributing' },
      { text: '打开应用', link: 'https://app.openpencil.dev' }
    ],
    sidebar: {
      '/zh-cn/user-guide/': userGuideSidebar,
      '/zh-cn/programmable/': programmableSidebar,
      '/zh-cn/guide/': guideSidebar,
      '/zh-cn/': guideSidebar
    }
  }
}
