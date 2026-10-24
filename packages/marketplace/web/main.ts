import { uniq } from 'es-toolkit'

import { filterPlugins, loadCatalog, type CatalogData, type MarketPlugin } from './catalog'

const MARKET_URL = 'https://kushui.shop/v1/snapshot'

const ICONS = {
  document: '<path d="M8 3h8l4 4v14H4V3Z M15 3v5h5 M8 12h8 M8 16h5"/>',
  nodes:
    '<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="3" width="6" height="6" rx="1"/><rect x="9" y="15" width="6" height="6" rx="1"/><path d="M6 9v3h12V9 M12 12v3"/>',
  styles:
    '<circle cx="8" cy="8" r="5"/><rect x="10" y="10" width="11" height="11" rx="2"/><path d="m13 18 5-5 M16 20l4-4"/>',
  variables:
    '<path d="M8 3H6c-2 0-2 2-2 4v2c0 2-2 3-2 3s2 1 2 3v2c0 2 0 4 2 4h2 M16 3h2c2 0 2 2 2 4v2c0 2 2 3 2 3s-2 1-2 3v2c0 2 0 4-2 4h-2 M10 9l4 6 M14 9l-4 6"/>',
  plugin: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8 10h8 M8 14h5"/>'
}

const PRESENTATION: Record<
  string,
  { icon: keyof typeof ICONS; color: string; title: string; summary: string; use: string }
> = {
  'example.document-summary': {
    icon: 'document',
    color: 'peach',
    title: '文档摘要 文档分析',
    summary: '一眼读懂当前文档。汇总页面、节点与选择信息，快速了解设计文件的全貌。',
    use: '适合开始接手文件、交接设计或检查文档结构时使用。运行后，在编辑器中查看当前文档的摘要。'
  },
  'example.node-type-counter': {
    icon: 'nodes',
    color: 'lilac',
    title: '节点类型统计 节点计数',
    summary: '让复杂图层变得清晰。按类型统计节点，快速掌握文件中各类设计元素的分布。',
    use: '适合梳理设计文件的组成。运行后，查看不同节点类型的数量，辅助检查文档结构。'
  },
  'example.style-usage': {
    icon: 'styles',
    color: 'mint',
    title: '样式使用 样式检查',
    summary: '梳理文件中的样式使用情况，为保持设计一致性、整理样式与检查文件提供线索。',
    use: '适合设计检查与样式整理。运行后，查看文件中的样式使用概览，了解现有设计的组织方式。'
  },
  'example.variable-overview': {
    icon: 'variables',
    color: 'blue',
    title: '变量概览 变量管理',
    summary: '把设计变量整理得井井有条。查看变量与集合概览，更快理解文件的设计基础。',
    use: '适合了解文件的变量体系。运行后，查看当前文档中变量与集合的概览。'
  }
}

const CATEGORY_LABELS: Record<string, string> = {
  'design-tools': '设计工具',
  'developer-tools': '开发工具',
  accessibility: '无障碍',
  exporters: '导出工具',
  analysis: '设计分析',
  analytics: '设计分析',
  document: '文档工具',
  documents: '文档工具',
  productivity: '效率工具',
  design: '设计工具',
  utility: '实用工具',
  utilities: '实用工具',
  styles: '样式',
  variables: '变量',
  inspection: '设计检查',
  developer: '开发工具',
  examples: '示例插件',
  reporting: '统计报告'
}

const SEARCH_ALIASES: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  Object.entries(PRESENTATION).map(([pluginId, presentation]) => [
    pluginId,
    [presentation.title, presentation.summary, presentation.use]
  ])
)

function element<T extends HTMLElement>(id: string, type: new () => T): T {
  const value = document.getElementById(id)
  if (!(value instanceof type)) throw new Error(`Missing page element: ${id}`)
  return value
}

function escapeHTML(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ??
      character
  )
}

function iconMarkup(plugin: MarketPlugin): string {
  const presentation = PRESENTATION[plugin.pluginId]
  return `<span class="plugin-icon ${presentation?.color ?? 'blue'}" aria-hidden="true"><svg viewBox="0 0 24 24">${ICONS[presentation?.icon ?? 'plugin']}</svg></span>`
}

