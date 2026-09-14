import type {
  BackendApplicationSpecV1,
  BackendModuleDefinitionIR
} from '@open-pencil/lowcode/backend'

export interface NestJSBusinessModule {
  definition: BackendModuleDefinitionIR
  index: number
  className: string
  directory: string
}

/** Stable ordinals keep user-controlled IDs out of TypeScript identifiers. */
export function nestJSBusinessModules(
  application: BackendApplicationSpecV1
): NestJSBusinessModule[] {
  return [...(application.modules?.modules ?? [])]
    .sort((left, right) => left.id.localeCompare(right.id, 'en'))
    .map((definition, index) => ({
      definition,
      index,
      className: 'BusinessModule' + index,
      directory: 'modules/' + definition.id
    }))
}

export function nestJSBusinessModuleImports(application: BackendApplicationSpecV1): {
  imports: string[]
  modules: string[]
} {
  const modules = nestJSBusinessModules(application)
  return {
    imports: modules.map(
      (module) => `import { ${module.className} } from './${module.directory}/module.js'`
    ),
    modules: modules.map((module) => module.className)
  }
}
