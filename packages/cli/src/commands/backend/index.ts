import { defineCommand } from 'citty'

import { bold, fmtList, ok } from '#cli/format'

import {
  applicationArg,
  auditReceipt,
  backendProviderArg,
  createLocalBackendEmission,
  createLocalBackendPlan,
  environmentArg,
  gatesArg,
  jsonArg,
  loadBackendApplication,
  loadProductionReadiness,
  modeArg,
  receiptArg,
  resolveCompilationMode,
  resolveCompilerTarget,
  resolveReleaseEnvironment,
  runBackendCommandSafely,
  targetArg,
  writeBackendEmission,
  type BackendPipelineOptions,
  type LocalBackendEmission,
  type ReceiptAudit
} from './common'

interface PipelineArgs {
  readonly application: string
  readonly 'backend-provider': string
  readonly target: string
  readonly mode: string
}

interface AuditPipelineArgs extends PipelineArgs {
  readonly environment: string
  readonly gates?: string
  readonly receipt?: string
}

function pipelineOptions(args: PipelineArgs): BackendPipelineOptions {
  return {
    applicationPath: args.application,
    backendProvider: args['backend-provider'],
    target: resolveCompilerTarget(args.target),
    mode: resolveCompilationMode(args.mode)
  }
}

function frontendHostingProvider(value: string | undefined): string | null {
  if (value === undefined) return null
  const normalized = value.trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(normalized)) {
    throw new Error('--frontend-hosting-provider must be a bounded provider identifier.')
  }
  return normalized
}

function printReport(title: string, report: Record<string, unknown>, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(report, null, 2))
    return
  }
  console.log('')
  console.log(bold(`  ${title}`))
  console.log('')
  console.log(
    fmtList([
      {
        header: report.releaseReady === true ? ok('release-ready') : title,
        details: report
      }
    ])
  )
  console.log('')
}

function localPlanReport(
  operation: 'plan' | 'emit' | 'audit' | 'release',
  planned: LocalBackendEmission | Awaited<ReturnType<typeof createLocalBackendPlan>>
): Record<string, unknown> {
  return {
    format: `openpencil.backend-cli-${operation}.v1`,
    version: 1,
    operation,
    applicationId: planned.application.applicationId,
    applicationDigest: planned.applicationDigest,
    frontendHostingProvider: null,
    backendProvider: planned.backendProvider,
    backendProviderTrustDomain: planned.backendProviderTrustDomain,
    backendDeploymentRequired: true,
    target: planned.plan.target,
    mode: planned.plan.mode,
    plan: planned.plan,
    diagnostics: planned.diagnostics
  }
}

function receiptBlocksAudit(receipt: ReceiptAudit): boolean {
  return !receipt.accepted
}

async function createLocalBackendAudit(args: AuditPipelineArgs) {
  const environment = resolveReleaseEnvironment(args.environment)
  const emitted = await createLocalBackendEmission(pipelineOptions(args))
  const [readiness, receipt] = await Promise.all([
    loadProductionReadiness(args.gates),
    auditReceipt(args.receipt, emitted, environment)
  ])
  return { emitted, environment, readiness, receipt }
}

const pipelineArgs = {
  application: applicationArg,
  'backend-provider': backendProviderArg,
  target: targetArg,
  mode: modeArg
} as const

const auditArgs = {
  ...pipelineArgs,
  environment: environmentArg,
  gates: gatesArg,
  receipt: receiptArg,
  'frontend-hosting-provider': {
    type: 'string',
    description: 'Frontend hosting provider label; no frontend deployment is performed'
  }
} as const

const validate = defineCommand({
  meta: { description: 'Validate a bounded BackendApplicationSpecV1 locally' },
  args: { application: applicationArg, json: jsonArg },
  async run({ args }) {
    await runBackendCommandSafely(async () => {
      const loaded = await loadBackendApplication(args.application)
      printReport(
        'Validated Backend application',
        {
          format: 'openpencil.backend-cli-validation.v1',
          version: 1,
          operation: 'validate',
          valid: true,
          applicationId: loaded.application.applicationId,
          applicationDigest: loaded.applicationDigest,
          frontendHostingProvider: null,
          backendProvider: null,
          backendDeploymentRequired: true,
          diagnostics: []
        },
        args.json
      )
    })
  }
})

