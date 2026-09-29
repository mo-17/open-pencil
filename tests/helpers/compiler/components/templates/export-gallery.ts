import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { exportFigFile } from '@open-pencil/core/io/formats/fig'
import { initCodec, parseFigFile } from '@open-pencil/core/kiwi'
import { computeAllLayouts } from '@open-pencil/core/layout'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { getComponentTemplates } from '@/app/lowcode/component-templates'

import { compileComponentTemplates, componentTemplateFixture } from './fixture'

const directory = resolve(process.argv[2] ?? 'output/lowcode-template-library-20260922/gallery')
const locale = process.argv[3] ?? 'zh-CN'
const entries = getComponentTemplates(locale)
const generatedAt = new Date().toISOString()
const htmlEntities: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}
const escapeHTML = (value: string) =>
  value.replace(/[&<>"']/g, (character) => htmlEntities[character] ?? character)

function validateFigRoundTrip(source: SceneGraph, restored: SceneGraph, filename: string) {
  assert.deepEqual(
    restored.getNode(restored.rootId)?.lowcodeDocumentState,
    source.getNode(source.rootId)?.lowcodeDocumentState,
    `${filename}: document state changed during FIG round trip`
  )
  const visit = (before: SceneNode, after: SceneNode, path: string) => {
    for (const key of ['name', 'type', 'state', 'bindings', 'events', 'interactiveProps'] as const)
      assert.deepEqual(after[key], before[key], `${filename}: ${path}.${key} changed`)
    if (before.type === 'INPUT' || before.type === 'TEXTAREA') {
      for (const key of [
        'fontSize',
        'fontFamily',
        'fontWeight',
        'lineHeight',
        'paddingTop',
        'paddingRight',
        'paddingBottom',
        'paddingLeft',
        'stateOverrides'
      ] as const)
        assert.deepEqual(after[key], before[key], `${filename}: ${path}.${key} changed`)
      for (const key of ['width', 'height'] as const)
        assert.ok(
          Math.abs(after[key] - before[key]) < 0.001,
          `${filename}: ${path}.${key} changed from ${before[key]} to ${after[key]}`
        )
    }
    const children = source.getChildren(before.id)
    const reopenedChildren = restored.getChildren(after.id)
    assert.equal(reopenedChildren.length, children.length, `${filename}: ${path} lost children`)
    for (const [index, child] of children.entries())
      visit(child, reopenedChildren[index], `${path}/${index}:${child.name}`)
  }
  const pages = source.getPages()
  const reopenedPages = restored.getPages()
  assert.equal(reopenedPages.length, pages.length, `${filename}: page count changed`)
  for (const [index, page] of pages.entries()) visit(page, reopenedPages[index], page.name)
}

function figArtifact(bytes: Uint8Array) {
  return {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    byteLength: bytes.byteLength,
    generatedAt
  }
}

mkdirSync(directory, { recursive: true })
await initCodec()
const artifacts = []
for (const entry of entries) {
  const { editor, graph } = componentTemplateFixture([entry.id], locale)
  try {
    computeAllLayouts(graph)
    const bytes = await exportFigFile(graph)
    const imported = await parseFigFile(bytes.slice().buffer)
    const fig = `${entry.id}.fig`
    validateFigRoundTrip(graph, imported, fig)
    const englishViews = ['']
    if (entry.id === 'dialog-form') englishViews.push('dialog')
    if (entry.id === 'tabs-details') englishViews.push('details')
    writeFileSync(join(directory, fig), bytes)
    for (const target of entry.targets) {
      const output = compileComponentTemplates(target, [entry.id], locale)
      if (output.warnings.length) throw new Error(entry.id + ': ' + JSON.stringify(output.warnings))
      for (const [path, content] of output.files) {
        const destination = join(directory, 'sources', entry.id, target, path)
        mkdirSync(resolve(destination, '..'), { recursive: true })
        writeFileSync(destination, content)
      }
    }
    artifacts.push({
      ...entry,
      fig,
      figArtifact: figArtifact(bytes),
      screenshots: entry.targets.flatMap((target) =>
        [375, 1440].map((width) => ({
          target,
          width,
          path: `${entry.id}-${target}-${width}.png`,
          available: existsSync(join(directory, `${entry.id}-${target}-${width}.png`))
        }))
      ),
      englishScreenshots: entry.targets.flatMap((target) =>
        [375, 1440].flatMap((width) =>
          englishViews.map((view) => {
            const path = `${entry.id}-${target}-${width}-en${view ? '-' + view : ''}.png`
            return { target, width, view, path, available: existsSync(join(directory, path)) }
          })
        )
      )
    })
  } finally {
    editor.dispose()
  }
}

const collection = componentTemplateFixture(undefined, locale)
let collectionArtifact: ReturnType<typeof figArtifact>
try {
  computeAllLayouts(collection.graph)
  let rowY = 0
  for (let index = 0; index < collection.results.length; index += 3) {
    let rowHeight = 0
    for (const [column, result] of collection.results.slice(index, index + 3).entries()) {
      const origin = collection.graph.getAbsolutePosition(result.rootId)
      for (const id of result.nodeIds) {
        const node = collection.graph.getNode(id)
        if (!node) continue
        const position = collection.graph.getAbsolutePosition(id)
        rowHeight = Math.max(rowHeight, position.y - origin.y + node.height)
      }
      collection.graph.updateNode(result.rootId, { x: column * 440, y: rowY })
    }
    rowY += rowHeight + 100
  }
  const bytes = await exportFigFile(collection.graph)
  const imported = await parseFigFile(bytes.slice().buffer)
  validateFigRoundTrip(collection.graph, imported, 'all-templates.fig')
  if (imported.getChildren(imported.getPages()[0].id).length !== entries.length)
    throw new Error('Incomplete combined template document')
  writeFileSync(join(directory, 'all-templates.fig'), bytes)
  collectionArtifact = figArtifact(bytes)
} finally {
  collection.editor.dispose()
}

const cards = artifacts
  .map(
    (
      entry
    ) => `<article data-kind="${entry.kind}" data-search="${escapeHTML([entry.name, entry.description, ...entry.keywords].join(' ').toLowerCase())}">
<div class="tag">${entry.kind === 'basic' ? '基础组件 · BASIC' : '常用组合 · COMPOSITION'}</div><h2>${escapeHTML(entry.name)}</h2><p>${escapeHTML(entry.description)}</p>
<a class="download" href="${entry.fig}" download>下载可编辑 .fig</a><span class="id">${entry.id} · ${entry.figArtifact.byteLength} bytes · SHA-256 ${entry.figArtifact.sha256.slice(0, 12)}</span>
${entry.screenshots[0]?.available ? `<a href="${entry.screenshots[0].path}"><img class="thumbnail" loading="lazy" src="${entry.screenshots[0].path}" alt="${escapeHTML(entry.name)} React 紧凑预览"></a>` : ''}
<ul>${entry.limitations.map((limit) => `<li>${escapeHTML(limit)}</li>`).join('')}</ul>
<details><summary>React / Vue · 375 / 1440 预览</summary><div class="previews">${entry.screenshots.map((shot) => `<figure><figcaption>${shot.target} · ${shot.width}px</figcaption>${shot.available ? `<a href="${shot.path}"><img loading="lazy" src="${shot.path}" alt="${escapeHTML(entry.name)} ${shot.target} ${shot.width}px"></a>` : '<p class="missing">尚未生成浏览器截图</p>'}</figure>`).join('')}</div></details>
<details><summary>English · 仅布局证据</summary><p>${
      entry.englishScreenshots
        .filter((shot) => shot.available)
        .map(
          (shot) =>
            `<a href="${shot.path}">${shot.target} · ${shot.width}px${shot.view ? ' · ' + shot.view : ''}</a>`
        )
        .join(' · ') || '尚未生成英语截图'
    }</p></details></article>`
  )
  .join('\n')

writeFileSync(
  join(directory, 'manifest.json'),
  JSON.stringify(
    {
      locale,
      generatedAt,
      collection: 'all-templates.fig',
      collectionArtifact,
      figFiles: artifacts.length + 1,
      artifacts
    },
    null,
    2
  )
)
writeFileSync(
  join(directory, 'index.html'),
  `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>OpenPencil 基础组件＋常用组合</title>
<style>body{margin:0;background:#f3f5f8;color:#19233b;font:15px/1.6 system-ui,sans-serif}main{max-width:1200px;margin:auto;padding:48px 24px}h1{font-size:36px;line-height:1.2;max-width:700px}header p{max-width:780px;color:#536078}.eyebrow,.tag{font-size:12px;font-weight:700;letter-spacing:.08em;color:#5063b2}.toolbar{display:flex;gap:12px;flex-wrap:wrap;margin:32px 0}input,select{font:inherit;padding:10px 14px;border:1px solid #cbd2df;border-radius:8px;background:white}input{flex:1;min-width:180px}.catalog{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,330px),1fr));gap:20px}article{padding:24px;border:1px solid #dce1ea;background:#fff;border-radius:16px;box-shadow:0 4px 14px #25304406}h2{margin:10px 0 8px;font-size:22px}article p{color:#586279;min-height:48px}.download{color:#384dad;font-weight:650}.id{display:block;color:#78829a;font-family:monospace;margin-top:4px}ul{padding-left:20px;color:#616a7b;font-size:13px}details{margin-top:18px;border-top:1px solid #e6e9ef;padding-top:12px}summary{cursor:pointer;color:#334ca3}.previews{display:grid;grid-template-columns:1fr 1fr;gap:12px}figure{margin:12px 0 0;min-width:0}figcaption{font-size:12px;color:#657089}img{display:block;width:100%;height:180px;object-fit:contain;object-position:top;border:1px solid #e3e7ef;background:#f7f8fa}.thumbnail{height:220px;object-fit:cover;margin-top:16px;border-radius:8px}.missing{font-size:12px}footer{margin-top:32px;color:#68738a;font-size:13px}[hidden]{display:none!important}</style>
<main><header><div class="eyebrow">OPENPENCIL · LOCAL TEMPLATE LIBRARY</div><h1>基础组件＋常用组合</h1><p>${entries.length} 个可编辑起点，使用现有原生控件和受控模块。模板保留布局、状态绑定、事件与校验，可继续修改并导出 React / Vue。所有示例在本地运行；表单提交反馈不表示数据已保存到服务器。</p><a class="download" href="all-templates.fig" download>下载完整模板合集 .fig（${entries.length} 个模板）</a><p class="id">生成版本 ${generatedAt} · ${collectionArtifact.byteLength} bytes · SHA-256 ${collectionArtifact.sha256.slice(0, 12)}<br>每份 .fig 已回读核对字段样式与行为；完整校验值见 <a href="manifest.json">manifest.json</a>。</p></header>
<div class="toolbar"><input id="search" type="search" aria-label="搜索模板" placeholder="搜索组件或使用场景"><select id="kind" aria-label="模板分类"><option value="all">全部模板</option><option value="basic">基础组件</option><option value="combination">常用组合</option></select></div><section class="catalog">${cards}</section><footer>截图展示当前机器 Chromium 渲染；真实 Tauri、其他浏览器、字体环境与其他电脑仍需验收。未下载或打包字体。源代码位于 sources/&lt;模板&gt;/&lt;react|vue&gt;/。复测请使用仓库验收报告中的命令。</footer></main>
<script>const search=document.querySelector('#search'),kind=document.querySelector('#kind');function filter(){const query=search.value.trim().toLowerCase();document.querySelectorAll('article').forEach(card=>{card.hidden=(kind.value!=='all'&&card.dataset.kind!==kind.value)||!card.dataset.search.includes(query)})}search.addEventListener('input',filter);kind.addEventListener('change',filter)</script></html>`
)
process.stdout.write(
  JSON.stringify({
    directory,
    templates: artifacts.length,
    figRoundTrips: artifacts.length + 1,
    sources: artifacts.length * 2
  })
)
