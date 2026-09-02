import type { ApplicationRuntimeAudit } from '@open-pencil/lowcode/application-runtime'
import type { BackendReleaseStateV1 } from '@open-pencil/lowcode/backend'
import { parsePluginObjectParameterValue } from '@open-pencil/plugin-contracts'
import type { SceneGraph } from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import type { EditorStore } from '@/app/editor/active-store'
import {
  deployDocumentScope,
  deployRuntimeConfigSnapshot,
  type DeployEnvironment,
  type DeployRuntimeConfig
} from '@/app/lowcode/preview-pane/deploy/history'
import {
  runDeployCLI,
  type DeployI18n,
  type DeployUIKit
} from '@/app/lowcode/preview-pane/deploy/runner'
import {
  preflightDeployRuntime,
  type DeployRuntimePreflightOptions
} from '@/app/lowcode/preview-pane/deploy/runtime-preflight'
import { deployScopeForStore } from '@/app/lowcode/preview-pane/deploy/scope'
import type { CredentialResolver } from '@/app/settings/credentials/types'
import { isTauri } from '@/app/tauri/env'

import {
  AppBackendProviderBuildError,
  prepareAppBackendProviderDocumentBuild,
  readAppBackendProviderDocumentRequest,
  resolveAppBackendProviderReleaseAuthority,
  type AppBackendProviderHostStore,
  type PreparedAppBackendProviderBuild
} from '../backend-provider'
import { cancelAppBackendReleaseReview, prepareAppBackendReleaseReview } from './backend/release'
import { type DeploymentPluginDefinition, type DeploymentPluginProvider } from './contract'
import { boundedDeploymentText } from './text'

export type DeploymentPluginErrorCode =
  | 'invalid-parameters'
  | 'desktop-required'
  | 'saved-document-required'
  | 'review-required'
  | 'review-changed'
  | 'confirmation-required'
  | 'confirmation-denied'
  | 'runtime-preflight-failed'
  | 'backend-provider-request-invalid'
  | 'backend-provider-unavailable'
  | 'backend-provider-build-failed'
  | 'credential-missing'
  | 'aborted'
  | 'outcome-unknown'
  | 'result-mismatch'

export class DeploymentPluginError extends Error {
  constructor(
    readonly code: DeploymentPluginErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'DeploymentPluginError'
  }
}

export interface DeploymentPluginParameters {
  readonly environment: DeployEnvironment
  readonly target?: string
  readonly uiKit: DeployUIKit
  readonly locales: readonly string[]
  readonly runtimeConfig?: DeployRuntimeConfig
}

export interface DeploymentPluginReview {
  readonly pluginId: string
  readonly contributionId: string
  readonly provider: DeploymentPluginProvider
  readonly environment: DeployEnvironment
  readonly target: string
  readonly uiKit: DeployUIKit
  readonly locales: readonly string[]
  readonly hasRuntimeOverrides: boolean
  readonly environmentNotice: string
  readonly sideEffects: readonly string[]
  readonly credentialLabel: string
  /** Safe basename or bounded remote document ID for the host confirmation UI. */
  readonly documentLabel: string
  /** Host-private opaque identity. Never include this value in the MCP-safe plan result. */
  readonly documentIdentity: string
  /** Secret-free exact Backend Provider build authority bound into this confirmation. */
  readonly backendProvider?: DeploymentPluginBackendProviderReview
}

export interface DeploymentPluginBackendProviderReview {
  readonly pluginId: string
  readonly contributionId: string
  readonly providerId: string
  readonly adapterId: string
  readonly packageDigest: string
  readonly applicationDigest: string
  readonly planDigest: string
  readonly manifestDigest: string
}

export interface DeploymentPluginPlan extends JSONObject {
  readonly provider: DeploymentPluginProvider
  readonly environment: DeployEnvironment
  readonly target: string
  readonly documentSaved: boolean
  readonly requiresConfirmation: true
  readonly environmentNotice: string
  readonly sideEffects: readonly string[]
}

export interface DeploymentPluginResult extends JSONObject {
  readonly provider: DeploymentPluginProvider
  readonly environment: DeployEnvironment
  readonly url: string
  readonly deployId: string
  readonly fileCount: number
  readonly backendDeploymentRequired: boolean
}

