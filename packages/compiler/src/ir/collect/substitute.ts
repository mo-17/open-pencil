import { type ExprAst, collectReferences, substituteIdents } from '@open-pencil/lowcode'

import type {
  IRStripeCheckoutHandler,
  IRStripeCustomerPortalHandler,
  IRTrackEventHandler,
  IREventHandler
} from '../types'

/** Phase 3 §10 v6: recompute the `references` list of a handler whose AST(s)
 *  have just been substituted. Unions the identifier references across every
 *  passed AST (skipping `undefined` for optional asts). */
function refsOf(...asts: (ExprAst | undefined)[]): string[] {
  const acc = new Set<string>()
  for (const ast of asts) {
    if (ast !== undefined) collectReferences(ast, acc)
  }
  return [...acc]
}

/**
 * Phase 3 §10 v6: rewrite every formal-parameter identifier in a handler's
 * expression AST(s) to the bound argument AST (caller scope), returning a new
 * handler. Recurses into `condition` / `confirm` branch chains so workflow
 * parameters reach nested handlers. After substitution each handler's
 * `references` is recomputed from the rewritten AST(s).
 *
 * Total function over `IREventHandler` (经验 A): the exhaustive switch + `never`
 * default means adding a handler kind without a case here is a tsgo error, not a
 * silent skip. `delay` / `stop` carry no expression AST and are returned
 * unchanged; `navigate` substitutes its route-param value ASTs (Phase 4 §16.2);
 * `apiCall.body` / `supabaseMutation.payload` are pre-serialised JSON literals
 * (not ASTs) and so do not support parameter interpolation (documented
 * limitation — use `payloadEntries` instead).
 */
export function substituteHandler(
  handler: IREventHandler,
  bindings: ReadonlyMap<string, ExprAst>
): IREventHandler {
  if (isSimpleAstHandler(handler)) return substituteSimpleAstHandler(handler, bindings)
  if (handler.kind === 'trackEvent') return substituteTrackEventHandler(handler, bindings)
  if (handler.kind === 'stripeCheckout' || handler.kind === 'stripeCustomerPortal') {
    return substituteStripeRedirectHandler(handler, bindings)
  }
  if (isImmutableHandler(handler)) return handler
  switch (handler.kind) {
    case 'navigate':
      // Phase 4 §16.2: `to` is a literal path; only the param value exprs are
      // substituted (a workflow param can feed a navigate's route param).
      return handler.params
        ? { ...handler, params: handler.params.map((p) => substituteFilter(p, bindings)) }
        : handler
    case 'apiCall':
      return {
        ...handler,
        url: substituteIdents(handler.url, bindings),
        ...substituteResultBranches(handler, bindings)
      }
    case 'invokeServerWorkflow':
      return {
        ...handler,
        args: handler.args.map((entry) => substituteFilter(entry, bindings)),
        ...substituteResultBranches(handler, bindings)
      }
    case 'supabaseQuery':
      return {
        ...handler,
        filters: handler.filters.map((f) => substituteFilter(f, bindings)),
        ...substituteResultBranches(handler, bindings)
      }
    case 'supabaseMutation':
      return {
        ...handler,
        payloadEntries: handler.payloadEntries?.map((e) => {
          const ast = substituteIdents(e.ast, bindings)
          return { ...e, ast, references: refsOf(ast) }
        }),
        filters: handler.filters.map((f) => substituteFilter(f, bindings)),
        ...substituteResultBranches(handler, bindings)
      }
    case 'supabaseAuth': {
      const emailAst =
        handler.emailAst === undefined ? undefined : substituteIdents(handler.emailAst, bindings)
      const passwordAst =
        handler.passwordAst === undefined
          ? undefined
          : substituteIdents(handler.passwordAst, bindings)
      return { ...handler, emailAst, passwordAst, references: refsOf(emailAst, passwordAst) }
    }
    case 'condition': {
      const condAst = substituteIdents(handler.condAst, bindings)
      return {
        ...handler,
        condAst,
        references: refsOf(condAst),
        consequent: handler.consequent.map((h) => substituteHandler(h, bindings)),
        alternate: handler.alternate?.map((h) => substituteHandler(h, bindings))
      }
    }
    case 'confirm': {
      const ast = substituteIdents(handler.ast, bindings)
      return {
        ...handler,
        ast,
        references: refsOf(ast),
        consequent: handler.consequent.map((h) => substituteHandler(h, bindings)),
        alternate: handler.alternate?.map((h) => substituteHandler(h, bindings))
      }
    }
    default: {
      const _exhaustive: never = handler
      return _exhaustive
    }
  }
}

