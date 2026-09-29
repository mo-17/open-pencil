export const CONTENT_CODE = [
  '// 中文代码示例',
  'const message = "这是一条需要在窄容器中换行的中文与 English 混合内容，不应让下一行的行号错位。"',
  '',
  '\tconsole.log(message)',
  ''
].join('\n')

export const CONTENT_MARKDOWN = [
  '# 内容说明',
  '',
  '中文与 **重点**、*强调* 以及 `inline()` 一起呈现。',
  '',
  '> 保留引用结构。',
  '',
  '3. 第三步',
  '4. 第四步',
  '',
  '- [x] 已完成',
  '- [ ] 待确认',
  '',
  '| 名称 | 状态 |',
  '| :--- | ---: |',
  '| 设计 | 完成 |',
  '| 开发 | 进行中 |',
  '',
  '~~旧内容~~ 保留更新记录。',
  '',
  '```js',
  'const greeting = "你好，世界"',
  '```',
  '',
  '英文标识脚注[^note]与中文标识脚注[^说明]。',
  '',
  '[^note]: 第一条脚注。',
  '[^说明]: 第二条脚注。'
].join('\n')

export const CONTENT_UNTRUSTED_MARKDOWN = [
  '# 安全内容',
  '',
  '[公开文档](https://example.com/docs) [站内页面](/docs/start) [章节](#chapter)',
  '',
  '[脚本链接](javascript:alert%281%29) [数据链接](data:text/html,unsafe)',
  '[本机链接](https://localhost/private) [IP链接](https://127.0.0.1/private)',
  '[协议相对链接](//content-probe.invalid/link) [越级路径](/docs/../private)',
  '',
  '![外部图片](https://content-probe.invalid/image.png)',
  '![站内图片](/content-image-probe.png)',
  '',
  '<script>document.documentElement.dataset.contentExecuted="yes"</script>',
  '<img src="https://content-probe.invalid/raw.png" onerror="document.documentElement.dataset.contentExecuted=\'yes\'">',
  '<iframe src="https://content-probe.invalid/frame"></iframe>',
  '',
  '```html',
  '<b data-executable-probe>代码只是文本</b>',
  '```'
].join('\n')