function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category
}
function publisherLabel(publisherId: string): string {
  return publisherId === 'openpencil-examples' ? 'OpenPencil Examples' : publisherId
}
function latestRelease(plugin: MarketPlugin) {
  return plugin.releases.find((release) => release.channel === 'stable') ?? plugin.releases[0]
}

const grid = element('plugin-grid', HTMLDivElement)
const message = element('directory-message', HTMLDivElement)
const search = element('plugin-search', HTMLInputElement)
const sort = element('plugin-sort', HTMLSelectElement)
const categories = element('category-filters', HTMLDivElement)
const status = element('catalog-status', HTMLDivElement)
const results = element('result-count', HTMLParagraphElement)
const total = element('total-count', HTMLSpanElement)
const footnote = element('catalog-footnote', HTMLParagraphElement)
const detailDialog = element('plugin-dialog', HTMLDialogElement)
const connectDialog = element('connect-dialog', HTMLDialogElement)
const toast = element('toast', HTMLDivElement)
let catalog: CatalogData | null = null
let selectedCategory = ''
let toastTimer: ReturnType<typeof setTimeout> | undefined
let loading = false

function showToast(text: string) {
  if (toastTimer) clearTimeout(toastTimer)
  const activeDialog = [detailDialog, connectDialog].find((dialog) => dialog.open)
  const dialogFeedback = activeDialog?.querySelector<HTMLElement>('.copy-feedback')
  if (dialogFeedback) {
    dialogFeedback.textContent = text
    return
  }
  toast.textContent = text
  toast.hidden = false
  toastTimer = setTimeout(() => {
    toast.hidden = true
  }, 3600)
}

async function copyText(text: string, successMessage: string) {
  try {
    await navigator.clipboard.writeText(text)
    showToast(successMessage)
  } catch {
    showToast('浏览器未允许复制，请选中地址或插件 ID 后手动复制。')
  }
}

function setPluginURL(pluginId: string | null) {
  const url = new URL(window.location.href)
  if (pluginId) url.searchParams.set('plugin', pluginId)
  else url.searchParams.delete('plugin')
  window.history.replaceState(null, '', url)
}

function showConnection(plugin: MarketPlugin | null = null) {
  if (detailDialog.open) detailDialog.close()
  element('connect-search-title', HTMLHeadingElement).textContent = plugin
    ? `搜索 ${plugin.name}`
    : '搜索想要的插件'
  const pluginID = element('connect-plugin-id', HTMLParagraphElement)
  pluginID.hidden = !plugin
  pluginID.textContent = plugin ? `插件 ID：${plugin.pluginId}` : ''
  if (!connectDialog.open) connectDialog.showModal()
}

function showDetails(plugin: MarketPlugin) {
  const presentation = PRESENTATION[plugin.pluginId]
  const release = latestRelease(plugin)
  element('plugin-detail', HTMLDivElement).innerHTML = `
    <div class="detail-heading">${iconMarkup(plugin)}<div><h2 id="plugin-dialog-title">${escapeHTML(plugin.name)}</h2><p>${escapeHTML(publisherLabel(plugin.publisherId))}</p></div></div>
    <p class="detail-summary">${escapeHTML(presentation?.summary ?? plugin.summary)}</p>
    <div class="detail-tags">${plugin.categories.map((category) => `<span class="category-label">${escapeHTML(categoryLabel(category))}</span>`).join('')}<span class="release-tag">${release ? `v${escapeHTML(release.version)} · ${release.channel === 'stable' ? '稳定版' : '测试版'}` : '暂无可用版本'}</span></div>
    <section class="detail-section"><h3>适用场景</h3><p>${escapeHTML(presentation?.use ?? plugin.summary)}</p></section>
    ${plugin.pluginId.startsWith('marketplace.') ? '<section class="detail-section"><h3>使用要求</h3><p>请使用包含市场工具适配器的新版 OpenPencil。市场版可与原内置版并存，分别安装和启用；旧版编辑器会提示适配器不兼容。</p></section>' : ''}
    ${plugin.categories.includes('exporters') ? '<section class="detail-section"><h3>如何导出</h3><p>安装并启用后，在编辑器「设置 → 插件」的导出器区域运行，确认保存位置。插件不会自动部署项目。</p></section>' : ''}
    <section class="detail-section"><h3>插件信息</h3><dl class="plugin-information"><div><dt>插件 ID</dt><dd><code>${escapeHTML(plugin.pluginId)}</code><button type="button" class="inline-copy" id="copy-plugin-id">复制</button></dd></div><div><dt>发布者</dt><dd>${escapeHTML(plugin.publisherId)}</dd></div><div><dt>可用版本</dt><dd>${plugin.releases.map((entry) => `${escapeHTML(entry.version)} (${entry.channel === 'stable' ? '稳定版' : '测试版'})`).join('、')}</dd></div></dl><p class="copy-feedback" role="status" aria-live="polite"></p></section>
    ${plugin.keywords.length ? `<section class="detail-section"><h3>关键词</h3><p class="keyword-list">${plugin.keywords.map((keyword) => `<span>${escapeHTML(keyword)}</span>`).join('')}</p></section>` : ''}
    <div class="detail-footer"><p>安装与权限确认将在编辑器中完成。</p><button type="button" class="button button-dark" id="install-in-editor">在编辑器中安装 <span aria-hidden="true">↗</span></button></div>`
  element('copy-plugin-id', HTMLButtonElement).addEventListener('click', () => {
    void copyText(plugin.pluginId, '插件 ID 已复制')
  })
  element('install-in-editor', HTMLButtonElement).addEventListener('click', () => {
    showConnection(plugin)
  })
  setPluginURL(plugin.pluginId)
  if (!detailDialog.open) detailDialog.showModal()
}

