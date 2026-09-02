import { validateSupabaseConfig } from '@open-pencil/lowcode'
import {
  auditApplicationRuntime,
  type ApplicationRuntimeAudit,
  type ApplicationRuntimeGraph
} from '@open-pencil/lowcode/application-runtime'
import type { SupabaseConfig } from '@open-pencil/scene-graph'

import { readCachedSupabaseSchemaCatalog } from '@/app/lowcode/supabase/cache'
import {
  normalizeSupabaseSchemaName,
  projectRefFromSupabaseURL
} from '@/app/lowcode/supabase/management-client'

import type { DeployEnvironment, DeployRuntimeConfig } from './history'

export interface DeployRuntimePreflightOptions {
  graph: ApplicationRuntimeGraph
  environment: DeployEnvironment
  runtimeConfig?: DeployRuntimeConfig
  knownTables?: readonly string[]
  rlsVerified?: boolean
  serverWorkflowsDeployed?: boolean
  /** Host-trusted fact from fresh, exact Backend receipt/evidence; static deploy callers omit it. */
  backendDeploymentVerified?: boolean
  /** Set only after resolving a provider-neutral BackendApplicationSpec through the live host. */
  backendProviderDeclared?: boolean
}

/** Build the configuration that the generated browser runtime can actually
 * consume. Environment overrides may replace a valid emitted design-time
 * configuration, but cannot create a runtime that the compiler omitted. */
export function resolveEffectiveDeploySupabaseConfig(
  graph: ApplicationRuntimeGraph,
  runtimeConfig?: DeployRuntimeConfig
): SupabaseConfig | null | undefined {
  const designConfig = graph.getNode(graph.rootId)?.lowcodeSupabaseConfig
  if (!designConfig) return null
  if (!validateSupabaseConfig(designConfig).ok) return designConfig
  return {
    url: runtimeConfig?.supabaseUrl ?? designConfig.url,
    anonKey:
      runtimeConfig?.supabasePublishableKey ??
      runtimeConfig?.supabaseAnonKey ??
      designConfig.anonKey,
    schema: runtimeConfig?.supabaseSchema ?? designConfig.schema
  }
}

/** Read only a current normalized catalog. PATs and raw OpenAPI responses are
 * never involved in deployment; a miss remains an explicit unverified warning. */
export async function readDeployKnownTables(
  config: SupabaseConfig | null | undefined
): Promise<string[] | undefined> {
  if (!config || !validateSupabaseConfig(config).ok) return undefined
  try {
    const catalog = await readCachedSupabaseSchemaCatalog({
      projectRef: projectRefFromSupabaseURL(config.url),
      schema: normalizeSupabaseSchemaName(config.schema)
    })
    return catalog?.tables.map((table) => table.name)
  } catch {
    return undefined
  }
}

export function auditDeployRuntime(
  options: DeployRuntimePreflightOptions
): ApplicationRuntimeAudit {
  return auditApplicationRuntime(options.graph, {
    environment: options.environment,
    effectiveSupabaseConfig: resolveEffectiveDeploySupabaseConfig(
      options.graph,
      options.runtimeConfig
    ),
    knownTables: options.knownTables,
    rlsVerified: options.rlsVerified,
    serverWorkflowsDeployed: options.serverWorkflowsDeployed,
    backendDeploymentVerified: options.backendDeploymentVerified,
    backendProviderDeclared: options.backendProviderDeclared
  })
}

/** Shared Desktop preflight for every static deployment entry point. It is read-only and
 * secret-free; a missing schema cache remains a warning rather than bypassing the audit. */
export async function preflightDeployRuntime(
  options: DeployRuntimePreflightOptions
): Promise<ApplicationRuntimeAudit> {
  const knownTables =
    options.knownTables ??
    (await readDeployKnownTables(
      resolveEffectiveDeploySupabaseConfig(options.graph, options.runtimeConfig)
    ))
  return auditDeployRuntime({ ...options, knownTables })
}
