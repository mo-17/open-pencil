/** Shared localized feedback for the local, bounded React and Vue data grids. */
export const DATA_GRID_FEEDBACK_RUNTIME = `function dataGridCopy(chinese: boolean) {
  return chinese ? {
    tools: '表格 CSV 工具', close: '关闭 CSV 导入', paste: '粘贴 CSV（仅本次运行）', prepare: '生成 CSV 文本',
    source: 'CSV 导入文本', import: '导入粘贴的 CSV', local: '导入数据仅保留在本次运行中，不会修改源设计。',
    output: '生成的 CSV 文本', manual: '请手动复制，不会请求文件或剪贴板权限。', prepared: 'CSV 文本已生成，可手动复制。',
    boundUnavailable: '绑定的表格数据不可用。', boundReadOnly: '绑定的数据为只读，无法通过 CSV 导入修改。',
    failure: 'CSV 操作失败，请检查下方原因，修改内容后重试。', scroll: '数据表格滚动区域', selection: '选择',
    all: '选择本页所有行', filter: '筛选 ', select: '选择行 ', empty: '没有匹配的数据', pagination: '数据表格分页', previous: '上一页', next: '下一页',
    clearSelection: '清除选择', clearFilters: '清空列筛选', configuredFilters: '设计中配置的筛选条件仍然生效。',
    selected: (total: number, outsidePage: number) => '已选择 ' + total + ' 行' + (outsidePage ? ' · ' + outsidePage + ' 行不在当前页' : ''),
    page: (current: number, total: number, rows: number) => '第 ' + current + ' / ' + total + ' 页 · 共 ' + rows + ' 行',
    imported: (count: number) => '已导入 ' + count + ' 行，仅保留在本次运行中。',
    sanitized: (count: number) => '已保护 ' + count + ' 个类似公式的文本字段。'
  } : {
    tools: 'Data grid CSV tools', close: 'Close CSV import', paste: 'Paste CSV (local session)', prepare: 'Prepare CSV text',
    source: 'CSV import text', import: 'Import pasted CSV', local: 'Imported rows stay local to this running app and do not modify the source design.',
    output: 'Prepared CSV text', manual: 'Copy manually. No file or clipboard permission is requested.', prepared: 'CSV text prepared for manual copying.',
    boundUnavailable: 'Bound data grid rows are unavailable.', boundReadOnly: 'Bound rows are read-only. CSV import is unavailable.',
    failure: 'CSV operation failed. Review the details below, edit the text and retry.', scroll: 'Data grid scroll area', selection: 'Selection',
    all: 'Select all rows on this page', filter: 'Filter ', select: 'Select row ', empty: 'No matching rows', pagination: 'Data grid pagination', previous: 'Previous page', next: 'Next page',
    clearSelection: 'Clear selection', clearFilters: 'Clear column filters', configuredFilters: 'Filters configured in the design remain active.',
    selected: (total: number, outsidePage: number) => total + ' selected' + (outsidePage ? ' · ' + outsidePage + ' not on this page' : ''),
    page: (current: number, total: number, rows: number) => 'Page ' + current + ' of ' + total + ' · ' + rows + ' rows',
    imported: (count: number) => 'Imported ' + count + ' rows for this local running session only.',
    sanitized: (count: number) => count + ' formula-like text fields were neutralized.'
  }
}
`