const plan = defineCommand({
  meta: { description: 'Create a deterministic, provider-authority-bound Backend plan locally' },
  args: { ...pipelineArgs, json: jsonArg },
  async run({ args }) {
    await runBackendCommandSafely(async () => {
      const planned = await createLocalBackendPlan(pipelineOptions(args))
      printReport('Planned Backend artifacts', localPlanReport('plan', planned), args.json)
    })
  }
})

const emit = defineCommand({
  meta: { description: 'Emit deterministic Backend artifacts locally without Apply' },
  args: {
    ...pipelineArgs,
    output: {
      type: 'string',
      alias: 'o',
      required: true,
      description: 'New output directory; existing paths are never overwritten'
    },
    json: jsonArg
  },
  async run({ args }) {
    await runBackendCommandSafely(async () => {
      const emitted = await createLocalBackendEmission(pipelineOptions(args))
      const written = await writeBackendEmission(args.output, emitted.emission)
      printReport(
        'Emitted Backend artifacts',
        {
          ...localPlanReport('emit', emitted),
          output: written.output,
          files: written.files,
          artifactManifest: emitted.emission.manifest,
          artifactManifestDigest: emitted.emission.manifestDigest,
          applyAvailable: false,
          applyPerformed: false
        },
        args.json
      )
    })
  }
})

const audit = defineCommand({
  meta: { description: 'Audit local Backend artifacts, strict gates, and a secret-free receipt' },
  args: { ...auditArgs, json: jsonArg },
  async run({ args }) {
    await runBackendCommandSafely(async () => {
      const { emitted, environment, readiness, receipt } = await createLocalBackendAudit(args)
      const auditPassed = readiness.releaseReady && !receiptBlocksAudit(receipt)
      printReport(
        'Audited Backend release inputs',
        {
          ...localPlanReport('audit', emitted),
          environment,
          frontendHostingProvider: frontendHostingProvider(args['frontend-hosting-provider']),
          artifactManifest: emitted.emission.manifest,
          artifactManifestDigest: emitted.emission.manifestDigest,
          strictProductionGatesReady: readiness.releaseReady,
          gateEvidenceTrusted: false,
          gates: readiness.gates,
          blockers: readiness.blockers,
          receipt,
          auditPassed,
          releaseReady: false,
          applyAvailable: false,
          applyPerformed: false
        },
        args.json
      )
      if (!auditPassed) process.exitCode = 1
    })
  }
})

const release = defineCommand({
  meta: {
    description:
      'Run local validate, plan, emit, and audit only; remote Backend Apply is unavailable'
  },
  args: {
    ...auditArgs,
    output: {
      type: 'string',
      alias: 'o',
      required: true,
      description: 'New local artifact directory; existing paths are never overwritten'
    },
    json: jsonArg
  },
  async run({ args }) {
    await runBackendCommandSafely(async () => {
      const { emitted, environment, readiness, receipt } = await createLocalBackendAudit(args)
      const written = await writeBackendEmission(args.output, emitted.emission)
      printReport(
        'Backend release blocked before Apply',
        {
          ...localPlanReport('release', emitted),
          status: 'blocked-before-apply',
          environment,
          frontendHostingProvider: frontendHostingProvider(args['frontend-hosting-provider']),
          output: written.output,
          files: written.files,
          artifactManifest: emitted.emission.manifest,
          artifactManifestDigest: emitted.emission.manifestDigest,
          strictProductionGatesReady: readiness.releaseReady,
          gateEvidenceTrusted: false,
          gates: readiness.gates,
          blockers: readiness.blockers,
          receipt,
          receiptIssued: false,
          releaseReady: false,
          backendDeploymentRequired: true,
          applyAvailable: false,
          applyPerformed: false,
          automaticRetryAllowed: false
        },
        args.json
      )
      process.exitCode = 1
    })
  }
})

export default defineCommand({
  meta: {
    description: 'Validate, plan, emit, and audit Backend artifacts without network or Apply'
  },
  subCommands: { validate, plan, emit, audit, release }
})
