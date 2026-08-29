---
title: 第三方插件入门
description: 用四个安全的 Manifest v2 示例学习 OpenPencil 插件契约、宿主适配、签名、提交、发布和安装。
aside: false
---

<script setup lang="ts">
import PluginTutorialLab from '../../.vitepress/theme/components/PluginTutorialLab.vue'
</script>

# 第三方插件入门

这份教程面向第一次写 OpenPencil 插件的开发者。你会从四个可以运行的只读示例开始，完成
Manifest 校验、宿主适配器理解、Ed25519 签名、Developer Portal 预检和 Marketplace 发布准备。

::: warning 先理解一个关键限制
OpenPencil 的声明式插件不是浏览器扩展。Manifest 不能携带任意 JavaScript，也不能自行获得
DOM、网络、文件系统、Tauri 或文档写入能力。新 `plugin.id` 或新能力必须先有一份随 OpenPencil
发布、经过代码审查的精确宿主适配器；发布者签名不能绕过这道门。
:::

<PluginTutorialLab />

## 0. 准备环境

从 OpenPencil 仓库根目录执行命令，并确认已经安装 Bun。要走真实上架流程，还需要：

- Developer Portal 中的组织成员身份；
- 已登记并激活的 Publisher；
- 与 `publisher.keyId` 对应的 Ed25519 公钥；
- 目标 `plugin.id` 的 Marketplace 所有权。

只练习 Manifest 与签名时不需要启动 Marketplace 服务。四个示例都位于
`examples/third-party-plugin/`，建议先从 `document-summary` 开始。

## 1. 选择一个最接近的示例

每个目录只有三份需要人工维护的输入：

```text
your-plugin/
├── manifest.payload.json   # 待签名的严格 Manifest v2
├── listing.json            # Marketplace 展示资料
└── README.md               # 能力边界与验证方法
```

先修改 `publisher.id`、`publisher.name` 和 `publisher.keyId`。练习时保留示例的插件、命令和
适配器 ID；它们与当前 OpenPencil 构建中的宿主契约精确绑定。

如果要改成自己的 `plugin.id`，必须同步新增或修改
`src/app/plugins/host/` 中的宿主契约、执行器和测试，并让该适配器随目标 OpenPencil 版本发布。
只复制 JSON 再换 ID，会得到签名正确但不可激活的插件。

## 2. 写一份闭合的 Manifest v2 契约

命令贡献必须同时声明 `parameters`、`result` 与 `permissions`。对象 Schema 必须设置
`additionalProperties: false`，并给输入、输出设置 `maxBytes`；顶层 `capabilities` 仍然只能是
空数组。

```json
{
  "commandId": "count-node-types",
  "adapterId": "open-pencil.example.node-type-counter",
  "parameters": {
    "schema": {
      "type": "object",
      "properties": {
        "nodeType": {
          "type": "string",
          "enum": ["ALL", "FRAME", "TEXT", "RECTANGLE"]
        }
      },
      "additionalProperties": false,
      "maxProperties": 1
    },
    "maxBytes": 64
  },
  "result": {
    "schema": {
      "type": "object",
      "properties": {
        "nodeType": { "type": "string", "enum": ["ALL", "FRAME", "TEXT", "RECTANGLE"] },
        "matchingNodeCount": { "type": "integer", "minimum": 0 }
      },
      "required": ["nodeType", "matchingNodeCount"],
      "additionalProperties": false,
      "maxProperties": 2
    },
    "maxBytes": 128
  },
  "permissions": ["document.read"]
}
```

最小权限只描述宿主执行器真正会读取的域。不要为了“以后可能用到”增加权限，也不要把凭据、
私钥、URL 请求模板或实现代码放进 Manifest。

## 3. 让宿主适配器与契约精确一致

示例适配器位于 `src/app/plugins/host/example/*.ts`，注册入口是
`src/app/plugins/host/index.ts`。宿主会固定以下六项：

1. `plugin.id`；
2. `commandId`；
3. `adapterId`；
4. Manifest Schema 版本；
5. 完整权限集合；
6. 完整参数与结果 Schema。

任何一项漂移都会拒绝激活。文档遍历示例还统一从公开页面出发，并在遇到 `internalOnly` 节点
时停止进入该子树。执行结果只包含有界聚合数字，不包含节点名称、文本、图片、颜色值、变量值
或凭据。

验证四个示例与真实签名执行链：

```sh
bun test tests/engine/app/plugins/third-party-example.test.ts
```

## 4. 校验并签署 Manifest

先把发布者密钥生成到仓库和示例目录之外。只向 Marketplace 登记公钥，私钥永远不要上传到
Portal、提交到 Git，或粘贴到日志和聊天中。

```sh
export OPENPENCIL_EXAMPLE_KEY_DIR="$PWD/../openpencil-example-publisher-key"
node examples/third-party-plugin/scripts/generate-keypair.mjs \
  --output-dir "$OPENPENCIL_EXAMPLE_KEY_DIR"
```

输出目录必须尚不存在，并由脚本以私有权限创建。若已经有与 Portal 公钥对应的私钥，直接复用
现有密钥，不要再次运行生成命令或覆盖原目录。

