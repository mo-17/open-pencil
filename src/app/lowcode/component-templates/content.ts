import { CODE_BLOCK_MODULE_DEFINITION, MARKDOWN_MODULE_DEFINITION } from '@open-pencil/core/plugins'

import type { TemplateContext } from './presentation'

type ContentTemplateId = 'markdown-note' | 'markdown-table' | 'code-block'

export function isContentTemplateId(id: string): id is ContentTemplateId {
  return id === 'markdown-note' || id === 'markdown-table' || id === 'code-block'
}

export function addContentTemplate(ctx: TemplateContext, parent: string, id: ContentTemplateId) {
  const frame =
    id === 'code-block'
      ? CODE_BLOCK_MODULE_DEFINITION.createFrameOverrides({
          label: ctx.copy('Local example', '本地示例'),
          code: ctx.copy(
            '// Display only — this code does not run\nconst message = "Hello, OpenPencil"\nconsole.log(message)',
            '// 仅展示，此代码不会执行\nconst message = "你好，OpenPencil"\nconsole.log(message)'
          ),
          language: 'javascript',
          wrapLines: true,
          showLineNumbers: true,
          showCopyButton: true
        })
      : MARKDOWN_MODULE_DEFINITION.createFrameOverrides({
          source:
            id === 'markdown-table'
              ? ctx.copy(
                  '## Project checklist\n\n| Task | Status |\n| --- | --- |\n| Design | Ready |\n| Review | Pending |\n\n- [x] Content checked\n- [ ] Team review',
                  '## 项目清单\n\n| 任务 | 状态 |\n| --- | --- |\n| 设计 | 已完成 |\n| 评审 | 待确认 |\n\n- [x] 内容已检查\n- [ ] 团队评审'
                )
              : ctx.copy(
                  '## Getting started\n\nA **local, editable** note for your page.\n\n- Select this module\n- Edit the source in the design panel\n- Preview with React or Vue\n\n> Changes stay in your document.',
                  '## 快速开始\n\n页面中的**本地可编辑**说明。\n\n- 选中此模块\n- 在设计面板编辑源码\n- 使用 React 或 Vue 预览\n\n> 修改保存在文档中。'
                ),
          flavor: 'gfm',
          fontSize: 14,
          lineHeight: 1.6
        })
  ctx.node('FRAME', parent, frame.name ?? 'Content', {
    ...frame,
    height: id === 'code-block' ? 280 : 380,
    counterAxisSizing: 'FILL',
    interactiveProps: { ...frame.interactiveProps, lang: ctx.zh ? 'zh-CN' : 'en' }
  })
}
