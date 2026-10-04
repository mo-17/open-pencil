import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { exportFigFile } from '@open-pencil/core/io/formats/fig'
import { initCodec, parseFigFile } from '@open-pencil/core/kiwi'

import { componentStateGraph, compileComponentStates, richTextTypographyGraph } from './fixture'
import { CANVAS_STATE_FAMILIES } from './types'

const directory = resolve(process.argv[2] ?? 'output/component-state-work-20260930/gallery')
mkdirSync(directory, { recursive: true })
await initCodec()
const records = []
for (const locale of ['en', 'zh-CN'] as const)
  for (const family of CANVAS_STATE_FAMILIES) {
    const { graph } =
      family === 'rich-text' ? richTextTypographyGraph(locale) : componentStateGraph(family, locale)
    const bytes = await exportFigFile(graph)
    const restored = await parseFigFile(bytes.slice().buffer)
    const reopenedRoot = restored.getChildren(restored.getPages()[0].id)[0]
    const reopened = restored.getChildren(reopenedRoot.id).filter((node) => node.type === 'FRAME')
    const controls = graph
      .getChildren(graph.getChildren(graph.getPages()[0].id)[0].id)
      .filter((node) => node.type === 'FRAME')
    assert.equal(reopened.length, controls.length)
    for (const [index, control] of controls.entries())
      assert.deepEqual(
        reopened[index].interactiveProps,
        graph.getNode(control.id)?.interactiveProps
      )
    const fig = `${family}-${locale}.fig`
    writeFileSync(join(directory, fig), bytes)
    const targets: ('react' | 'vue')[] = family === 'rich-text' ? ['react'] : ['react', 'vue']
    for (const target of targets) {
      const result = compileComponentStates(target, family, locale)
      assert.equal(result.warnings.length, 0)
      for (const [path, content] of result.files) {
        const output = join(directory, 'sources', family, locale, target, path)
        mkdirSync(resolve(output, '..'), { recursive: true })
        writeFileSync(output, content)
      }
    }
    records.push({ family, locale, fig, byteLength: bytes.byteLength, targets })
  }
writeFileSync(
  join(directory, 'manifest.json'),
  JSON.stringify(
    {
      records,
      families: CANVAS_STATE_FAMILIES.length,
      figRoundTrips: records.length,
      projects: records.reduce((count, record) => count + record.targets.length, 0)
    },
    null,
    2
  ) + '\n'
)
const cards = records
  .map(
    ({ family, locale, fig, targets }) =>
      `<article><h2>${family} · ${locale}</h2><a href="${fig}" download>Editable FIG</a><div class="views">${['canvas', ...targets].map((target) => `<figure><figcaption>${target}</figcaption><a href="${family}-${target}-${locale}${target === 'canvas' ? '' : '-375'}.png"><img src="${family}-${target}-${locale}${target === 'canvas' ? '' : '-375'}.png" alt="${family} ${target} ${locale} states" loading="lazy"></a></figure>`).join('')}${family === 'rich-text' ? '<p>Vue adapter 尚未支持；本例核对 16/32px 字号及中文回退。</p>' : ''}</div></article>`
  )
  .join('')
writeFileSync(
  join(directory, 'index.html'),
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>R5 component states</title><style>body{font:16px/1.5 system-ui;background:#f3f5f8;color:#172b4d;margin:0}main{max-width:1200px;margin:auto;padding:32px}article{background:white;border:1px solid #cbd5e1;border-radius:12px;padding:24px;margin:24px 0}.views{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}figure{margin:0}img{width:100%;height:420px;object-fit:contain;object-position:top;background:#f8fafc}@media(max-width:700px){.views{grid-template-columns:1fr}}</style><main><h1>R5 · 组件状态对照</h1><p>同一作者文档的正常、禁用与只读设计初态。Canvas 为实际 FIG 导入后的绘制；React/Vue 为同版文档编译后的浏览器截图。平台日期外观可以不同。缺字体测试使用本地许可字体回退；此页不代表 Tauri、真实设备或 Figma 应用验收。</p>${cards}</main>`
)
process.stdout.write(
  JSON.stringify({
    directory,
    families: CANVAS_STATE_FAMILIES.length,
    figRoundTrips: records.length,
    projects: records.reduce((count, record) => count + record.targets.length, 0)
  }) + '\n'
)
