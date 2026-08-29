# OpenPencil third-party plugin examples

这里有四个由浅入深的 Manifest v2 示例。它们都是**声明式插件包**：包内没有可执行
JavaScript，真正的能力由 OpenPencil 构建中经过审查、与插件身份精确绑定的宿主适配器提供。

| 示例                | 重点             | 最小权限                                   | 返回内容                  |
| ------------------- | ---------------- | ------------------------------------------ | ------------------------- |
| `document-summary`  | 最小完整发布流程 | `document.read`、`document.selection.read` | 页面、节点、选中数量      |
| `node-type-counter` | 有界枚举参数     | `document.read`                            | 指定类型的节点数量        |
| `style-usage`       | 安全遍历与聚合   | `document.read`                            | fill、stroke、effect 数量 |
| `variable-overview` | 专用能力边界     | `document.variables.read`                  | 集合、变量、模式数量      |

交互式中文教程位于
[`packages/docs/zh-cn/development/plugin-tutorial.md`](../../packages/docs/zh-cn/development/plugin-tutorial.md)。
每个示例目录也有自己的边界说明和验证命令。

## 通用工具

生成发布者密钥时，输出目录必须位于整个 OpenPencil 仓库之外：

```sh
export OPENPENCIL_EXAMPLE_KEY_DIR="$PWD/../openpencil-example-publisher-key"
node examples/third-party-plugin/scripts/generate-keypair.mjs \
  --output-dir "$OPENPENCIL_EXAMPLE_KEY_DIR"
```

私钥只留在开发者机器；只把公钥登记到 Marketplace。签名某个示例后，用通用脚本生成该
插件的精确 Submission 正文：

密钥输出目录必须尚不存在，并由脚本以私有权限创建；已有密钥应直接复用，不要覆盖或重新生成。

```sh
node examples/third-party-plugin/scripts/prepare-submission.mjs \
  --plugin-dir examples/third-party-plugin/document-summary
```

脚本默认从 `<plugin-dir>/dist/manifest.json` 与 `<plugin-dir>/listing.json` 读取输入，并以
独占写入方式创建 `<plugin-dir>/dist/submission.body.json`。随后仍需针对
`submission.validate` 与 `submission.create` 分别生成两个不可互换的发布者签名请求信封。

## 不能只改 Manifest 的部分

`plugin.id`、`commandId`、`adapterId`、权限、参数与结果 Schema 都必须与宿主预审契约完全
一致。若要创建新的插件身份或新能力，需要同时提交 OpenPencil 宿主适配器代码与安全测试并
经过审查；Marketplace 签名不能把未知适配器变成可执行能力。