function substituteResultBranches(
  handler: { onSuccess?: IREventHandler[]; onError?: IREventHandler[] },
  bindings: ReadonlyMap<string, ExprAst>
): Pick<typeof handler, 'onSuccess' | 'onError'> {
  return {
    ...(handler.onSuccess
      ? { onSuccess: handler.onSuccess.map((item) => substituteHandler(item, bindings)) }
      : {}),
    ...(handler.onError
      ? { onError: handler.onError.map((item) => substituteHandler(item, bindings)) }
      : {})
  }
}

type ImmutableHandler = Extract<
  IREventHandler,
  {
    kind: 'delay' | 'stop' | 'playMotion' | 'stopMotion' | 'toggleMotion' | 'awaitMotion'
  }
>

function isImmutableHandler(handler: IREventHandler): handler is ImmutableHandler {
  return (
    handler.kind === 'delay' ||
    handler.kind === 'stop' ||
    handler.kind === 'playMotion' ||
    handler.kind === 'stopMotion' ||
    handler.kind === 'toggleMotion' ||
    handler.kind === 'awaitMotion'
  )
}

type SimpleAstHandler = Extract<
  IREventHandler,
  { kind: 'setState' | 'setVariable' | 'toast' | 'clipboard' }
>

function isSimpleAstHandler(handler: IREventHandler): handler is SimpleAstHandler {
  return (
    handler.kind === 'setState' ||
    handler.kind === 'setVariable' ||
    handler.kind === 'toast' ||
    handler.kind === 'clipboard'
  )
}

function substituteSimpleAstHandler(
  handler: SimpleAstHandler,
  bindings: ReadonlyMap<string, ExprAst>
): SimpleAstHandler {
  const ast = substituteIdents(handler.ast, bindings)
  return { ...handler, ast, references: refsOf(ast) }
}

function substituteTrackEventHandler(
  handler: IRTrackEventHandler,
  bindings: ReadonlyMap<string, ExprAst>
): IRTrackEventHandler {
  const eventAst = substituteIdents(handler.eventAst, bindings)
  return {
    ...handler,
    eventAst,
    references: refsOf(eventAst),
    properties: handler.properties?.map((prop) => {
      const ast = substituteIdents(prop.ast, bindings)
      return { ...prop, ast, references: refsOf(ast) }
    })
  }
}

function substituteStripeRedirectHandler(
  handler: IRStripeCheckoutHandler | IRStripeCustomerPortalHandler,
  bindings: ReadonlyMap<string, ExprAst>
): IRStripeCheckoutHandler | IRStripeCustomerPortalHandler {
  const endpoint = substituteIdents(handler.endpoint, bindings)
  return {
    ...handler,
    endpoint,
    payloadEntries: handler.payloadEntries?.map((entry) => {
      const ast = substituteIdents(entry.ast, bindings)
      return { ...entry, ast, references: refsOf(ast) }
    })
  }
}

function substituteFilter<T extends { ast: ExprAst; references: string[] }>(
  filter: T,
  bindings: ReadonlyMap<string, ExprAst>
): T {
  const ast = substituteIdents(filter.ast, bindings)
  return { ...filter, ast, references: refsOf(ast) }
}
