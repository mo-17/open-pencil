import { shallowReactive } from 'vue'

import type { buildDesignBrief } from '@open-pencil/core/tools'
import type { SceneGraph } from '@open-pencil/scene-graph'

type BriefOptions = Parameters<typeof buildDesignBrief>[1]
export type BriefScope = BriefOptions['scope']
export type BriefLocale = NonNullable<BriefOptions['locale']>
export type BriefScopeKind = BriefScope['kind']
type BriefSuccess = Extract<ReturnType<typeof buildDesignBrief>, { ok: true }>

export const DESIGN_BRIEF_NOTE_LIMIT = 4_000
export const DESIGN_BRIEF_CHAT_LIMIT = 160_000

export interface BriefRevision {
  sceneVersion: number
  scope: BriefScope
  locale: BriefLocale
}

export interface BriefSnapshot {
  revision: BriefRevision
  result: BriefSuccess
}

export interface DesignBriefDraft {
  scopeKind: BriefScopeKind
  locale: BriefLocale
  notes: string
  snapshot: BriefSnapshot | null
}

// Drafts belong to a live document graph, including when several launchers are mounted.
// Replacing a graph never transfers an old document's notes to the new document.
const drafts = new WeakMap<SceneGraph, DesignBriefDraft>()

export function getDesignBriefDraft(graph: SceneGraph, locale: BriefLocale): DesignBriefDraft {
  const existing = drafts.get(graph)
  if (existing) return existing
  const draft = shallowReactive<DesignBriefDraft>({
    scopeKind: 'page',
    locale,
    notes: '',
    snapshot: null
  })
  drafts.set(graph, draft)
  return draft
}

function scopeKey(scope: BriefScope): string {
  if (scope.kind === 'document') return 'document'
  if (scope.kind === 'page') return JSON.stringify(['page', scope.pageId])
  return JSON.stringify(['selection', [...new Set(scope.nodeIds)].sort()])
}

export function isBriefCurrent(snapshot: BriefSnapshot | null, revision: BriefRevision): boolean {
  return (
    snapshot !== null &&
    snapshot.revision.sceneVersion === revision.sceneVersion &&
    snapshot.revision.locale === revision.locale &&
    scopeKey(snapshot.revision.scope) === scopeKey(revision.scope)
  )
}

export function composeDesignBrief(markdown: string, notes: string, locale: BriefLocale): string {
  const boundedNotes = notes.slice(0, DESIGN_BRIEF_NOTE_LIMIT).trim()
  if (!boundedNotes) return markdown
  const heading =
    locale === 'zh-CN'
      ? '作者补充（需求意图，尚未验证实现）'
      : 'Author additions (requested intent, implementation not verified)'
  // Quoting separates authored content from the generated facts and instructions.
  const quotedNotes = boundedNotes
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => `> ${line}`)
  return `${markdown.trimEnd()}\n\n## ${heading}\n\n${quotedNotes.join('\n')}\n`
}

export function appendBriefToChat(draft: string, brief: string): string | null {
  if (!brief.trim()) return draft
  if (draft.includes(brief)) return draft
  const text = draft.trim() ? `${draft.trimEnd()}\n\n${brief}` : brief
  return text.length <= DESIGN_BRIEF_CHAT_LIMIT ? text : null
}
