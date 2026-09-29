import * as v from 'valibot'

import type { SceneGraph } from '@open-pencil/scene-graph'

import { defineTool } from '#core/tools/schema'

import { BriefBehavior } from './behavior'
import { BriefBudget, DESIGN_BRIEF_LIMITS } from './budget'
import { renderBriefMarkdown } from './markdown'
import { briefNode, briefVariables } from './node'
import { briefRoots, collectBriefNodes } from './scope'
import type { DesignBrief, DesignBriefOptions, DesignBriefResult, DesignBriefScope } from './types'

export type {
  DesignBrief,
  DesignBriefOptions,
  DesignBriefResult,
  DesignBriefScope,
  DesignBriefLocale
} from './types'
export { DESIGN_BRIEF_LIMITS } from './budget'

/** Deterministic, bounded, read-only handoff of explicitly configured canvas facts. */
export function buildDesignBrief(
  graph: SceneGraph,
  options: DesignBriefOptions
): DesignBriefResult {
  const budget = new BriefBudget()
  const roots = briefRoots(graph, options.scope, budget)
  if ('error' in roots) return { ok: false, error: roots.error }
  const entries = collectBriefNodes(graph, roots.roots, budget)
  const behavior = new BriefBehavior(graph, new Set(entries.map(({ node }) => node.id)), budget)
  const nodes = entries.map((entry) => briefNode(graph, entry, behavior, budget))
  const variables = briefVariables(graph, entries, budget)
  // Scope identities are detached from caller-owned arrays and receive the same text budget.
  let scope: DesignBriefScope = { kind: 'document' }
  if (options.scope.kind === 'selection')
    scope = { kind: 'selection', nodeIds: roots.roots.map((node) => budget.text(node.id)) }
  if (options.scope.kind === 'page')
    scope = { kind: 'page', pageId: budget.text(options.scope.pageId) }
  const brief: DesignBrief = {
    version: 1,
    locale: options.locale ?? 'en',
    scope,
    nodes,
    variables,
    backend: behavior.backend(),
    warnings: [...budget.warnings].map((code) => ({ code })),
    truncated: [...budget.warnings].some((code) => code.endsWith('-truncated'))
  }
  const markdown = renderBriefMarkdown(brief)
  return { ok: true, brief, markdown }
}

export const getDesignBrief = defineTool({
  name: 'get_design_brief',
  description:
    'Read a bounded design handoff: actual layout, copy, bindings, events, variable references and referenced backend operations. No mutation, credentials, runtime state or AI inference. Choose nodeIds or pageId; omit both for the current page. Set scope=document explicitly for the document.',
  execution: { kind: 'sync', mutation: 'none' },
  capabilities: ['document:read'],
  exposure: { webmcp: false },
  input: v.object({
    scope: v.optional(v.picklist(['page', 'selection', 'document'])),
    nodeIds: v.optional(
      v.pipe(
        v.array(v.pipe(v.string(), v.minLength(1), v.maxLength(512))),
        v.minLength(1),
        v.maxLength(DESIGN_BRIEF_LIMITS.roots)
      )
    ),
    pageId: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(512))),
    locale: v.optional(v.picklist(['en', 'zh-CN']))
  }),
  execute: (figma, args) => {
    if (
      (args.nodeIds && args.pageId) ||
      (args.scope === 'document' && (args.nodeIds || args.pageId)) ||
      (args.scope === 'page' && args.nodeIds) ||
      (args.scope === 'selection' && !args.nodeIds)
    ) {
      return {
        ok: false,
        error: {
          code: 'invalid-scope',
          message: 'Choose exactly one scope: nodeIds, pageId or document.'
        }
      }
    }
    let scope: DesignBriefScope = { kind: 'page', pageId: args.pageId ?? figma.currentPage.id }
    if (args.scope === 'document') scope = { kind: 'document' }
    if (args.nodeIds) scope = { kind: 'selection', nodeIds: args.nodeIds }
    return buildDesignBrief(figma.graph, { scope, locale: args.locale })
  }
})
