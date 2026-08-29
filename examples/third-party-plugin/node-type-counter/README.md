# Node Type Counter third-party plugin example

这个示例在 `Document Summary` 基础上增加一个有界输入：`nodeType` 只能是 `ALL`、`FRAME`、
`TEXT` 或 `RECTANGLE`。省略参数时统计全部公开节点，适合直接从插件卡片运行；通过 MCP 调用时
可传入精确枚举值。

它只申请 `document.read`，跳过 `internalOnly` 页面与子树，且只返回过滤条件与计数，不返回
节点 ID、名称、文本或样式。宿主契约位于
`src/app/plugins/host/example/node-type-counter.ts`。

完整签名与上架流程见[示例总览](../README.md)和
[可视化教程](../../../packages/docs/zh-cn/development/plugin-tutorial.md)。最小验证命令：

```sh
bun open-pencil plugin manifest validate \
  examples/third-party-plugin/node-type-counter/manifest.payload.json
```
