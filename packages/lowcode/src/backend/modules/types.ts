export const BACKEND_MODULE_IR_VERSION = 1 as const

/** Reviewed ownership and dependency metadata, never an authorization grant. */
export interface BackendModuleDefinitionIR {
  id: string
  name: string
  entityIds: string[]
  resourceIds: string[]
  commandIds: string[]
  dependsOn: string[]
}

export interface BackendModuleIRV1 {
  version: typeof BACKEND_MODULE_IR_VERSION
  modules: BackendModuleDefinitionIR[]
}
