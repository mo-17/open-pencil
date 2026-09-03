import type {
  IREventHandler,
  IRInvokeServerWorkflowHandler,
  IRSupabaseAuthHandler,
  IRSupabaseMutationHandler,
  IRSupabaseQueryHandler
} from '#compiler/ir/types'

import { scriptExpression, scriptJSON, type VueEmitContext } from '../shared'
import { emitVueSupabaseFilterChain } from './supabase'

type VueBackendHandler =
  | IRSupabaseQueryHandler
  | IRSupabaseMutationHandler
  | IRSupabaseAuthHandler
  | IRInvokeServerWorkflowHandler

type EmitNestedHandlers = (
  handlers: readonly IREventHandler[],
  aliases: ReadonlyMap<string, string>
) => string[]

export function emitVueBackendHandler(
  handler: VueBackendHandler,
  context: VueEmitContext,
  aliases: ReadonlyMap<string, string>,
  emitNested: EmitNestedHandlers
): string {
  if (handler.kind === 'supabaseQuery') {
    return emitSupabaseQuery(handler, context, aliases, emitNested)
  }
  if (handler.kind === 'supabaseMutation') {
    return emitSupabaseMutation(handler, context, aliases, emitNested)
  }
  if (handler.kind === 'supabaseAuth') return emitSupabaseAuth(handler, context, aliases)
  return emitServerWorkflow(handler, context, aliases, emitNested)
}

function emitSupabaseQuery(
  handler: IRSupabaseQueryHandler,
  context: VueEmitContext,
  aliases: ReadonlyMap<string, string>,
  emitNested: EmitNestedHandlers
): string {
  const chain =
    `__opGetSupabaseClient().from(${scriptJSON(handler.table)})` +
    `.select(${scriptJSON(handler.columns)})` +
    emitVueSupabaseFilterChain(handler.filters, context, aliases) +
    (handler.single ? '.single()' : '')
  return emitSupabaseResult(
    chain,
    handler.resultTarget,
    handler.errorTarget,
    handler.onSuccess,
    handler.onError,
    aliases,
    emitNested
  )
}

function emitSupabaseMutation(
  handler: IRSupabaseMutationHandler,
  context: VueEmitContext,
  aliases: ReadonlyMap<string, string>,
  emitNested: EmitNestedHandlers
): string {
  const base = `__opGetSupabaseClient().from(${scriptJSON(handler.table)})`
  const payload = emitMutationPayload(handler, context, aliases)
  let chain: string
  if (handler.operation === 'insert') chain = `${base}.insert(${payload} as never)`
  else if (handler.operation === 'upsert') chain = `${base}.upsert(${payload} as never)`
  else if (handler.operation === 'update') {
    chain = `${base}.update(${payload} as never)${emitVueSupabaseFilterChain(
      handler.filters,
      context,
      aliases
    )}`
  } else {
    chain = `${base}.delete()${emitVueSupabaseFilterChain(handler.filters, context, aliases)}`
  }
  return emitSupabaseResult(
    chain,
    handler.resultTarget,
    handler.errorTarget,
    handler.onSuccess,
    handler.onError,
    aliases,
    emitNested
  )
}

function emitMutationPayload(
  handler: IRSupabaseMutationHandler,
  context: VueEmitContext,
  aliases: ReadonlyMap<string, string>
): string {
  if (handler.payloadEntries && handler.payloadEntries.length > 0) {
    return `{ ${handler.payloadEntries
      .map(
        (entry) =>
          `${scriptJSON(entry.key)}: ${scriptExpression(entry.ast, context.refNames, aliases)}`
      )
      .join(', ')} }`
  }
  return handler.payload ?? '{}'
}

