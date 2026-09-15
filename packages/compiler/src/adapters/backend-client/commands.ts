import { nestJSCommandDefinitionDigest } from '#compiler/backend/nestjs/commands/plan'
import { commerceAffectedEntities } from '#compiler/backend/nestjs/commerce/model'
import { foodOrderingAffectedEntities } from '#compiler/backend/nestjs/food-ordering/model'

import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import { COMMAND_RECOVERY_RUNTIME_SOURCE } from './command-recovery/runtime'

/** Commands own attempt keys and single-flight writes; they never enter query supersession. */
export function buildBackendCommandRuntime(application: BackendApplicationSpecV1): string {
  const commands = application.commands?.commands ?? []
  if (!commands.length) return ''
  const specs = Object.fromEntries(commands.map((command) => [command.id, command.parameters]))
  const definitions = Object.fromEntries(
    commands.map((command) => [command.id, nestJSCommandDefinitionDigest(application, command)])
  )
  const client = application.httpApi?.browserClient
  const recoveryBinding = {
    applicationId: application.applicationId,
    apiBasePath: client?.apiBasePath,
    issuer: client?.authentication.issuer,
    clientId: client?.authentication.clientId,
    resource: client?.authentication.resource ?? null
  }
  const affected = Object.fromEntries(
    commands.map((command) => {
      const entities = new Set([
        ...command.steps.flatMap((step) => (step.kind === 'data.mutate' ? [step.entityId] : [])),
        ...commerceAffectedEntities(application, command),
        ...foodOrderingAffectedEntities(application, command)
      ])
      return [
        command.id,
        application.httpApi?.resources
          .filter((resource) => entities.has(resource.entityId))
          .map((resource) => resource.id) ?? []
      ]
    })
  )
  const types = commands
    .map(
      (command, index) =>
        `${JSON.stringify(command.id)}: import('./lowcode-backend-api').Command${index}Result`
    )
    .join('; ')
  const dispatch = commands
    .map(
      (command) =>
        `case ${JSON.stringify(command.id)}: return client.commands[${JSON.stringify(command.id)}](payload as Parameters<typeof client.commands[${JSON.stringify(command.id)}]>[0], { idempotencyKey, signal })`
    )
    .join('\n')
  return `
export interface BackendCommandResults { ${types} }
export interface BackendCommandInput { commandId: keyof BackendCommandResults; payload: object; idempotencyKeyTarget: StateName; recovery?: 'browser' }
const commandParameters = ${JSON.stringify(specs)}
const commandDefinitions = ${JSON.stringify(definitions)}
const commandRecoveryBinding = ${JSON.stringify(recoveryBinding)}
const commandResources: Record<string, readonly string[]> = ${JSON.stringify(affected)}
type CommandAttempt = { payload: string; running?: Promise<BackendResult<unknown>> }
const commandAttempts = new Map<string, CommandAttempt>()
function clearBackendCommands(): void { commandAttempts.clear(); durableCommands.clear() }
export { commandError }
async function dispatchCommand(commandId: keyof BackendCommandResults, payload: object, idempotencyKey: string, signal: AbortSignal): Promise<unknown> {
  const client = createNestJSClient({ baseUrl: ${JSON.stringify(application.httpApi?.browserClient?.apiBasePath)}, getAccessToken,
    fetch })
  switch (commandId) { ${dispatch} }
  throw new BackendCommandError(400)
}
async function executeCommand(commandId: keyof BackendCommandResults, payload: object, key: string, controller: AbortController, generation: number): Promise<BackendResult<unknown>> {
  const current = () => !controller.signal.aborted && getSession().generation === generation && getSession().signedIn
  try {
    const data = await dispatchCommand(commandId, payload, key, controller.signal)
    if (!current()) return { current: false }
    for (const resource of commandResources[commandId] ?? []) publish(resource)
    return { current: true, data, cursor: '' }
  } catch (error) {
    if (!current()) return { current: false }
    throw commandError(error)
  }
}
export async function backendCommand<I extends BackendCommandInput>(input: I): Promise<BackendResult<BackendCommandResults[I['commandId']]>> {
  const session = getSession()
  if (!session.ready || !session.signedIn) throw new BackendCommandError(401)
  const parameters = commandParameters[input.commandId]
  if (!parameters) throw new BackendCommandError(400)
  const payload = normalizeCommandParameters(input.payload, parameters)
  const canonical = JSON.stringify(payload)
  if (input.recovery !== undefined && input.recovery !== 'browser') throw new BackendCommandError(400)
  if (input.recovery === 'browser') return await durableBackendCommand(input, payload, canonical, session) as BackendResult<BackendCommandResults[I['commandId']]>
  let key = readBackendState(input.idempotencyKeyTarget)
  if (key === '') {
    key = crypto.randomUUID()
    setBackendState(session.generation, input.idempotencyKeyTarget, key as StateValue, '' as StateValue)
  }
  if (!validCommandKey(key)) throw new BackendCommandError(400)
  const idempotencyKey = key
  // Register every used key target for logout cleanup, including a manually supplied key.
  setBackendState(session.generation, input.idempotencyKeyTarget, key as StateValue, '' as StateValue)
  const identity = JSON.stringify([${JSON.stringify(application.applicationId)}, session.id, input.commandId, key])
  let attempt = commandAttempts.get(identity)
  if (attempt && attempt.payload !== canonical) throw new BackendCommandError(409)
  if (attempt?.running) return await attempt.running as BackendResult<BackendCommandResults[I['commandId']]>
  if (!attempt) {
    if (commandAttempts.size >= 128) throw new BackendCommandError(503)
    attempt = { payload: canonical }; commandAttempts.set(identity, attempt)
  }
  const controller = new AbortController()
  requests.add(controller)
  const run = async (): Promise<BackendResult<unknown>> => {
    try { return await executeCommand(input.commandId, payload, idempotencyKey, controller, session.generation) }
    finally { requests.delete(controller) }
  }
  const pending = run()
  attempt.running = pending
  try { return await pending as BackendResult<BackendCommandResults[I['commandId']]> }
  finally { if (attempt.running === pending) attempt.running = undefined }
}
${COMMAND_RECOVERY_RUNTIME_SOURCE}
`
}