export interface DeploymentPluginExecutionOptions {
  readonly signal?: AbortSignal
  readonly confirm?: (review: DeploymentPluginReview) => boolean | Promise<boolean>
  /** Exact host review snapshot shown to the user for this invocation. */
  readonly expectedReview?: DeploymentPluginReview
  /** Receives secret-free authenticated Release Core states; it cannot authorize Backend Apply. */
  readonly onBackendReleaseState?: (state: BackendReleaseStateV1) => void
}

export type DeploymentPluginRunner = typeof runDeployCLI
export type DeploymentPluginRuntimePreflight = (
  options: DeployRuntimePreflightOptions
) => Promise<ApplicationRuntimeAudit>

export interface DeploymentPluginHostAdapter {
  readonly definition: DeploymentPluginDefinition
  review(editor: EditorStore, parameters: unknown): DeploymentPluginReview
  execute(
    editor: EditorStore,
    parameters: unknown,
    options?: DeploymentPluginExecutionOptions
  ): Promise<DeploymentPluginResult>
}

const LOCALE = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/
const VERCEL_PROJECT = /^[a-z0-9](?:[a-z0-9._-]{0,98}[a-z0-9])?$/
const CLOUDFLARE_ACCOUNT = /^[A-Za-z0-9_-]{1,64}$/
const CLOUDFLARE_PROJECT = /^[a-z0-9](?:[a-z0-9-]{0,56}[a-z0-9])?$/
const DOCUMENT_LABEL_MAX_LENGTH = 160
const DOCUMENT_IDENTITY_MAX_LENGTH = 192

export const DEPLOYMENT_PLUGIN_DOCUMENT_LIMITS = Object.freeze({
  maxLabelLength: DOCUMENT_LABEL_MAX_LENGTH,
  maxIdentityLength: DOCUMENT_IDENTITY_MAX_LENGTH
})

interface ParsedParameterRecord {
  environment?: unknown
  target?: unknown
  uiKit?: unknown
  locales?: unknown
  runtimeConfig?: unknown
}

function invalidParameters(message: string, cause?: unknown): never {
  throw new DeploymentPluginError(
    'invalid-parameters',
    message,
    cause instanceof Error ? { cause } : undefined
  )
}

function normalizedTarget(
  definition: DeploymentPluginDefinition,
  value: unknown
): string | undefined {
  if (value === undefined) {
    if (definition.ui.targetRequired) invalidParameters(`${definition.name} requires a target.`)
    return undefined
  }
  if (typeof value !== 'string') invalidParameters(`${definition.name} target must be a string.`)
  const target = value.normalize('NFC').trim()
  if (!target) {
    if (definition.ui.targetRequired) invalidParameters(`${definition.name} requires a target.`)
    return undefined
  }
  if (definition.provider === 'vercel') {
    if (!VERCEL_PROJECT.test(target)) {
      invalidParameters(
        'Vercel project must be a lowercase project name of at most 100 characters.'
      )
    }
    return target
  }
  const parts = target.split('/')
  if (
    parts.length !== 2 ||
    !CLOUDFLARE_ACCOUNT.test(parts[0] ?? '') ||
    !CLOUDFLARE_PROJECT.test(parts[1] ?? '')
  ) {
    invalidParameters('Cloudflare target must use account-id/project-name format.')
  }
  return target
}

function normalizedLocales(value: unknown): readonly string[] {
  if (value === undefined) return Object.freeze([])
  if (!Array.isArray(value)) invalidParameters('Deployment locales must be an array.')
  const normalized = value.map((entry) => {
    if (typeof entry !== 'string' || !LOCALE.test(entry)) {
      invalidParameters('Deployment locales must use bounded BCP 47-style language tags.')
    }
    return entry
  })
  if (new Set(normalized.map((locale) => locale.toLowerCase())).size !== normalized.length) {
    invalidParameters('Deployment locales must not contain duplicates.')
  }
  return Object.freeze(normalized)
}

function normalizedRuntimeConfig(value: unknown): DeployRuntimeConfig | undefined {
  if (value === undefined) return undefined
  try {
    return deployRuntimeConfigSnapshot(value as DeployRuntimeConfig)
  } catch (cause) {
    return invalidParameters(
      cause instanceof Error ? cause.message : 'Runtime configuration is invalid.',
      cause
    )
  }
}

