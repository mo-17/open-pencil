# Variable Overview third-party plugin example

这个示例只申请 `document.variables.read`，统计变量集合、变量、模式和可发布变量数量。它不读取
一般节点内容，也不返回变量 ID、名称、值、别名或模式名称，展示了“能力够用即可”的权限拆分。

宿主契约位于 `src/app/plugins/host/example/variable-overview.ts`。完整签名与上架流程见
[示例总览](../README.md)和
[可视化教程](../../../packages/docs/zh-cn/development/plugin-tutorial.md)。最小验证命令：

```sh
bun open-pencil plugin manifest validate \
  examples/third-party-plugin/variable-overview/manifest.payload.json
```
