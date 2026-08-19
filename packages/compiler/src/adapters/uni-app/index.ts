import type { AdapterEmission, FrameworkAdapter } from '#compiler/adapters/types'
import type { ComponentDef, IRTree } from '#compiler/ir/types'
import type { CompileWarning, CompilerOptions } from '#compiler/types'

import {
  assertMiniProgramProjectBudget,
  collectMiniProgramAssets,
  createMiniProgramPagePlan,
  createMiniProgramWarningSink,
  emitMiniProgramAssets,
  setMiniProgramProjectFile,
  uniqueMiniProgramIdentifier,
  uniqueMiniProgramName,
  warnMiniProgramUnsupported
} from '../miniprogram-shared'
import { emitUniAppComponent, emitUniAppPage } from './emit'
import {
  buildUniAppGitignore,
  buildUniAppGlobalStyle,
  buildUniAppMain,
  buildUniAppManifest,
  buildUniAppPages,
  buildUniAppReadme,
  buildUniAppRoot
} from './project'
import type { UniAppComponentPlan } from './types'

const WARNING_PREFIX = 'uni-app'

export const uniAppAdapter: FrameworkAdapter = {
  emit(
    irs: readonly IRTree[],
    options: CompilerOptions,
    components: readonly ComponentDef[] = []
  ): AdapterEmission {
    return emitUniAppProject(irs, options, components)
  }
}

function emitUniAppProject(
  irs: readonly IRTree[],
  options: CompilerOptions,
  components: readonly ComponentDef[]
): AdapterEmission {
  const files = new Map<string, string | Uint8Array>()
  const warnings: CompileWarning[] = []
  const warn = createMiniProgramWarningSink(warnings)
  const pages = createMiniProgramPagePlan(irs, warn, WARNING_PREFIX)
  const assets = collectMiniProgramAssets(irs, components, warn, WARNING_PREFIX)
  const componentPlans = planComponents(components)
  const componentByName = new Map(componentPlans.map((plan) => [plan.definition.name, plan]))
  const environment = { assets, components: componentByName, devMode: options.devMode, warn }
  const setFile = (path: string, value: string | Uint8Array) =>
    setMiniProgramProjectFile(files, path, value)

  warnUnsupportedOptions(options, warn)
  setFile('App.vue', buildUniAppRoot())
  setFile('main.js', buildUniAppMain())
  setFile('manifest.json', buildUniAppManifest(options))
  setFile('pages.json', buildUniAppPages(pages, options))
  setFile('uni.scss', buildUniAppGlobalStyle())
  setFile('.gitignore', buildUniAppGitignore())
  setFile('README.md', buildUniAppReadme())
  for (const page of pages) setFile(`${page.route}.vue`, emitUniAppPage(page.ir, environment))
  for (const component of componentPlans) {
    setFile(component.filePath, emitUniAppComponent(component, environment))
  }
  emitMiniProgramAssets(assets, (path, value) =>
    setFile(`static/${path.startsWith('assets/') ? path.slice('assets/'.length) : path}`, value)
  )
  assertMiniProgramProjectBudget(files)
  return { files, warnings }
}

function planComponents(components: readonly ComponentDef[]): UniAppComponentPlan[] {
  const usedSlugs = new Set<string>()
  const usedSymbols = new Set<string>()
  const usedTags = new Set<string>()
  return components.map((definition) => {
    const slug = uniqueMiniProgramName(definition.name, usedSlugs, 'component')
    const symbol = uniqueMiniProgramIdentifier(
      `Op_${definition.name}`,
      usedSymbols,
      'OpenPencilComponent'
    )
    const tag = `op-${uniqueMiniProgramName(
      definition.name.replace(/[._]/g, '-'),
      usedTags,
      'component'
    )}`
    return {
      definition,
      slug,
      symbol,
      tag,
      filePath: `components/${slug}.vue`
    }
  })
}

function warnUnsupportedOptions(
  options: CompilerOptions,
  warn: ReturnType<typeof createMiniProgramWarningSink>
): void {
  if (options.router !== 'uni-pages') {
    warn({
      code: 'uni-app-router-option-unsupported',
      message: `uni-app ignored incompatible router ${JSON.stringify(options.router)} and emitted pages.json routing`
    })
  }
  if (options.uiKit) warnMiniProgramUnsupported(warn, WARNING_PREFIX, 'ui-kit')
  if (options.metadata) warnMiniProgramUnsupported(warn, WARNING_PREFIX, 'metadata')
  if (options.themeCss?.trim()) warnMiniProgramUnsupported(warn, WARNING_PREFIX, 'theme-css')
  if (options.themeSwitch) warnMiniProgramUnsupported(warn, WARNING_PREFIX, 'theme-switch')
  if (options.i18n) warnMiniProgramUnsupported(warn, WARNING_PREFIX, 'i18n-runtime')
}
