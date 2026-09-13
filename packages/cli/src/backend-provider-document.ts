import type { CompilerBackendProviderRequest } from '@open-pencil/compiler'
import {
  resolveBackendProviderCompileHandoff,
  type BackendProviderCompileHandoff
} from '@open-pencil/compiler/backend'
import type { ApplicationRuntimeGraph } from '@open-pencil/lowcode/application-runtime'

import type { CodegenWebTarget } from '#cli/codegen-target'

function declarations(graph: Pick<ApplicationRuntimeGraph, 'rootId' | 'getNode'>) {
  return (graph.getNode(graph.rootId)?.pluginData ?? []).filter(
    (entry) => entry.pluginId === 'open-pencil' && entry.key === 'lowcode/backendProvider.v1'
  )
}

export function hasCLIBackendProviderDeclaration(graph: ApplicationRuntimeGraph): boolean {
  return declarations(graph).length > 0
}

/** Document data alone cannot select a live App Provider for an ordinary CLI compile. */
export function resolveCLIBackendProviderRequest(
  graph: ApplicationRuntimeGraph,
  handoff: BackendProviderCompileHandoff | undefined,
  target: CodegenWebTarget
): CompilerBackendProviderRequest | undefined {
  const matches = declarations(graph)
  if (matches.length > 0 && !handoff) {
    throw new Error(
      'This document declares an App Backend Provider. Export or deploy it through the Desktop Host so the installed Provider can be reviewed; direct CLI compilation cannot infer that authority.'
    )
  }
  if (!handoff) return undefined
  if (matches.length !== 1) {
    throw new Error('Backend Provider handoff requires exactly one saved document declaration.')
  }
  return resolveBackendProviderCompileHandoff(handoff, matches[0].value, target)
}
