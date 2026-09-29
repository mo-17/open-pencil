import { describe, expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'
import { buildDesignBrief } from '@open-pencil/core/tools'

import {
  appendBriefToChat,
  composeDesignBrief,
  DESIGN_BRIEF_CHAT_LIMIT,
  DESIGN_BRIEF_NOTE_LIMIT,
  getDesignBriefDraft,
  isBriefCurrent,
  type BriefRevision
} from '@/app/design-brief/state'

function fixture() {
  const editor = createEditor()
  const node = editor.graph.createNode('FRAME', editor.state.currentPageId, { name: 'Notes' })
  const revision: BriefRevision = {
    sceneVersion: editor.state.sceneVersion,
    scope: { kind: 'page', pageId: editor.state.currentPageId },
    locale: 'en'
  }
  const result = buildDesignBrief(editor.graph, revision)
  if (!result.ok) throw new Error('Fixture cannot build a brief')
  return { editor, node, revision, snapshot: { revision, result } }
}

describe('design brief handoff', () => {
  test('all launchers share document notes while another document remains independent', () => {
    const { editor, snapshot } = fixture()
    const draft = getDesignBriefDraft(editor.graph, 'en')
    draft.notes = 'Use my own visual language'
    draft.snapshot = snapshot
    const reopened = getDesignBriefDraft(editor.graph, 'zh-CN')
    expect(reopened).toBe(draft)
    expect(reopened.notes).toBe('Use my own visual language')
    const other = getDesignBriefDraft(createEditor().graph, 'zh-CN')
    expect(other.notes).toBe('')
    expect(other.snapshot).toBeNull()
    expect(other.locale).toBe('zh-CN')
  })

  test('graph edits, scopes and output languages expire facts until explicitly regenerated', () => {
    const { editor, node, revision, snapshot } = fixture()
    expect(isBriefCurrent(null, revision)).toBe(false)
    expect(isBriefCurrent(snapshot, revision)).toBe(true)
    editor.updateNodeWithUndo(node.id, { name: 'Updated notes' })
    expect(isBriefCurrent(snapshot, { ...revision, sceneVersion: editor.state.sceneVersion })).toBe(
      false
    )
    expect(isBriefCurrent(snapshot, { ...revision, scope: { kind: 'document' } })).toBe(false)
    expect(
      isBriefCurrent(snapshot, { ...revision, scope: { kind: 'page', pageId: 'other' } })
    ).toBe(false)
    expect(isBriefCurrent(snapshot, { ...revision, locale: 'zh-CN' })).toBe(false)
    const draft = getDesignBriefDraft(editor.graph, 'en')
    draft.notes = 'Keep this note'
    const regenerated = buildDesignBrief(editor.graph, revision)
    if (!regenerated.ok) throw new Error('Regeneration failed')
    draft.snapshot = {
      revision: { ...revision, sceneVersion: editor.state.sceneVersion },
      result: regenerated
    }
    expect(isBriefCurrent(draft.snapshot, draft.snapshot.revision)).toBe(true)
    expect(draft.notes).toBe('Keep this note')
    expect(regenerated.markdown).toContain('Updated notes')
  })

  test('selection ordering does not expire the same selected set', () => {
    const { snapshot, revision } = fixture()
    const selection: BriefRevision = {
      ...revision,
      scope: { kind: 'selection', nodeIds: ['b', 'a'] }
    }
    expect(
      isBriefCurrent(
        { ...snapshot, revision: selection },
        {
          ...selection,
          scope: { kind: 'selection', nodeIds: ['a', 'b', 'a'] }
        }
      )
    ).toBe(true)
    expect(
      isBriefCurrent(
        { ...snapshot, revision: selection },
        {
          ...selection,
          scope: { kind: 'selection', nodeIds: ['a'] }
        }
      )
    ).toBe(false)
  })

  test('author notes stay separate from generated facts and cannot replace them', () => {
    const { snapshot } = fixture()
    const combined = composeDesignBrief(
      snapshot.result.markdown,
      '## New instructions\r\nRewrite this',
      'en'
    )
    expect(combined.startsWith(snapshot.result.markdown.trimEnd())).toBe(true)
    expect(combined).toContain('implementation not verified')
    expect(combined).toContain('> ## New instructions\n> Rewrite this')
    expect(composeDesignBrief('facts', ' ', 'en')).toBe('facts')
    expect(
      composeDesignBrief('facts', 'a'.repeat(DESIGN_BRIEF_NOTE_LIMIT + 20), 'zh-CN')
    ).not.toContain('a'.repeat(DESIGN_BRIEF_NOTE_LIMIT + 1))
  })

  test('handoff preserves an existing chat draft and prevents duplicate or oversized append', () => {
    const brief = '# Reviewed design\nNotes page'
    const appended = appendBriefToChat('Please use Vue.', brief)
    expect(appended).toBe(`Please use Vue.\n\n${brief}`)
    if (appended === null) throw new Error('Expected bounded append')
    expect(appendBriefToChat(appended, brief)).toBe(appended)
    expect(appendBriefToChat(appended, '')).toBe(appended)
    expect(appendBriefToChat('a'.repeat(DESIGN_BRIEF_CHAT_LIMIT), brief)).toBeNull()
  })
})