function renderFilters(plugins: readonly MarketPlugin[]) {
  const categoryList = uniq(plugins.flatMap((plugin) => [...plugin.categories])).sort()
  categories.innerHTML = `<button type="button" class="filter-chip ${selectedCategory === '' ? 'is-active' : ''}" aria-pressed="${selectedCategory === ''}" data-category="">全部插件 <span>${plugins.length}</span></button>${categoryList.map((category) => `<button type="button" class="filter-chip ${selectedCategory === category ? 'is-active' : ''}" aria-pressed="${selectedCategory === category}" data-category="${escapeHTML(category)}">${escapeHTML(categoryLabel(category))}<span>${plugins.filter((plugin) => plugin.categories.includes(category)).length}</span></button>`).join('')}`
}

function renderPlugins() {
  if (!catalog) return
  const plugins = [
    ...filterPlugins(catalog.plugins, search.value, selectedCategory, SEARCH_ALIASES)
  ].sort(
    (left, right) => (sort.value === 'desc' ? -1 : 1) * left.name.localeCompare(right.name, 'en')
  )
  grid.innerHTML = plugins
    .map((plugin) => {
      const release = latestRelease(plugin)
      const summary = PRESENTATION[plugin.pluginId]?.summary ?? plugin.summary
      return `<article class="plugin-card"><div class="card-top">${iconMarkup(plugin)}<span class="release-tag">${release?.channel === 'stable' ? '稳定版' : '测试版'}</span></div><h3><button class="card-title" type="button" data-plugin-id="${escapeHTML(plugin.pluginId)}">${escapeHTML(plugin.name)}</button></h3><p class="plugin-summary">${escapeHTML(summary)}</p><div class="plugin-meta"><span class="publisher"><span aria-hidden="true">${escapeHTML(plugin.publisherId.slice(0, 1).toUpperCase())}</span>${escapeHTML(publisherLabel(plugin.publisherId))}</span>${plugin.categories[0] ? `<span class="category-label">${escapeHTML(categoryLabel(plugin.categories[0]))}</span>` : ''}</div><div class="card-footer"><span class="plugin-version">${release ? `v${escapeHTML(release.version)}` : '暂无版本'}</span><button class="details-button" type="button" data-plugin-id="${escapeHTML(plugin.pluginId)}" aria-label="查看 ${escapeHTML(plugin.name)} 详情">查看详情 <span aria-hidden="true">↗</span></button></div></article>`
    })
    .join('')
  grid.hidden = plugins.length === 0
  message.hidden = plugins.length > 0
  if (plugins.length === 0) {
    message.innerHTML =
      '<span class="empty-icon" aria-hidden="true">⌕</span><h3>还没有找到合适的插件</h3><p>试试其他关键词，或查看全部插件。</p><button type="button" class="button button-outline" id="reset-filters">清除筛选</button>'
    element('reset-filters', HTMLButtonElement).addEventListener('click', () => {
      search.value = ''
      selectedCategory = ''
      renderFilters(catalog?.plugins ?? [])
      renderPlugins()
      search.focus()
    })
  }
  results.textContent = `显示 ${plugins.length} 个插件`
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Shanghai'
  }).format(new Date(value))
}

