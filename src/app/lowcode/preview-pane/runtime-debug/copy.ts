export function runtimeDebugCopy(locale: string) {
  return locale.startsWith('zh')
    ? {
        title: '运行调试',
        record: '开始记录',
        pause: '暂停记录',
        clear: '清空',
        close: '关闭',
        recording: '正在记录',
        paused: '已暂停',
        waiting: '等待预览就绪',
        hint: '仅记录最近 200 步的事件、动作、表达式、请求和状态标识。不收集字段值、表达式内容、请求地址或正文。',
        empty: '开始记录后，在预览中点击控件或修改输入以查看执行过程。',
        unavailable: '运行调试支持嵌入式 React 和 Vue 编译预览；外部后端及其他目标暂不支持。',
        select: '定位图层',
        trace: '调用',
        omitted: '条记录已省略',
        kinds: {
          event: '事件',
          action: '动作',
          expression: '表达式',
          request: '请求',
          state: '状态',
          error: '运行错误'
        },
        statuses: { start: '开始', success: '完成', error: '失败', changed: '已更新' }
      }
    : {
        title: 'Runtime debug',
        record: 'Record',
        pause: 'Pause',
        clear: 'Clear',
        close: 'Close',
        recording: 'Recording',
        paused: 'Paused',
        waiting: 'Waiting for preview',
        hint: 'Shows the latest 200 event, action, expression, request and state identifiers. Field values, expression contents, request URLs and bodies are never collected.',
        empty:
          'Start recording, then click a control or edit an input in the preview to inspect execution.',
        unavailable:
          'Runtime debug supports embedded React and Vue compiler previews. External backends and other targets are not supported yet.',
        select: 'Select layer',
        trace: 'Trace',
        omitted: 'entries omitted',
        kinds: {
          event: 'Event',
          action: 'Action',
          expression: 'Expression',
          request: 'Request',
          state: 'State',
          error: 'Runtime error'
        },
        statuses: { start: 'Started', success: 'Completed', error: 'Failed', changed: 'Updated' }
      }
}
