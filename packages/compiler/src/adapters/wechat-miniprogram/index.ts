import type { AdapterEmission, FrameworkAdapter } from '#compiler/adapters/types'
import type { ComponentDef, IRTree } from '#compiler/ir/types'
import type { CompileWarning, CompilerOptions } from '#compiler/types'

import {
  assertMiniProgramProjectBudget,
  collectMiniProgramAssets,
  createMiniProgramPagePlan,
  createMiniProgramWarningSink,
  emitMiniProgramAssets,
  safeMiniProgramName,
  setMiniProgramProjectFile,
  type MiniProgramPagePlan,
  type MiniProgramWarningSink
} from '../miniprogram-shared'
import { emitWechatPage } from './emit'
import {
  buildWechatAppJS,
  buildWechatAppJSON,
  buildWechatAppWXSS,
  buildWechatPageJSON,
  buildWechatProjectConfig,
  buildWechatReadme,
  buildWechatSitemapJSON
} from './project'

export const WECHAT_MINIPROGRAM_MAIN_PACKAGE_MAX_BYTES = 2 * 1024 * 1024

export const wechatMiniProgramAdapter: FrameworkAdapter = {
  emit(
    irs: readonly IRTree[],
    options: CompilerOptions,
    components: readonly ComponentDef[] = []
  ): AdapterEmission {
    return emitWechatMiniProgramProject(irs, options, components)
  }
}

function emitWechatMiniProgramProject(
  irs: readonly IRTree[],
  options: CompilerOptions,
  components: readonly ComponentDef[]
): AdapterEmission {
  if (irs.length === 0) throw new TypeError('WeChat Mini Program export requires at least one page')
  const files = new Map<string, string | Uint8Array>()
  const warnings: CompileWarning[] = []
  const warn = createMiniProgramWarningSink(warnings)
  warnCompilerOptions(options, warn)
  const pages = createMiniProgramPagePlan(irs, warn, 'wechat-miniprogram')
  const componentMap = collectComponents(components, warn)
  const assetPlan = collectMiniProgramAssets(
    pages.map((page) => page.ir),
    components,
    warn,
    'wechat-miniprogram'
  )
  const routeMap = createRouteMap(pages, warn)
  const setFile = (path: string, content: string | Uint8Array): void => {
    setMiniProgramProjectFile(files, path, content)
  }

  setFile('app.js', buildWechatAppJS())
  setFile('app.json', buildWechatAppJSON(pages, options))
  setFile('app.wxss', buildWechatAppWXSS())
  setFile('project.config.json', buildWechatProjectConfig(options))
  setFile('sitemap.json', buildWechatSitemapJSON())
  setFile('README.md', buildWechatReadme())
  for (const page of pages) {
    const emission = emitWechatPage(page, assetPlan, componentMap, routeMap, warn)
    setFile(`${page.directory}/index.wxml`, emission.wxml)
    setFile(`${page.directory}/index.wxss`, emission.wxss)
    setFile(`${page.directory}/index.js`, emission.js)
    setFile(`${page.directory}/index.json`, buildWechatPageJSON(page))
  }
  emitMiniProgramAssets(assetPlan, setFile)
  assertMiniProgramProjectBudget(files)
  assertWechatMainPackageBudget(files)
  return { files, warnings }
}

function warnCompilerOptions(options: CompilerOptions, warn: MiniProgramWarningSink): void {
  const router = options.router as string
  if (router !== 'wechat-native' && router !== 'none') {
    warn({
      code: 'wechat-miniprogram-router-option-unsupported',
      message: `WeChat Mini Program export ignored incompatible router ${JSON.stringify(router)} and emitted native page routes`
    })
  }
  const ignored: string[] = []
  if (options.uiKit) ignored.push('uiKit')
  if (options.metadata) ignored.push('metadata')
  if (options.themeCss?.trim()) ignored.push('themeCss')
  if (options.themeSwitch) ignored.push('themeSwitch')
  if (options.i18n) ignored.push('i18n runtime')
  if (options.packaging) ignored.push('packaging')
  if (options.devMode) ignored.push('preview bridge')
  if (ignored.length > 0) {
    warn({
      code: 'wechat-miniprogram-web-option-unsupported',
      message: `WeChat Mini Program export ignored web-only compiler option(s): ${ignored.join(', ')}`
    })
  }
}

function collectComponents(
  components: readonly ComponentDef[],
  warn: MiniProgramWarningSink
): ReadonlyMap<string, ComponentDef> {
  const result = new Map<string, ComponentDef>()
  for (const component of components) {
    if (!result.has(component.name)) result.set(component.name, component)
    else {
      warn({
        code: 'wechat-miniprogram-component-name-collision',
        message: 'WeChat Mini Program export ignored a duplicate component definition name',
        nodeId: component.componentId
      })
    }
  }
  return result
}

function createRouteMap(
  pages: readonly MiniProgramPagePlan[],
  warn: MiniProgramWarningSink
): ReadonlyMap<string, string> {
  const routes = new Map<string, string>()
  for (const [index, page] of pages.entries()) {
    const authored = page.ir.routePattern
    const candidates = [
      ...(index === 0 ? ['/'] : []),
      `/${page.slug}`,
      `/${safeMiniProgramName(page.pageName, page.slug)}`,
      ...(authored && !authored.includes(':') ? [normalizeRoute(authored)] : [])
    ]
    for (const route of new Set(candidates)) {
      const existing = routes.get(route)
      if (!existing) routes.set(route, page.route)
      else if (existing !== page.route) {
        warn({
          code: 'wechat-miniprogram-route-collision',
          message: `WeChat Mini Program export kept the first page mapped to route ${JSON.stringify(route)}`,
          nodeId: page.pageId
        })
      }
    }
  }
  return routes
}

function normalizeRoute(value: string): string {
  const trimmed = value.trim()
  if (!trimmed || trimmed === '/') return '/'
  return `/${trimmed.replace(/^\/+|\/+$/g, '')}`
}

function assertWechatMainPackageBudget(files: ReadonlyMap<string, string | Uint8Array>): void {
  const encoder = new TextEncoder()
  let total = 0
  for (const [path, content] of files) {
    if (path === 'README.md' || path === 'project.config.json') continue
    total += typeof content === 'string' ? encoder.encode(content).byteLength : content.byteLength
    if (!Number.isSafeInteger(total) || total > WECHAT_MINIPROGRAM_MAIN_PACKAGE_MAX_BYTES) {
      throw new RangeError(
        '[wechat-miniprogram-main-package-byte-limit] Native WeChat Mini Program output exceeds the 2 MiB main-package limit; split into subpackages or reduce assets before export'
      )
    }
  }
}
