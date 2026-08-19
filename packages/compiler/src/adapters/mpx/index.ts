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
  uniqueMiniProgramName,
  warnMiniProgramUnsupported
} from '../miniprogram-shared'
import { emitMpxComponent, emitMpxPage } from './emit'
import {
  buildMpxApp,
  buildMpxGitignore,
  buildMpxPackage,
  buildMpxProjectConfig,
  buildMpxReadme,
  buildMpxVueConfig
} from './project'
import type { MpxComponentPlan } from './types'

const PREFIX = 'mpx'

export const mpxAdapter: FrameworkAdapter = {
  emit(irs, options, components = []) {
    return emitMpxProject(irs, options, components)
  }
}

function emitMpxProject(
  irs: readonly IRTree[],
  options: CompilerOptions,
  components: readonly ComponentDef[]
): AdapterEmission {
  const output = new Map<string, string | Uint8Array>()
  const warnings: CompileWarning[] = []
  const warn = createMiniProgramWarningSink(warnings)
  const pages = createMiniProgramPagePlan(irs, warn, PREFIX)
  const assets = collectMiniProgramAssets(irs, components, warn, PREFIX)
  const plannedComponents = componentPlans(components)
  const environment = {
    assets,
    components: new Map(
      plannedComponents.map((component) => [component.definition.name, component])
    ),
    warn
  }
  const put = (path: string, content: string | Uint8Array) =>
    setMiniProgramProjectFile(output, path, content)

  projectOptionWarnings(options, warn)
  const packageName = safeMiniProgramName(options.packageName, 'openpencil-mpx')
  put('package.json', buildMpxPackage(options, packageName))
  put('vue.config.js', buildMpxVueConfig())
  put('project.config.json', buildMpxProjectConfig(packageName))
  put('static/wx/project.config.json', buildMpxProjectConfig(packageName, 'compiled-output'))
  put('.gitignore', buildMpxGitignore())
  put('README.md', buildMpxReadme())
  put('src/app.mpx', buildMpxApp(pages, options.productName ?? options.packageName))
  pages.forEach((page) => put(`src/${page.route}.mpx`, emitMpxPage(page.ir, environment)))
  plannedComponents.forEach((component) =>
    put(component.filePath, emitMpxComponent(component, environment))
  )
  emitMiniProgramAssets(assets, (path, content) => {
    const relative = path.startsWith('assets/') ? path.slice('assets/'.length) : path
    put(`src/assets/${relative}`, content)
  })
  assertMiniProgramProjectBudget(output)
  return { files: output, warnings }
}

function componentPlans(components: readonly ComponentDef[]): MpxComponentPlan[] {
  const allocatedSlugs = new Set<string>()
  const allocatedTags = new Set<string>()
  return components.map((definition) => {
    const slug = uniqueMiniProgramName(definition.name, allocatedSlugs, 'component')
    const tag = `op-${uniqueMiniProgramName(
      definition.name.replace(/[._]/g, '-'),
      allocatedTags,
      'component'
    )}`
    return {
      definition,
      slug,
      tag,
      filePath: `src/components/${slug}.mpx`
    }
  })
}

function projectOptionWarnings(
  options: CompilerOptions,
  warn: ReturnType<typeof createMiniProgramWarningSink>
): void {
  const unsupported: Array<[unknown, string]> = [
    [options.uiKit, 'ui-kit'],
    [options.metadata, 'metadata'],
    [options.themeCss?.trim(), 'theme-css'],
    [options.themeSwitch, 'theme-switch'],
    [options.i18n, 'i18n-runtime']
  ]
  if (options.router !== 'mpx-router') {
    warn({
      code: 'mpx-router-option-unsupported',
      message: `Mpx ignored incompatible router ${JSON.stringify(options.router)} and emitted native page routing`
    })
  }
  for (const [enabled, feature] of unsupported) {
    if (enabled) warnMiniProgramUnsupported(warn, PREFIX, feature)
  }
}

export {
  MPX_CLI_PLUGIN_VERSION,
  MPX_CLI_SERVICE_VERSION,
  MPX_CORE_VERSION,
  PROCESS_BROWSER_VERSION,
  VUE_CLI_SERVICE_VERSION
} from './project'
