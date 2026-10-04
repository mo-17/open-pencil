/** These domain descriptions follow the module inspector's Chinese/English fallback. */
export function moduleDataBindingCopy(locale: string) {
  return locale.toLowerCase().startsWith('zh')
    ? {
        configured: '配置数据',
        rows: '行数据',
        data: '图表数据',
        rowsHint: '读取行数组；排序、筛选与翻页保存在预览中。绑定后 CSV 导入关闭。',
        dataHint: '读取单序列 values 与 labels；空数据和不可用数据会分别显示。'
      }
    : {
        configured: 'Configured data',
        rows: 'Row data',
        data: 'Chart data',
        rowsHint:
          'Read row data. Sorting, filtering and paging stay in the preview. Bound CSV import is disabled.',
        dataHint:
          'Read one series of values and labels. Empty and unavailable data are shown separately.'
      }
}