export function parseDeploymentPluginParameters(
  definition: DeploymentPluginDefinition,
  value: unknown
): DeploymentPluginParameters {
  let parsed: ParsedParameterRecord
  try {
    parsed = parsePluginObjectParameterValue(
      value ?? {},
      definition.parameters.schema,
      definition.parameters.maxBytes,
      `${definition.name} parameters`
    ) as ParsedParameterRecord
  } catch (cause) {
    invalidParameters(
      cause instanceof Error ? cause.message : 'Deployment parameters are invalid.',
      cause
    )
  }
  const environment = (parsed.environment ?? 'preview') as DeployEnvironment
  const uiKit = (parsed.uiKit ?? 'none') as DeployUIKit
  const target = normalizedTarget(definition, parsed.target)
  return Object.freeze({
    environment,
    ...(target ? { target } : {}),
    uiKit,
    locales: normalizedLocales(parsed.locales),
    runtimeConfig: normalizedRuntimeConfig(parsed.runtimeConfig)
  })
}

function savedDocumentPath(editor: EditorStore): string {
  const path = editor.getDocumentPath()?.trim()
  if (!path) {
    throw new DeploymentPluginError(
      'saved-document-required',
      'Save the current document before deploying it.'
    )
  }
  return path
}

function boundedDocumentLabel(value: string, fallback: string): string {
  return boundedDeploymentText(value, fallback, DOCUMENT_LABEL_MAX_LENGTH, {
    collapseWhitespace: true
  })
}

function documentPathLabel(path: string): string {
  const segments = path.split(/[\\/]/u)
  return boundedDocumentLabel(segments.at(-1) ?? '', 'Saved OpenPencil document')
}

function deploymentDocumentReview(
  editor: EditorStore,
  path: string
): Pick<DeploymentPluginReview, 'documentLabel' | 'documentIdentity'> {
  const binding = editor.getStorageBinding()
  const documentLabel = binding
    ? boundedDocumentLabel(binding.documentId, 'Remote OpenPencil document')
    : documentPathLabel(path)
  const documentScope = deployScopeForStore(editor)
  const pathScope = deployDocumentScope({ kind: 'path', path })
  const documentIdentity = [documentScope, pathScope].filter(Boolean).join('\0')
  if (!documentScope || !pathScope || documentIdentity.length > DOCUMENT_IDENTITY_MAX_LENGTH) {
    throw new DeploymentPluginError(
      'review-required',
      'The current document identity is unavailable. Review the deployment again.'
    )
  }
  return Object.freeze({ documentLabel, documentIdentity })
}

