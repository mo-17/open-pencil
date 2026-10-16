import { type AppBackendProviderHostStore } from './backend-provider'
import {
  applySourceProjectRedistributionFontPolicy,
  buildSourceProjectExportFiles,
  createDefaultSourceProjectExporterDependencies,
  prepareSourceProjectCompilerInput,
  resolveSourceExporterInvocation,
  runSourceProjectExport,
  sourceProjectNames,
  type SourceExporterEditor,
  type SourceProjectExportResult,
  type SourceProjectExporterDependencies
} from './source-exporter-runtime'

export type ReactSourceProjectBuilder = (
  compiledFiles: ReadonlyMap<string, string | Uint8Array>,
  packageName: string,
  productName: string
) => Map<string, string | Uint8Array>

export interface ReactSourceExporterDependencies extends SourceProjectExporterDependencies<SourceExporterEditor> {
  /** Test/embedding seam; the default resolves the live app store only for declared documents. */
  readonly resolveBackendProviderStore?: () =>
    | AppBackendProviderHostStore
    | Promise<AppBackendProviderHostStore>
}

export type ReactSourceProjectExporter = (
  editor: SourceExporterEditor,
  dependenciesOrSignal?: ReactSourceExporterDependencies | AbortSignal,
  signal?: AbortSignal
) => Promise<SourceProjectExportResult>

type ReactSourceExporterTarget = 'nextjs' | 'capacitor' | 'electron'

const TARGETS = Object.freeze({
  nextjs: Object.freeze({
    archiveSuffix: 'nextjs',
    name: 'Next.js',
    description: 'Next.js project',
    fontWarningCode: 'nextjs-font-license-unverified'
  }),
  capacitor: Object.freeze({
    archiveSuffix: 'capacitor',
    name: 'Capacitor',
    description: 'Capacitor project',
    fontWarningCode: 'capacitor-font-license-unverified'
  }),
  electron: Object.freeze({
    archiveSuffix: 'electron',
    name: 'Electron',
    description: 'Electron project',
    fontWarningCode: 'electron-font-license-unverified'
  })
})

export function createReactSourceProjectExporter(
  target: ReactSourceExporterTarget,
  buildProject: ReactSourceProjectBuilder
): ReactSourceProjectExporter {
  const definition = TARGETS[target]
  const defaultDependencies: ReactSourceExporterDependencies =
    createDefaultSourceProjectExporterDependencies<SourceExporterEditor>(definition.description)

  return async (editor, dependenciesOrSignal, explicitSignal) => {
    const { dependencies, signal } =
      resolveSourceExporterInvocation<ReactSourceExporterDependencies>(
        dependenciesOrSignal,
        defaultDependencies,
        explicitSignal
      )
    const names = sourceProjectNames(editor.state.documentName)
    const fileName = `${names.package}-${definition.archiveSuffix}.zip`
    return runSourceProjectExport({
      editor,
      dependencies,
      fileName,
      signal,
      compilerTargetName: definition.name,
      applyFontPolicy: (manifest) =>
        applySourceProjectRedistributionFontPolicy(
          manifest,
          definition.name,
          definition.fontWarningCode
        ),
      createCompilerInput(context) {
        return prepareSourceProjectCompilerInput(
          context,
          names,
          'react',
          dependencies.resolveBackendProviderStore
        )
      },
      buildProject(compiledFiles, warnings) {
        const project = buildProject(compiledFiles, names.package, names.product)
        return buildSourceProjectExportFiles(project, warnings, definition.name)
      }
    })
  }
}
