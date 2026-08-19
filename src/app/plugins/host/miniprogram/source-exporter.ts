import {
  assertMiniProgramExportProjectBudget,
  withDefaults,
  type CompilerRouter,
  type MiniProgramCompilerTarget
} from '@open-pencil/compiler'

import { throwIfPluginExportAborted } from '../exporter-abort'
import {
  buildSourceProjectExportFiles,
  createDefaultSourceProjectExporterDependencies,
  resolveSourceExporterInvocation,
  runSourceProjectExport,
  sourceProjectNames,
  type SourceExporterEditor,
  type SourceProjectExporterDependencies,
  type SourceProjectExportResult
} from '../source-exporter-runtime'
import { archiveVueSourceProjectInWorker } from '../vue/archive/client'
import {
  assertMiniProgramCompilerOutputSafe,
  assertMiniProgramProjectArtifactSafe
} from './artifact-security'
import { compileMiniProgramSourceProjectInWorker } from './compiler/client'

export type MiniProgramSourceExportEditor = SourceExporterEditor
export type MiniProgramSourceExportResult = SourceProjectExportResult
export type MiniProgramSourceExporterDependencies =
  SourceProjectExporterDependencies<MiniProgramSourceExportEditor>

interface MiniProgramSourceExporterDefinition {
  archiveSuffix: string
  description: string
  name: string
  router: CompilerRouter
}

export type MiniProgramSourceExporter = (
  editor: MiniProgramSourceExportEditor,
  dependenciesOrSignal?: MiniProgramSourceExporterDependencies | AbortSignal,
  signal?: AbortSignal
) => Promise<MiniProgramSourceExportResult>

const DEFINITIONS: Readonly<
  Record<MiniProgramCompilerTarget, MiniProgramSourceExporterDefinition>
> = Object.freeze({
  'wechat-miniprogram': Object.freeze({
    archiveSuffix: 'wechat-miniprogram',
    description: 'WeChat Mini Program project',
    name: 'WeChat Mini Program',
    router: 'wechat-native'
  }),
  taro: Object.freeze({
    archiveSuffix: 'taro',
    description: 'Taro project',
    name: 'Taro',
    router: 'taro-router'
  }),
  'uni-app': Object.freeze({
    archiveSuffix: 'uni-app',
    description: 'uni-app project',
    name: 'uni-app',
    router: 'uni-pages'
  }),
  mpx: Object.freeze({
    archiveSuffix: 'mpx',
    description: 'Mpx project',
    name: 'Mpx',
    router: 'mpx-router'
  })
})

function createDependencies(description: string): MiniProgramSourceExporterDependencies {
  return Object.freeze({
    ...createDefaultSourceProjectExporterDependencies<MiniProgramSourceExportEditor>(description),
    archive: archiveVueSourceProjectInWorker,
    compile: compileMiniProgramSourceProjectInWorker,
    resolveFontManifest(
      _editor: MiniProgramSourceExportEditor,
      _pageIds: readonly string[],
      signal?: AbortSignal
    ) {
      throwIfPluginExportAborted(signal)
      return Promise.resolve({ faces: [] })
    }
  })
}

const DEFAULT_DEPENDENCIES: Readonly<
  Record<MiniProgramCompilerTarget, MiniProgramSourceExporterDependencies>
> = Object.freeze({
  'wechat-miniprogram': createDependencies(DEFINITIONS['wechat-miniprogram'].description),
  taro: createDependencies(DEFINITIONS.taro.description),
  'uni-app': createDependencies(DEFINITIONS['uni-app'].description),
  mpx: createDependencies(DEFINITIONS.mpx.description)
})

export function createMiniProgramSourceExporter(
  target: MiniProgramCompilerTarget
): MiniProgramSourceExporter {
  const definition = DEFINITIONS[target]
  const defaultDependencies = DEFAULT_DEPENDENCIES[target]
  return async (editor, dependenciesOrSignal, explicitSignal) => {
    const { dependencies, signal } = resolveSourceExporterInvocation(
      dependenciesOrSignal,
      defaultDependencies,
      explicitSignal
    )
    const names = sourceProjectNames(editor.state.documentName)
    return runSourceProjectExport({
      editor,
      dependencies,
      fileName: `${names.package}-${definition.archiveSuffix}.zip`,
      signal,
      compilerTargetName: definition.name,
      createCompilerInput({ pageIds }) {
        return {
          graph: editor.graph,
          pageIds,
          options: withDefaults({
            packageName: names.package,
            productName: names.product,
            target,
            router: definition.router,
            devMode: false
          })
        }
      },
      buildProject(compiledFiles, warnings) {
        assertMiniProgramCompilerOutputSafe({ files: compiledFiles, warnings })
        const project = buildSourceProjectExportFiles(compiledFiles, warnings, definition.name)
        assertMiniProgramProjectArtifactSafe(project)
        assertMiniProgramExportProjectBudget(target, project)
        return project
      }
    })
  }
}

export const exportCurrentDocumentAsWechatMiniProgramSource =
  createMiniProgramSourceExporter('wechat-miniprogram')
export const exportCurrentDocumentAsTaroSource = createMiniProgramSourceExporter('taro')
export const exportCurrentDocumentAsUniAppSource = createMiniProgramSourceExporter('uni-app')
export const exportCurrentDocumentAsMpxSource = createMiniProgramSourceExporter('mpx')
