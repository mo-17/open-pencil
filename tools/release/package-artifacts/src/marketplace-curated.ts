import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { createMarketplacePluginManifests } from '@/app/plugins/host/marketplace'

import { resolveWorkspaceRoot } from './workspace/root'

const listings = {
  'marketplace.accessibility-audit': {
    displayName: '无障碍检查',
    summary: '检查设计文档中的无障碍问题，生成有界的静态检查报告。',
    description:
      '复用 OpenPencil 内置无障碍检查能力，按需安装和启用。只读检查当前文档，不修改图层，不访问网络。静态结果需要结合真实浏览器和辅助技术验证。',
    categories: ['design-tools', 'accessibility']
  },
  'marketplace.design-system-audit': {
    displayName: '设计系统检查',
    summary: '检查设计令牌、组件变体、间距和文字样式的一致性。',
    description:
      '复用内置设计系统检查，读取文档和变量并返回有界的诊断报告。适合交付前检查设计一致性，不修改设计内容或变量。',
    categories: ['design-tools', 'productivity']
  },
  'marketplace.application-security-readiness': {
    displayName: '应用安全准备检查',
    summary: '本地检查低代码应用配置，提示上线前需要复核的安全问题。',
    description:
      '复用内置的静态生产准备检查，汇总应用配置风险，不输出文档内容或密钥，不连接外部服务、不修改远程系统。报告不能替代真实认证、数据库权限或独立安全评估。',
    categories: ['developer-tools', 'productivity']
  },
  'marketplace.design-tokens-exporter': {
    displayName: '设计令牌导出',
    summary: '将当前文档的设计变量导出为 JSON 文件，供开发和设计系统复用。',
    description:
      '复用内置 Design Tokens Exporter，读取文档变量，在你选择保存位置后输出 JSON。不修改变量，也不上传文档。',
    categories: ['exporters', 'design-tools']
  },
  'marketplace.vue-exporter': {
    displayName: 'Vue 项目导出',
    summary: '把当前设计导出为 Vite、Vue 3 和 TypeScript 源码项目。',
    description:
      '复用内置 Vue Exporter，以可取消的 Worker 编译并打包 ZIP，保留现有导出支持范围和限制。只使用已加载或本地缓存字体，保存前由你确认，不自动部署。',
    categories: ['exporters', 'developer-tools']
  },
  'marketplace.nextjs-exporter': {
    displayName: 'Next.js 项目导出',
    summary: '将当前设计打包为 Next.js 和 React 源码项目。',
    description:
      '复用内置 Next.js Exporter，生成可下载的源码 ZIP。沿用原导出器的功能边界，导出完成后由你保存和构建，不自动上传或部署。',
    categories: ['exporters', 'developer-tools']
  },
  'marketplace.flutter-exporter': {
    displayName: 'Flutter 项目导出',
    summary: '将当前设计打包为 Flutter 源码项目，方便继续开发。',
    description:
      '复用内置 Flutter Exporter，生成源码 ZIP 并由你保存。输出沿用原导出器的支持范围；平台构建、签名和真机验证需要在对应开发环境完成。',
    categories: ['exporters', 'developer-tools']
  },
  'marketplace.figma-projection-exporter': {
    displayName: 'Figma 可编辑投影导出',
    summary: '把当前文档导出为可编辑的 .fig 投影文件。',
    description:
      '复用内置 Figma Projection Exporter，输出用于继续编辑的 .fig 文件。导出是设计投影，低代码交互和应用运行时不会作为可执行功能写入 Figma。',
    categories: ['exporters', 'design-tools']
  }
} as const

const root = await resolveWorkspaceRoot(process.cwd())
const { values } = parseArgs({
  options: {
    output: { type: 'string', default: 'scratch/marketplace-curated/packages' },
    'publisher-id': { type: 'string', default: 'openpencil-examples' },
    'publisher-name': { type: 'string', default: 'OpenPencil Examples' },
    'publisher-key-id': { type: 'string', default: 'openpencil-examples-20261023' }
  },
  strict: true,
  allowPositionals: false
})
const output = resolve(root, values.output)
// A fresh directory keeps an existing reviewed or signed publication batch immutable.
await mkdir(output, { recursive: false, mode: 0o700 })
const report = []
for (const source of createMarketplacePluginManifests()) {
  if (!Object.hasOwn(listings, source.plugin.id)) {
    throw new Error(`No reviewed listing for ${source.plugin.id}`)
  }
  const listing = listings[source.plugin.id as keyof typeof listings]
  const manifest = {
    ...source,
    plugin: { ...source.plugin, name: listing.displayName },
    publisher: {
      id: values['publisher-id'],
      name: values['publisher-name'],
      keyId: values['publisher-key-id']
    }
  }
  const payloadPath = join(output, `${source.plugin.id}.payload.json`)
  const listingPath = join(output, `${source.plugin.id}.listing.json`)
  await writeFile(payloadPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' })
  await writeFile(
    listingPath,
    `${JSON.stringify(
      {
        ...listing,
        description: `${listing.description} 需要包含市场工具适配器的新版 OpenPencil；可与原内置版并存。`,
        iconUrl: null,
        homepageUrl: 'https://kushui.shop/marketplace/'
      },
      null,
      2
    )}\n`,
    { flag: 'wx' }
  )
  report.push({ pluginId: source.plugin.id, payloadPath, listingPath })
}
console.log(JSON.stringify({ output, plugins: report }, null, 2))
