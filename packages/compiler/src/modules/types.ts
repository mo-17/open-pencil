import type { NodeType, SceneNode } from '@open-pencil/scene-graph'

export type CompilerModulePayload = Record<string, unknown>

export type CompilerModuleLoweringResult =
  | { ok: true; payload: CompilerModulePayload; configVersion?: number }
  | { ok: false; reason: string }

/** SceneGraph -> framework-neutral module payload. The resolver remains owned
 * by the module package; the compiler only dispatches by the trusted identity. */
export interface CompilerModuleLowerer {
  pluginId: string
  moduleType: string
  warningCodePrefix: string
  displayName: string
  hostTypes: readonly NodeType[]
  lower(value: unknown, node: SceneNode): CompilerModuleLoweringResult
}

/** One registration unit for a trusted compiler module. Framework targets are
 * intentionally opaque here so the IR layer never imports adapter contracts. */
export interface CompilerModuleBundle {
  lowerer: CompilerModuleLowerer
  targets: Readonly<Record<string, unknown>>
}
