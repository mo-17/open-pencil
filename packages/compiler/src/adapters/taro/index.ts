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
  setMiniProgramProjectFile
} from '../miniprogram-shared'
import { derivePagePaths } from '../react/route-paths'
import { createTaroComponentPlans, emitTaroComponent, emitTaroPage } from './emit'
import {
  buildTaroAppConfig,
  buildTaroAppSource,
  buildTaroAppStyle,
  buildTaroBabelConfig,
  buildTaroConfig,
  buildTaroGitignore,
  buildTaroPackageJSON,
  buildTaroPageConfig,
  buildTaroProjectConfig,
  buildTaroReadme,
  buildTaroTsConfig
} from './project'

export const taroAdapter: FrameworkAdapter = {
  emit(
    irs: readonly IRTree[],
    options: CompilerOptions,
    components: readonly ComponentDef[] = []
  ): AdapterEmission {
    return emitTaroProject(irs, options, components)
  }
}

export function emitTaroProject(
  irs: readonly IRTree[],
  options: CompilerOptions,
  components: readonly ComponentDef[] = []
): AdapterEmission {
  const files = new Map<string, string | Uint8Array>()
  const warnings: CompileWarning[] = []
  const warn = createMiniProgramWarningSink(warnings)
  const pages = createMiniProgramPagePlan(irs, warn, 'taro')
  const assets = collectMiniProgramAssets(irs, components, warn, 'taro')
  const componentPlans = createTaroComponentPlans(components)
  const authoredRoutes = derivePagePaths(irs)
  const routeByAuthoredPath = new Map<string, string>()
  for (const [index, route] of authoredRoutes.entries()) {
    const page = pages[index]
    if (!routeByAuthoredPath.has(route.route)) {
      routeByAuthoredPath.set(route.route, page.route)
    }
  }
  const environment = { assets, components: componentPlans, routeByAuthoredPath, warn }
  const setFile = (path: string, content: string | Uint8Array) =>
    setMiniProgramProjectFile(files, path, content)
  const projectName = safeMiniProgramName(options.packageName, 'openpencil-taro')
  const productName = options.productName?.trim() || options.packageName

  warnUnsupportedOptions(options, warn)
  setFile('package.json', buildTaroPackageJSON({ ...options, packageName: projectName }))
  setFile('babel.config.js', buildTaroBabelConfig())
  setFile('config/index.ts', buildTaroConfig(projectName))
  setFile('tsconfig.json', buildTaroTsConfig())
  setFile('project.config.json', buildTaroProjectConfig(projectName))
  setFile('.gitignore', buildTaroGitignore())
  setFile('README.md', buildTaroReadme(productName))
  setFile('src/app.ts', buildTaroAppSource())
  setFile('src/app.scss', buildTaroAppStyle())
  setFile(
    'src/app.config.ts',
    buildTaroAppConfig(
      pages.map((page) => page.route),
      productName
    )
  )

  for (const page of pages) {
    const emitted = emitTaroPage(page, environment)
    setFile(`src/${page.directory}/index.tsx`, emitted.source)
    setFile(`src/${page.directory}/index.scss`, emitted.style)
    setFile(`src/${page.directory}/index.config.ts`, buildTaroPageConfig(page.pageName))
  }
  for (const component of componentPlans.values()) {
    const emitted = emitTaroComponent(component, environment)
    setFile(`src/components/${component.slug}.tsx`, emitted.source)
    setFile(`src/components/${component.slug}.scss`, emitted.style)
  }
  emitMiniProgramAssets(assets, (path, content) => setFile(`src/${path}`, content))
  assertMiniProgramProjectBudget(files)
  return { files, warnings }
}

function warnUnsupportedOptions(
  options: CompilerOptions,
  warn: ReturnType<typeof createMiniProgramWarningSink>
): void {
  if (options.router !== 'taro-router') {
    warn({
      code: 'taro-router-option-unsupported',
      message: `Taro ignored incompatible router ${JSON.stringify(options.router)} and emitted Taro page routing`
    })
  }
  const names = [
    options.uiKit ? 'uiKit' : '',
    options.metadata ? 'HTML metadata' : '',
    options.themeCss?.trim() ? 'themeCss' : '',
    options.themeSwitch ? 'themeSwitch' : '',
    options.i18n ? 'i18n runtime' : '',
    options.packaging ? 'microfrontend packaging' : ''
  ].filter(Boolean)
  if (names.length === 0) return
  warn({
    code: 'taro-web-option-unsupported',
    message: `Taro source export omitted web-only compiler option(s): ${names.join(', ')}`
  })
}

export {
  TARO_BABEL_REACT_PRESET_VERSION,
  TARO_BABEL_VERSION,
  TARO_REACT_VERSION,
  TARO_TYPESCRIPT_VERSION,
  TARO_VERSION
} from './constants'
