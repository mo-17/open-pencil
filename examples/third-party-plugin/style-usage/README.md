# Style Usage third-party plugin example

这个示例演示如何在 `document.read` 权限内安全遍历公开文档，并只返回启用的 fill、stroke 与
effect 聚合数量。它不返回颜色值、节点 ID、名称、文本，也不会解析变量或进入
`internalOnly` 子树。

宿主契约位于 `src/app/plugins/host/example/style-usage.ts`。完整签名与上架流程见
[示例总览](../README.md)和
[可视化教程](../../../packages/docs/zh-cn/development/plugin-tutorial.md)。最小验证命令：

```sh
bun open-pencil plugin manifest validate \
  examples/third-party-plugin/style-usage/manifest.payload.json
```
