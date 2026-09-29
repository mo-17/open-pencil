export function chartEditorCopy(locale: string) {
  const zh = locale.toLowerCase().startsWith('zh')
  return {
    heading: zh ? '图表数据' : 'Chart data',
    label: zh ? '标签' : 'Label',
    value: zh ? '数值' : 'Value',
    add: zh ? '添加数据' : 'Add data',
    remove: zh ? '删除此项' : 'Remove item',
    newItem: zh ? '新项目' : 'New item',
    apply: zh ? '应用数据' : 'Apply data',
    cancel: zh ? '取消编辑' : 'Cancel edits',
    typeError: zh
      ? '当前数据含负数，无法切换为饼图或环形图。请先调整数值并应用数据。'
      : 'The current data contains negative values. Apply non-negative data before switching to a pie or donut chart.',
    pending: zh ? '数据尚未应用' : 'Data has not been applied',
    hint: zh
      ? '标签与数值成对编辑，应用后一起更新。饼图和环形图需要非负数值。这里是本地示例数据，不会自动连接后台。'
      : 'Edit labels and values together, then apply the complete dataset. Pie and donut charts require non-negative values. This is local example data; it does not connect to a backend.',
    errors: {
      count: zh ? '请保留 1 至 64 项数据。' : 'Keep between 1 and 64 data items.',
      label: zh ? '每个标签不能超过 80 个字符。' : 'Each label must be at most 80 characters.',
      value: zh
        ? '每项数值都需填写有效数字，范围为 -1,000,000 至 1,000,000。'
        : 'Enter a valid number for every value, between -1,000,000 and 1,000,000.',
      negative: zh
        ? '饼图和环形图需要非负数值；草稿已保留，请调整后重新应用。'
        : 'Pie and donut charts require non-negative values. Your draft is preserved; adjust it and apply again.',
      config: zh
        ? '无法应用数据，请检查图表配置。草稿已保留。'
        : 'The data could not be applied. Check the chart configuration; your draft is preserved.'
    }
  }
}