async function refreshCatalog() {
  if (loading) return
  loading = true
  grid.setAttribute('aria-busy', 'true')
  status.innerHTML = '<span class="status-dot status-loading"></span>正在连接在线目录'
  message.hidden = true
  try {
    catalog = await loadCatalog()
    total.textContent = String(catalog.plugins.length)
    total.hidden = false
    status.innerHTML = '<span class="status-dot"></span>市场快照签名已校验'
    results.textContent = `显示 ${catalog.plugins.length} 个插件`
    footnote.textContent = `目录序列 #${catalog.sequence} · 签发于 ${formatDate(catalog.issuedAt)}（北京时间）· 安装前由编辑器验证插件包与权限`
    footnote.hidden = false
    renderFilters(catalog.plugins)
    renderPlugins()
    const requestedId = new URL(window.location.href).searchParams.get('plugin')
    const requested = catalog.plugins.find((plugin) => plugin.pluginId === requestedId)
    if (requested) showDetails(requested)
  } catch (error) {
    grid.hidden = true
    status.innerHTML = '<span class="status-dot status-error"></span>目录暂不可用'
    message.hidden = false
    message.innerHTML =
      '<span class="empty-icon" aria-hidden="true">↻</span><h3>暂时无法加载插件目录</h3><p>网络连接或目录校验未通过，请稍后重试。你仍可在编辑器中查看已安装的插件。</p><button type="button" class="button button-dark" id="retry-catalog">重新加载</button>'
    element('retry-catalog', HTMLButtonElement).addEventListener('click', () => {
      void refreshCatalog()
    })
    results.textContent = '等待连接'
    footnote.hidden = true
    console.error('Marketplace catalog could not be loaded:', error)
  } finally {
    loading = false
    grid.setAttribute('aria-busy', 'false')
  }
}

categories.addEventListener('click', (event) => {
  const target =
    event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>('[data-category]')
      : null
  if (!target || !catalog) return
  selectedCategory = target.dataset.category ?? ''
  renderFilters(catalog.plugins)
  renderPlugins()
  categories.querySelectorAll<HTMLButtonElement>('[data-category]').forEach((button) => {
    if (button.dataset.category === selectedCategory) button.focus({ preventScroll: true })
  })
})
grid.addEventListener('click', (event) => {
  const target =
    event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>('[data-plugin-id]')
      : null
  const plugin = catalog?.plugins.find((entry) => entry.pluginId === target?.dataset.pluginId)
  if (plugin) showDetails(plugin)
})
search.addEventListener('input', renderPlugins)
sort.addEventListener('change', renderPlugins)
element('copy-market-url', HTMLButtonElement).addEventListener('click', () => {
  void copyText(MARKET_URL, '市场快照地址已复制')
})
document.querySelectorAll<HTMLButtonElement>('[data-connect]').forEach((button) => {
  button.addEventListener('click', () => {
    showConnection()
  })
})
document.querySelectorAll<HTMLButtonElement>('[data-close-dialog]').forEach((button) => {
  button.addEventListener('click', () => {
    button.closest('dialog')?.close()
  })
})
for (const dialog of [detailDialog, connectDialog]) {
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return
    const bounds = dialog.getBoundingClientRect()
    if (
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom
    )
      dialog.close()
  })
}
detailDialog.addEventListener('close', () => {
  setPluginURL(null)
})
document.addEventListener('keydown', (event) => {
  if (
    event.key !== '/' ||
    detailDialog.open ||
    connectDialog.open ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey
  )
    return
  if (
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLTextAreaElement ||
    (event.target instanceof HTMLElement && event.target.isContentEditable)
  )
    return
  event.preventDefault()
  search.focus()
})
void refreshCatalog()