function reviewFor(
  editor: EditorStore,
  definition: DeploymentPluginDefinition,
  parameters: DeploymentPluginParameters,
  path: string,
  backendProvider?: DeploymentPluginBackendProviderReview
): DeploymentPluginReview {
  return Object.freeze({
    pluginId: definition.pluginId,
    contributionId: definition.contributionId,
    provider: definition.provider,
    environment: parameters.environment,
    target: parameters.target ?? 'New default OpenPencil project',
    uiKit: parameters.uiKit,
    locales: parameters.locales,
    hasRuntimeOverrides: parameters.runtimeConfig !== undefined,
    environmentNotice: definition.ui.environmentNotice,
    sideEffects: definition.ui.confirmationItems,
    credentialLabel: definition.ui.tokenLabel,
    ...(backendProvider ? { backendProvider } : {}),
    ...deploymentDocumentReview(editor, path)
  })
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function reviewMatches(expected: DeploymentPluginReview, current: DeploymentPluginReview): boolean {
  return (
    expected.pluginId === current.pluginId &&
    expected.contributionId === current.contributionId &&
    expected.provider === current.provider &&
    expected.environment === current.environment &&
    expected.target === current.target &&
    expected.uiKit === current.uiKit &&
    Array.isArray(expected.locales) &&
    sameStrings(expected.locales, current.locales) &&
    expected.hasRuntimeOverrides === current.hasRuntimeOverrides &&
    expected.environmentNotice === current.environmentNotice &&
    Array.isArray(expected.sideEffects) &&
    sameStrings(expected.sideEffects, current.sideEffects) &&
    expected.credentialLabel === current.credentialLabel &&
    expected.documentLabel === current.documentLabel &&
    expected.documentIdentity === current.documentIdentity &&
    sameBackendProviderReview(expected.backendProvider, current.backendProvider)
  )
}

function sameBackendProviderReview(
  expected: DeploymentPluginBackendProviderReview | undefined,
  current: DeploymentPluginBackendProviderReview | undefined
): boolean {
  if (!expected || !current) return expected === current
  return (
    expected.pluginId === current.pluginId &&
    expected.contributionId === current.contributionId &&
    expected.providerId === current.providerId &&
    expected.adapterId === current.adapterId &&
    expected.packageDigest === current.packageDigest &&
    expected.applicationDigest === current.applicationDigest &&
    expected.planDigest === current.planDigest &&
    expected.manifestDigest === current.manifestDigest
  )
}

function backendProviderReview(
  build: PreparedAppBackendProviderBuild
): DeploymentPluginBackendProviderReview {
  return Object.freeze({
    pluginId: build.descriptor.pluginId,
    contributionId: build.descriptor.contributionId,
    providerId: build.descriptor.providerId,
    adapterId: build.descriptor.adapterId,
    packageDigest: build.descriptor.packageAuthority.packageDigest,
    applicationDigest: build.plan.applicationDigest,
    planDigest: build.plan.planDigest,
    manifestDigest: build.emission.manifestDigest
  })
}

function backendProviderFailure(cause: unknown): never {
  if (!(cause instanceof AppBackendProviderBuildError)) throw cause
  let code: DeploymentPluginErrorCode = 'backend-provider-build-failed'
  if (cause.code === 'request-invalid') code = 'backend-provider-request-invalid'
  if (cause.code === 'provider-unavailable') code = 'backend-provider-unavailable'
  throw new DeploymentPluginError(code, cause.message, { cause })
}

function runtimeEditorGraph(editor: EditorStore): SceneGraph | undefined {
  return Reflect.get(editor, 'graph')
}

function prepareBackendProviderBuild(
  editor: EditorStore,
  store: AppBackendProviderHostStore | undefined
): PreparedAppBackendProviderBuild | null {
  try {
    const graph = runtimeEditorGraph(editor)
    if (!graph) return null
    if (!store) {
      if (!readAppBackendProviderDocumentRequest(graph)) return null
      throw new AppBackendProviderBuildError(
        'provider-unavailable',
        'Backend Provider host lifecycle is unavailable for this deployment.'
      )
    }
    return prepareAppBackendProviderDocumentBuild(store, graph, {
      target: 'react',
      mode: 'production'
    })
  } catch (cause) {
    return backendProviderFailure(cause)
  }
}

function reviewedExecution(
  editor: EditorStore,
  definition: DeploymentPluginDefinition,
  parameters: DeploymentPluginParameters,
  expected: DeploymentPluginReview | undefined,
  backendProviderStore: AppBackendProviderHostStore | undefined
): Readonly<{
  path: string
  review: DeploymentPluginReview
  backendProviderBuild: PreparedAppBackendProviderBuild | null
}> {
  const path = savedDocumentPath(editor)
  const backendProviderBuild = prepareBackendProviderBuild(editor, backendProviderStore)
  const review = reviewFor(
    editor,
    definition,
    parameters,
    path,
    backendProviderBuild ? backendProviderReview(backendProviderBuild) : undefined
  )
  if (!expected) {
    throw new DeploymentPluginError(
      'review-required',
      'Deployment requires the exact host review shown to the user for this invocation.'
    )
  }
  if (!reviewMatches(expected, review)) {
    throw new DeploymentPluginError(
      'review-changed',
      'The document or deployment settings changed after review. Review them again before deploying.'
    )
  }
  return Object.freeze({ path, review, backendProviderBuild })
}

async function reviewedBackendReleaseState(
  execution: ReturnType<typeof reviewedExecution>,
  parameters: DeploymentPluginParameters,
  backendProviderStore: AppBackendProviderHostStore | undefined,
  onTransition: DeploymentPluginExecutionOptions['onBackendReleaseState']
): Promise<BackendReleaseStateV1 | null> {
  const build = execution.backendProviderBuild
  if (!build) return null
  const backendProvider = backendProviderStore
    ? resolveAppBackendProviderReleaseAuthority(backendProviderStore, build.descriptor)
    : null
  if (!backendProvider) {
    throw new DeploymentPluginError(
      'backend-provider-unavailable',
      'Backend Provider authority changed before Release review. Review the deployment again.'
    )
  }
  return prepareAppBackendReleaseReview({
    build,
    backendProvider,
    documentIdentity: execution.review.documentIdentity,
    environment: parameters.environment,
    ...(onTransition ? { onTransition } : {})
  })
}

/** MCP-safe plan: bounded validation and disclosure only; no credential read, build, or network. */
export function buildDeploymentPluginPlan(
  editor: EditorStore,
  definition: DeploymentPluginDefinition,
  value: unknown
): DeploymentPluginPlan {
  const parameters = parseDeploymentPluginParameters(definition, value)
  const review = {
    provider: definition.provider,
    environment: parameters.environment,
    target: parameters.target ?? 'New default OpenPencil project',
    environmentNotice: definition.ui.environmentNotice,
    sideEffects: definition.ui.confirmationItems
  }
  return Object.freeze({
    provider: review.provider,
    environment: review.environment,
    target: review.target,
    documentSaved: Boolean(editor.getDocumentPath()?.trim()),
    requiresConfirmation: true,
    environmentNotice: review.environmentNotice,
    sideEffects: review.sideEffects
  })
}

function abortBeforeDispatch(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  throw new DeploymentPluginError('aborted', 'Deployment was cancelled before remote dispatch.')
}

function validatedResult(
  definition: DeploymentPluginDefinition,
  parameters: DeploymentPluginParameters,
  result: Awaited<ReturnType<DeploymentPluginRunner>>,
  runtimeAudit: ApplicationRuntimeAudit
): DeploymentPluginResult {
  if (result.provider !== definition.provider || result.environment !== parameters.environment) {
    throw new DeploymentPluginError(
      'result-mismatch',
      'Deployment engine result does not match the reviewed provider and environment; verify the provider dashboard before retrying.'
    )
  }
  const output = {
    provider: definition.provider,
    environment: parameters.environment,
    url: result.url,
    deployId: result.deployId,
    fileCount: result.fileCount,
    backendDeploymentRequired:
      runtimeAudit.backendDeploymentRequired || result.serverDeployment?.required === true
  }
  let url: URL
  try {
    url = new URL(output.url)
  } catch (cause) {
    throw new DeploymentPluginError(
      'result-mismatch',
      'Deployment engine returned an invalid URL; verify the provider dashboard before retrying.',
      cause instanceof Error ? { cause } : undefined
    )
  }
  if (url.protocol !== 'https:') {
    throw new DeploymentPluginError(
      'result-mismatch',
      'Deployment engine returned a non-HTTPS URL; verify the provider dashboard before retrying.'
    )
  }
  try {
    return Object.freeze(
      parsePluginObjectParameterValue(
        output,
        definition.result.schema,
        definition.result.maxBytes,
        `${definition.name} result`
      ) as DeploymentPluginResult
    )
  } catch (cause) {
    throw new DeploymentPluginError(
      'result-mismatch',
      'Deployment engine returned an invalid result; verify the provider dashboard before retrying.',
      cause instanceof Error ? { cause } : undefined
    )
  }
}

/**
 * Host-owned deployment wrapper. Installation/enablement remains the caller's store gate. This
 * adapter then requires a fresh confirmation for every invocation and resolves the provider token
 * only after approval. The secret never enters plugin parameters, review data, or result data.
 */
export function createDeploymentPluginHostAdapter(
  definition: DeploymentPluginDefinition,
  credentials: CredentialResolver,
  runner: DeploymentPluginRunner = runDeployCLI,
  runtimePreflight: DeploymentPluginRuntimePreflight = preflightDeployRuntime,
  backendProviderStore?: AppBackendProviderHostStore
): DeploymentPluginHostAdapter {
  return Object.freeze({
    definition,
    review(editor: EditorStore, value: unknown) {
      const path = savedDocumentPath(editor)
      const build = prepareBackendProviderBuild(editor, backendProviderStore)
      return reviewFor(
        editor,
        definition,
        parseDeploymentPluginParameters(definition, value),
        path,
        build ? backendProviderReview(build) : undefined
      )
    },
    async execute(
      editor: EditorStore,
      value: unknown,
      options: DeploymentPluginExecutionOptions = {}
    ) {
      const parameters = parseDeploymentPluginParameters(definition, value)
      if (!options.confirm) {
        throw new DeploymentPluginError(
          'confirmation-required',
          'Deployment requires explicit confirmation for this invocation.'
        )
      }
      const initial = reviewedExecution(
        editor,
        definition,
        parameters,
        options.expectedReview,
        backendProviderStore
      )
      const backendReleaseState = await reviewedBackendReleaseState(
        initial,
        parameters,
        backendProviderStore,
        options.onBackendReleaseState
      )
      if (!(await options.confirm(initial.review))) {
        if (backendReleaseState) {
          cancelAppBackendReleaseReview(backendReleaseState, options.onBackendReleaseState)
        }
        throw new DeploymentPluginError('confirmation-denied', 'Deployment was not approved.')
      }
      // Frontend-hosting confirmation cannot authorize Backend Apply. The secret-free Backend
      // proposal remains in Review until a separate Backend-specific confirmation flow exists.
      abortBeforeDispatch(options.signal)
      reviewedExecution(
        editor,
        definition,
        parameters,
        options.expectedReview,
        backendProviderStore
      )
      const runtimeAudit = await runtimePreflight({
        graph: editor.graph,
        environment: parameters.environment,
        runtimeConfig: parameters.runtimeConfig,
        backendProviderDeclared: initial.backendProviderBuild !== null
      })
      if (!runtimeAudit.ready) {
        throw new DeploymentPluginError(
          'runtime-preflight-failed',
          runtimeAudit.issues
            .filter((issue) => issue.severity === 'error')
            .map((issue) => issue.message)
            .join(' ') || 'Application runtime preflight failed.'
        )
      }
      reviewedExecution(
        editor,
        definition,
        parameters,
        options.expectedReview,
        backendProviderStore
      )
      const token = (await credentials.resolve(definition.credentialRef))?.trim()
      if (!token) {
        throw new DeploymentPluginError(
          'credential-missing',
          `${definition.ui.tokenLabel} is not configured.`
        )
      }
      const dispatch = reviewedExecution(
        editor,
        definition,
        parameters,
        options.expectedReview,
        backendProviderStore
      )
      abortBeforeDispatch(options.signal)
      const i18n: DeployI18n = {
        enabled: parameters.locales.length > 0,
        locales: [...parameters.locales]
      }
      let result: Awaited<ReturnType<DeploymentPluginRunner>>
      try {
        result = await runner(
          dispatch.path,
          token,
          definition.provider,
          parameters.environment,
          parameters.target,
          parameters.uiKit,
          i18n,
          parameters.runtimeConfig
        )
      } catch (cause) {
        throw new DeploymentPluginError(
          'outcome-unknown',
          'Frontend deployment failed after dispatch began; reconcile the provider dashboard before any retry.',
          cause instanceof Error ? { cause } : undefined
        )
      }
      return validatedResult(definition, parameters, result, runtimeAudit)
    }
  })
}

/** Production Desktop wiring: live plugin lifecycle + pure backend plan/emit before deployment. */
export function createDesktopDeploymentPluginHostAdapter(
  definition: DeploymentPluginDefinition,
  credentials: CredentialResolver,
  backendProviderStore: AppBackendProviderHostStore
): DeploymentPluginHostAdapter {
  const adapter = createDeploymentPluginHostAdapter(
    definition,
    credentials,
    runDeployCLI,
    preflightDeployRuntime,
    backendProviderStore
  )
  return Object.freeze({
    definition: adapter.definition,
    review(editor: EditorStore, value: unknown) {
      return adapter.review(editor, value)
    },
    async execute(editor: EditorStore, value: unknown, options?: DeploymentPluginExecutionOptions) {
      if (!isTauri()) {
        throw new DeploymentPluginError(
          'desktop-required',
          'Live deployment is available only in the Tauri desktop app.'
        )
      }
      return adapter.execute(editor, value, options)
    }
  })
}
