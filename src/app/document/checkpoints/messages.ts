import { createI18n, type ComponentsJSON } from '@nanostores/i18n'

import { locale, type Locale } from '@open-pencil/vue'

const defaults = {
  title: 'Local checkpoints',
  description:
    'Named FIG snapshots stored on this device. Restore opens a new unsaved document and keeps the current tab and file unchanged.',
  name: 'Checkpoint name',
  create: 'Create checkpoint',
  all: 'Show checkpoints from all documents',
  empty: 'No checkpoints yet.',
  inspect: 'Compare with current document',
  remove: 'Delete',
  confirmDelete: 'Delete this local checkpoint?',
  cancel: 'Cancel',
  restore: 'Open checkpoint as new document',
  backupName: 'Before checkpoint restore',
  restoreHint:
    'The current document is checkpointed first. The restored copy has no writable file or storage binding.',
  difference: 'Changes from checkpoint to current document',
  added: 'Added',
  removed: 'Removed',
  changed: 'Changed',
  variables: 'Variables or modes changed',
  assets: 'Image assets changed',
  document: 'Document metadata changed',
  truncated: 'Only the first 200 changed layers are shown.',
  saved: 'Checkpoint saved on this device.',
  close: 'Close',
  limits:
    'Up to 20 checkpoints per document, 100 total, 32 MiB per checkpoint and 128 MiB total. Nothing is deleted automatically. Browser data clearing removes these copies; keep exported files too.',
  invalid: 'The checkpoint name or data is invalid, or this document exceeds the 32 MiB limit.',
  limit: 'Checkpoint storage is full. Delete a checkpoint before creating another or restoring.',
  missing: 'This checkpoint is no longer available.',
  changedError: 'The document changed during this operation. Reopen checkpoints and try again.',
  unavailable:
    'Local checkpoint storage or document preparation failed. The current document is preserved.',
  beforeRestore: 'Safety copy before restore',
  same: 'No authored differences found.',
  fields: 'Changed fields',
  currentDocument: 'Current document'
} as const

const chinese: Record<keyof typeof defaults, string> = {
  title: '本地版本检查点',
  description: '在此设备保存命名 FIG 快照。恢复时打开新的未保存文档，保留当前标签页和原文件。',
  name: '检查点名称',
  create: '创建检查点',
  all: '显示所有文档的检查点',
  empty: '还没有检查点。',
  inspect: '与当前文档比较',
  remove: '删除',
  confirmDelete: '删除此本地检查点？',
  cancel: '取消',
  restore: '作为新文档打开检查点',
  backupName: '恢复检查点前',
  restoreHint: '先为当前文档保存安全检查点。恢复副本没有可写文件或存储绑定。',
  difference: '从检查点到当前文档的变化',
  added: '新增',
  removed: '删除',
  changed: '修改',
  variables: '变量或模式已改变',
  assets: '图片资源已改变',
  document: '文档元数据已改变',
  truncated: '仅列出前 200 个变化图层。',
  saved: '已在此设备保存检查点。',
  close: '关闭',
  limits:
    '每个文档最多 20 个检查点，总计 100 个；单个最大 32 MiB，总量最大 128 MiB。不自动删除。清除浏览器数据会移除此处的副本，请同时保留导出文件。',
  invalid: '检查点名称或数据无效，或文档超过 32 MiB 限制。',
  limit: '检查点存储已满。请先删除检查点，再创建或恢复。',
  missing: '此检查点已不可用。',
  changedError: '操作期间文档发生变化。请重新打开检查点后重试。',
  unavailable: '本地检查点存储或文档准备失败，当前文档已保留。',
  beforeRestore: '恢复前安全副本',
  same: '未发现内容差异。',
  fields: '变化字段',
  currentDocument: '当前文档'
}

const i18n = createI18n<Locale, 'en'>(locale, {
  baseLocale: 'en',
  async get(code): Promise<ComponentsJSON> {
    return code === 'zh-CN' ? { checkpoints: chinese } : {}
  }
})

export const checkpointMessages = i18n('checkpoints', defaults)
