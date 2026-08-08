import {
  auditApplicationRuntime,
  type ApplicationRuntimeEnvironment
} from '#core/lowcode-validation/application-runtime'
import { defineTool } from '#core/tools/schema'

const RUNTIME_ENVIRONMENTS: readonly ApplicationRuntimeEnvironment[] = [
  'preview',
  'staging',
  'production'
]

export const auditApplicationRuntimeTool = defineTool({
  name: 'audit_application_runtime',
  description:
    'Audit the current document as a deployable lowcode application. Reports Supabase configuration readiness, client and server table/RLS requirements, schema-catalog mismatches, server workflow validation, required server environment variable names, and remaining server deployment work. This is read-only and never returns keys or secret values. Live schema and RLS status are not guessed: pass known_tables from a trusted schema inspection and set verification flags only after the external checks are complete.',
  params: {
    environment: {
      type: 'string',
      description: 'Target runtime environment',
      enum: [...RUNTIME_ENVIRONMENTS],
      default: 'preview'
    },
    known_tables: {
      type: 'array',
      description: 'Optional table names from a current trusted schema catalog',
      items: { type: 'string', description: 'Schema table name' },
      maxItems: 256
    },
    rls_verified: {
      type: 'boolean',
      description: 'True only after an operator has reviewed and applied the target production RLS',
      default: false
    },
    server_workflows_deployed: {
      type: 'boolean',
      description: 'True only after the generated server runtime is live in the target project',
      default: false
    }
  },
  execute: (figma, args) => {
    const environment = args.environment ?? 'preview'
    if (!RUNTIME_ENVIRONMENTS.includes(environment as ApplicationRuntimeEnvironment)) {
      return { ok: false, error: `Unknown application runtime environment "${environment}"` }
    }
    return {
      ok: true,
      data: auditApplicationRuntime(figma.graph, {
        environment: environment as ApplicationRuntimeEnvironment,
        knownTables: args.known_tables,
        rlsVerified: args.rls_verified === true,
        serverWorkflowsDeployed: args.server_workflows_deployed === true
      })
    }
  }
})
