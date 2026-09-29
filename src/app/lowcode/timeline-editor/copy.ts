export function timelineEditorCopy(locale: string) {
  const zh = locale.toLowerCase().startsWith('zh')
  return {
    title: zh ? '标题' : 'Title',
    time: zh ? '时间文字' : 'Time text',
    description: zh ? '说明' : 'Description',
    identifier: zh ? '标识符' : 'Identifier',
    status: zh ? '状态' : 'Status',
    completed: zh ? '已完成' : 'Completed',
    current: zh ? '当前' : 'Current',
    pending: zh ? '待处理' : 'Pending',
    error: zh ? '错误' : 'Error',
    add: zh ? '添加事件' : 'Add event',
    newEvent: zh ? '新事件' : 'New event',
    invalid: zh
      ? '请填写标题和唯一标识符，并检查内容长度。'
      : 'Enter a title and unique identifier, and check text lengths.',
    restore: zh ? '还原未保存的编辑' : 'Restore unsaved edits',
    hint: zh
      ? '项目按列表顺序展示；时间为文字，不会自动排序或连接后台。'
      : 'Events follow list order. Time is text; events are not automatically sorted or connected to a backend.'
  }
}
