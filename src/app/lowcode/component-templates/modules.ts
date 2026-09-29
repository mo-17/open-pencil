import {
  createDataGridModuleFrameOverrides,
  createUploadButtonModuleFrameOverrides
} from '@open-pencil/core/plugins'

import type { TemplateContext } from './presentation'

export function addTemplateUpload(ctx: TemplateContext, parent: string) {
  const locked = ctx.state('locked', 'boolean', false)
  ctx.field(parent, 'SWITCH', ctx.copy('Disable file selection', '禁用文件选择'), locked)
  ctx.node('FRAME', parent, ctx.copy('Local files', '本地文件'), {
    ...createUploadButtonModuleFrameOverrides({
      triggerLabel: ctx.copy('Choose local files', '选择本地文件'),
      accept: ['.txt', '.png'],
      multiple: true,
      maxFiles: 3,
      maxFileBytes: 2 * 1024 * 1024,
      showFileList: true,
      allowDrop: true
    }),
    width: 320,
    height: 280,
    counterAxisSizing: 'FILL',
    bindings: { disabled: { kind: 'expr', expr: locked } }
  })
  ctx.text(
    parent,
    ctx.copy(
      'TXT / PNG · up to 3 files · 2 MB each. No upload.',
      'TXT / PNG · 最多 3 个 · 每个 2 MB。不会上传。'
    )
  )
}

export function addTemplateGrid(ctx: TemplateContext, parent: string, workbench = false) {
  const overrides = createDataGridModuleFrameOverrides({
    data: {
      columns: [
        {
          id: 'name',
          label: ctx.copy('Name', '名称'),
          type: 'text',
          align: 'start',
          width: 140,
          sortable: true,
          filterable: true
        },
        {
          id: 'count',
          label: ctx.copy('Count', '数量'),
          type: 'number',
          align: 'end',
          width: 80,
          sortable: true,
          filterable: true
        }
      ],
      rows: Array.from({ length: workbench ? 12 : 6 }, (_, index) => ({
        id: 'sample-' + index,
        cells: [ctx.copy('Item ', '条目 ') + (index + 1), (index + 1) * 2]
      }))
    },
    pageSize: 10,
    selectionMode: 'multiple'
  })
  ctx.node('FRAME', parent, ctx.copy('Sample records', '示例记录'), {
    ...overrides,
    width: 320,
    height: workbench ? 650 : 580,
    counterAxisSizing: 'FILL',
    interactiveProps: { ...overrides.interactiveProps, lang: ctx.zh ? 'zh-CN' : 'en' }
  })
}