为选中的示例校验并签名：

```sh
export OPENPENCIL_PLUGIN_DIR="examples/third-party-plugin/node-type-counter"
export OPENPENCIL_PUBLISHER_ID="example-publisher"
export OPENPENCIL_KEY_ID="example-publisher-2026"
export OPENPENCIL_MARKETPLACE_AUDIENCE="openpencil.marketplace"

bun open-pencil plugin manifest validate \
  "$OPENPENCIL_PLUGIN_DIR/manifest.payload.json"

mkdir -p "$OPENPENCIL_PLUGIN_DIR/dist"

bun open-pencil plugin manifest sign \
  "$OPENPENCIL_PLUGIN_DIR/manifest.payload.json" \
  --private-key "$OPENPENCIL_EXAMPLE_KEY_DIR/publisher-private.pem" \
  --output "$OPENPENCIL_PLUGIN_DIR/dist/manifest.json"

bun open-pencil plugin manifest verify \
  "$OPENPENCIL_PLUGIN_DIR/dist/manifest.json" \
  --public-key "$OPENPENCIL_EXAMPLE_KEY_DIR/publisher-public.pem" \
  --key-id "$OPENPENCIL_KEY_ID" \
  --engine-version 0.15.0
```

`OPENPENCIL_PUBLISHER_ID` 和 `OPENPENCIL_KEY_ID` 必须分别与 Manifest 的 `publisher.id` 和
`publisher.keyId` 完全一致，并对应 Portal 中已激活的发布者与公钥。若 Marketplace 使用自定义
audience，也要同步修改 `OPENPENCIL_MARKETPLACE_AUDIENCE`。

## 5. 生成两个不可互换的提交信封

通用脚本从签名 Manifest 与 Listing 生成精确 Submission 正文：

```sh
node examples/third-party-plugin/scripts/prepare-submission.mjs \
  --plugin-dir "$OPENPENCIL_PLUGIN_DIR"
```

随后针对预检与正式创建分别签名。两个信封绑定不同操作，不能互相替代或重复使用。

```sh
bun marketplace request sign \
  --operation submission.validate \
  --audience "$OPENPENCIL_MARKETPLACE_AUDIENCE" \
  --publisher "$OPENPENCIL_PUBLISHER_ID" \
  --key-id "$OPENPENCIL_KEY_ID" \
  --body "$OPENPENCIL_PLUGIN_DIR/dist/submission.body.json" \
  --private-key "$OPENPENCIL_EXAMPLE_KEY_DIR/publisher-private.pem" \
  --output "$OPENPENCIL_PLUGIN_DIR/dist/submission.validate.opm-request.json"

bun marketplace request sign \
  --operation submission.create \
  --audience "$OPENPENCIL_MARKETPLACE_AUDIENCE" \
  --publisher "$OPENPENCIL_PUBLISHER_ID" \
  --key-id "$OPENPENCIL_KEY_ID" \
  --body "$OPENPENCIL_PLUGIN_DIR/dist/submission.body.json" \
  --private-key "$OPENPENCIL_EXAMPLE_KEY_DIR/publisher-private.pem" \
  --output "$OPENPENCIL_PLUGIN_DIR/dist/submission.create.opm-request.json"
```

Portal / BFF 必须原样转发签名信封中的正文 bytes，不能解析后重新序列化。时间戳只有短暂有效
窗口。`submission.validate` 与查询仍是一信封一次；六种 Publisher 写操作会把 nonce、业务状态和精确
响应原子提交。连接中断且结果未知时，应在有效窗口内原样重放同一信封以读取已提交结果，不能重签
同 nonce，也不能立即换新 nonce 重做业务。信封过期后先用 Publisher 查询核对服务端证据，再决定是否
生成全新信封。

## 6. 在 Portal 中预检、发布并回到客户端验证

1. 上传 `submission.validate.opm-request.json`，解决所有预检错误；
2. 上传独立的 `submission.create.opm-request.json` 创建 Submission；
3. 由组织审查员审查，再由 Marketplace 操作员发布并生成根签名快照；
4. 在 OpenPencil 中刷新插件市场，检查发布者、版本、权限与摘要；
5. 安装并明确启用插件，再从插件卡片运行命令；
6. 若命令允许 MCP 暴露，确认禁用或卸载后动态工具会立即消失。

::: tip 下一步
先阅读[插件架构](/development/plugins)理解完整信任模型，再回到
[插件市场](/zh-cn/user-guide/plugins)检查安装、更新、回滚与授权行为。
:::

## 新手自检表

- [ ] `capabilities` 是空数组，没有任意 JavaScript、URL 或凭据；
- [ ] 参数与结果对象拒绝额外字段，并有明确字节上限；
- [ ] 权限只覆盖实际读取或写入的最小域；
- [ ] 宿主适配器固定完整身份与契约，并有隐私边界测试；
- [ ] `internalOnly` 数据不会进入文档聚合结果；
- [ ] 私钥位于仓库之外，Portal 只收到签名请求；
- [ ] 预检和创建使用两个新鲜、操作不同的信封；
- [ ] 真实安装、启用、禁用和 MCP 撤权行为已经人工验证。