function emitSupabaseResult(
  chain: string,
  resultTarget: string | undefined,
  errorTarget: string | undefined,
  onSuccess: IREventHandler[] | undefined,
  onError: IREventHandler[] | undefined,
  aliases: ReadonlyMap<string, string>,
  emitNested: EmitNestedHandlers
): string {
  const successAliases = new Map(aliases)
  successAliases.set('data', '__opData')
  const errorAliases = new Map(aliases)
  errorAliases.set('error', '__opError')
  errorAliases.set('err', '__opError')
  const success = emitNested(onSuccess ?? [], successAliases).join('; ')
  const failure = emitNested(onError ?? [], errorAliases).join('; ')
  const successWrites = [
    ...(resultTarget ? [`__setDocState(${scriptJSON(resultTarget)}, __opData)`] : []),
    ...(success ? [success] : [])
  ]
  const errorWrite = errorTarget ? `__setDocState(${scriptJSON(errorTarget)}, __opError); ` : ''
  const successArm = successWrites.length > 0 ? ` else { ${successWrites.join('; ')} }` : ''
  return `try { const { data: __opData, error: __opError } = await ${chain}; if (__opError) { ${errorWrite}console.error('Supabase request failed:', __opError)${failure ? `; ${failure}` : ''} }${successArm} } catch (__opThrown) { console.error('Supabase request threw:', __opThrown) }`
}

function authExpression(
  ast: IRSupabaseAuthHandler['emailAst'],
  context: VueEmitContext,
  aliases: ReadonlyMap<string, string>
): string | null {
  return ast ? scriptExpression(ast, context.refNames, aliases) : null
}

function emitSupabaseAuth(
  handler: IRSupabaseAuthHandler,
  context: VueEmitContext,
  aliases: ReadonlyMap<string, string>
): string {
  const auth = '__opGetSupabaseClient().auth'
  let call: string
  if (handler.operation === 'signOut') {
    call = `${auth}.signOut()`
  } else if (handler.operation === 'resetPassword') {
    const email = authExpression(handler.emailAst, context, aliases)
    if (!email) return `console.error('Supabase resetPassword action omitted: missing email.')`
    call = `${auth}.resetPasswordForEmail(${email}, { redirectTo: window.location.origin })`
  } else if (handler.operation === 'updatePassword') {
    const password = authExpression(handler.passwordAst, context, aliases)
    if (!password)
      return `console.error('Supabase updatePassword action omitted: missing password.')`
    call = `${auth}.updateUser({ password: ${password} })`
  } else {
    const email = authExpression(handler.emailAst, context, aliases)
    const password = authExpression(handler.passwordAst, context, aliases)
    if (!email || !password) {
      return `console.error('Supabase ${handler.operation} action omitted: missing credentials.')`
    }
    const credentials = `{ email: ${email}, password: ${password} }`
    call =
      handler.operation === 'signUp'
        ? `${auth}.signUp(${credentials})`
        : `${auth}.signInWithPassword(${credentials})`
  }
  const errorWrite = handler.errorTarget
    ? `__setDocState(${scriptJSON(handler.errorTarget)}, __opError); `
    : ''
  return `try { const { error: __opError } = await ${call}; if (__opError) { ${errorWrite}console.error(${scriptJSON(
    `${handler.operation} failed:`
  )}, __opError) } } catch (__opThrown) { console.error(${scriptJSON(
    `${handler.operation} threw:`
  )}, __opThrown) }`
}

function emitServerWorkflow(
  handler: IRInvokeServerWorkflowHandler,
  context: VueEmitContext,
  aliases: ReadonlyMap<string, string>,
  emitNested: EmitNestedHandlers
): string {
  const args = handler.args
    .map(
      (entry) =>
        `${scriptJSON(entry.key)}: ${scriptExpression(entry.ast, context.refNames, aliases)}`
    )
    .join(', ')
  const successAliases = new Map(aliases)
  if (handler.resultName) successAliases.set(handler.resultName, '__opWorkflowResult')
  const errorAliases = new Map(aliases)
  errorAliases.set('error', '__opWorkflowError')
  errorAliases.set('err', '__opWorkflowError')
  const success = emitNested(handler.onSuccess ?? [], successAliases).join('; ')
  const failure = emitNested(handler.onError ?? [], errorAliases).join('; ')
  const invocation = handler.resultName
    ? `const __opWorkflowResult = await __opInvokeServerWorkflow(${scriptJSON(
        handler.workflowId
      )}, { ${args} })`
    : `await __opInvokeServerWorkflow(${scriptJSON(handler.workflowId)}, { ${args} })`
  return `try { ${invocation}; ${success} } catch (__opWorkflowError) { console.error('Server workflow invocation failed.'); ${failure} }`
}
