# Document Summary third-party plugin example

这是一个完整但最小的第三方插件示例：

- `manifest.payload.json` 是待签名的 Manifest v2；
- `listing.json` 是 Marketplace 展示资料；
- `../scripts/generate-keypair.mjs` 在本地生成 Ed25519 发布者密钥；
- `../scripts/prepare-submission.mjs` 从签名 Manifest 生成一次性的 Submission 正文；
- OpenPencil 内的 `open-pencil.example.document-summary` 是精确匹配的宿主预审适配器。

插件只读取页面数、节点数和当前选中数量，返回聚合数字，不返回节点名称、文本、图片、插件数据或凭据，也不会修改文档。它不是任意 JavaScript 插件：Manifest 只声明契约，真正的能力由 OpenPencil 构建中预注册的宿主适配器提供。

## 1. 修改发布者身份

将 `manifest.payload.json` 中以下字段改为 Developer Portal / Marketplace 已登记的真实值：

- `publisher.id`
- `publisher.name`
- `publisher.keyId`

`plugin.id` 必须保持为 `example.document-summary`，因为宿主适配器与该身份精确绑定。正式发布前可以把这个示例迁移到自己的插件 ID，但同时必须通过 OpenPencil 代码审查注册新的精确宿主适配器。

## 2. 生成本地开发密钥

从仓库根目录执行：

```sh
export OPENPENCIL_EXAMPLE_KEY_DIR="$PWD/../openpencil-example-publisher-key"
node examples/third-party-plugin/scripts/generate-keypair.mjs \
  --output-dir "$OPENPENCIL_EXAMPLE_KEY_DIR"
```

示例强制把密钥生成到整个 OpenPencil 仓库之外；上述路径位于仓库的同级目录。仅向 Marketplace 登记 `publisher-public.pem`；不要上传、提交或复制 `publisher-private.pem` 到 Portal、插件包、日志或聊天记录。后续命令沿用同一个 `OPENPENCIL_EXAMPLE_KEY_DIR`；如果换了终端，请重新导出它或换成实际绝对路径。

输出目录必须尚不存在，并由脚本以私有权限创建；已有密钥应直接复用，不能用生成命令覆盖。

如果 Marketplace 已经登记了一个发布者密钥，请不要生成新密钥，直接使用与 `publisher.keyId` 对应的现有私钥签名。

## 3. 校验、签名与验证

```sh
export OPENPENCIL_PUBLISHER_ID="example-publisher"
export OPENPENCIL_KEY_ID="example-publisher-2026"
export OPENPENCIL_MARKETPLACE_AUDIENCE="openpencil.marketplace"

bun open-pencil plugin manifest validate \
  examples/third-party-plugin/document-summary/manifest.payload.json

mkdir -p examples/third-party-plugin/document-summary/dist

bun open-pencil plugin manifest sign \
  examples/third-party-plugin/document-summary/manifest.payload.json \
  --private-key "$OPENPENCIL_EXAMPLE_KEY_DIR/publisher-private.pem" \
  --output examples/third-party-plugin/document-summary/dist/manifest.json

bun open-pencil plugin manifest verify \
  examples/third-party-plugin/document-summary/dist/manifest.json \
  --public-key "$OPENPENCIL_EXAMPLE_KEY_DIR/publisher-public.pem" \
  --key-id "$OPENPENCIL_KEY_ID" \
  --engine-version 0.15.0
```

`OPENPENCIL_PUBLISHER_ID` 和 `OPENPENCIL_KEY_ID` 必须分别与 Manifest 的 `publisher.id` 和
`publisher.keyId` 完全一致，并对应 Marketplace 已登记的发布者和公钥。

## 4. 生成两个独立的提交请求

先从签名后的 Manifest 和 Listing 生成精确请求正文：

```sh
node examples/third-party-plugin/scripts/prepare-submission.mjs \
  --plugin-dir examples/third-party-plugin/document-summary
```

然后用同一个正文分别签署“只校验”和“正式创建”操作：

```sh
bun marketplace request sign \
  --operation submission.validate \
  --audience "$OPENPENCIL_MARKETPLACE_AUDIENCE" \
  --publisher "$OPENPENCIL_PUBLISHER_ID" \
  --key-id "$OPENPENCIL_KEY_ID" \
  --body examples/third-party-plugin/document-summary/dist/submission.body.json \
  --private-key "$OPENPENCIL_EXAMPLE_KEY_DIR/publisher-private.pem" \
  --output examples/third-party-plugin/document-summary/dist/submission.validate.opm-request.json

bun marketplace request sign \
  --operation submission.create \
  --audience "$OPENPENCIL_MARKETPLACE_AUDIENCE" \
  --publisher "$OPENPENCIL_PUBLISHER_ID" \
  --key-id "$OPENPENCIL_KEY_ID" \
  --body examples/third-party-plugin/document-summary/dist/submission.body.json \
  --private-key "$OPENPENCIL_EXAMPLE_KEY_DIR/publisher-private.pem" \
  --output examples/third-party-plugin/document-summary/dist/submission.create.opm-request.json
```

把 `--audience`、`--publisher` 和 `--key-id` 换成目标 Marketplace 已登记的精确值。两个信封绑定不同的操作与 HTTP 路径，不能把校验信封当作创建信封重复使用。命令使用独占写入；若要重新生成，请先确认并删除旧的 `dist/` 产物。

请求时间戳只允许约 5 分钟时钟偏差。`submission.validate` 信封仍然一次性消费；
`submission.create` 会把 nonce、业务状态和精确私有响应原子提交。如果连接中断且创建结果未知，
应在有效窗口内原样重放同一份 `submission.create` 信封以读取已提交响应；不要重签同一
nonce，也不要立即换新 nonce 重做业务。信封过期后，先通过 Publisher 查询核对服务端证据，再决定是否
生成新信封。

## 5. 通过 Developer Portal 上架

1. 登记并激活发布者与公钥；
2. 为 `example.document-summary` 申请并激活所有权；
3. 上传 `submission.validate.opm-request.json`，确认预检全部通过；
4. 再上传 `submission.create.opm-request.json`，创建 `stable` Submission；
5. 由组织审查员完成审查，Marketplace 操作员发布 Submission 和根签名快照；
6. 在 OpenPencil 配置对应 Marketplace 根公钥，刷新插件市场后安装并启用插件。

Portal / BFF 必须转发信封中的原始正文 bytes，不能解析后重新序列化。私钥始终留在开发者机器上，Portal 只接收已签名信封。

安装后可从插件卡片运行 **Summarize document**；由于该只读适配器允许 MCP 暴露，安装、启用并通过当前信任检查后，也会出现在动态 MCP 插件工具目录中。

## 安全边界

- Manifest、Listing 和签名后的 JSON 中不得出现私钥或凭据；
- 插件没有网络、文件系统、Tauri、DOM、任意文档写入或后台执行权限；
- 发布者签名只证明来源，不能绕过 OpenPencil 的宿主适配器与权限精确匹配；
- 更换插件 ID、命令 ID、适配器 ID、权限或结果契约都需要重新签名并重新审查。
