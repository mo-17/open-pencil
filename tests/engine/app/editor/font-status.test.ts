import { describe, expect, test } from 'bun:test'

import type { FontResolutionDemand } from '@open-pencil/core/text'
import { SceneGraph } from '@open-pencil/scene-graph'

import {
  retryDocumentFontIssue,
  retryDocumentFontIssues,
  type DocumentFontRetryActions,
  type DocumentFontRetryBatchActions
} from '@/app/editor/fonts/status'

describe('document font retry', () => {
  test('clears every remote face failure and retries with affected text coverage', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const node = graph.createNode('TEXT', page.id, {
      text: 'Abba 你',
      textCase: 'UPPER',
      fontFamily: 'Missing Sans',
      fontWeight: 700
    })
    const calls: string[] = []
    const resets: FontResolutionDemand[] = []
    const actions: DocumentFontRetryActions = {
      clearFontLoadFailure(family, style, characters) {
        calls.push(`clear:${family}:${style}:${characters}`)
      },
      resetDemand(demand) {
        resets.push(demand)
        calls.push(`reset:${demand.key}`)
      },
      async load(family, style, characters) {
        calls.push(`load:${family}:${style}:${characters}`)
        return null
      }
    }

    await retryDocumentFontIssue(
      graph,
      { family: 'Missing Sans', style: 'Bold', nodeIds: [node.id] },
      actions
    )

    expect(calls).toEqual([
      'clear:Missing Sans:Bold:AB 你',
      'clear:Missing Sans:Regular:',
      'reset:face:missing sans:bold',
      'load:Missing Sans:Bold:AB 你'
    ])
    expect(resets[0]?.characters).toBe('AB 你')
  })

  test('renews the bounded browser fetch session once before retrying all affected faces', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const first = graph.createNode('TEXT', page.id, {
      text: 'Headline',
      width: 400,
      fontFamily: 'First Sans',
      fontWeight: 700
    })
    const second = graph.createNode('TEXT', page.id, {
      text: 'Body',
      width: 400,
      fontFamily: 'Second Sans',
      fontWeight: 400
    })
    const calls: string[] = []
    const actions: DocumentFontRetryBatchActions = {
      resetWebFontFetchSession() {
        calls.push('reset-session')
      },
      clearFontLoadFailure(family, style, characters) {
        calls.push(`clear:${family}:${style}:${characters}`)
      },
      resetDemand(demand) {
        calls.push(`reset-demand:${demand.key}`)
      },
      async load(family, style, characters) {
        calls.push(`load:${family}:${style}:${characters}`)
        return null
      }
    }

    await retryDocumentFontIssues(
      graph,
      [
        { family: 'First Sans', style: 'Bold', nodeIds: [first.id] },
        { family: 'Second Sans', style: 'Regular', nodeIds: [second.id] }
      ],
      actions
    )

    expect(calls[0]).toBe('reset-session')
    expect(calls.filter((call) => call === 'reset-session')).toHaveLength(1)
    expect(calls).toContain('load:First Sans:Bold:Headlin')
    expect(calls).toContain('load:Second Sans:Regular:Body')
  })

  test('does not renew the browser fetch session when no issues remain', async () => {
    let resets = 0
    const actions: DocumentFontRetryBatchActions = {
      resetWebFontFetchSession() {
        resets++
      },
      clearFontLoadFailure() {
        throw new Error('No face should be cleared without an issue')
      },
      resetDemand() {
        throw new Error('No demand should be reset without an issue')
      },
      async load() {
        throw new Error('No face should be loaded without an issue')
      }
    }

    await retryDocumentFontIssues(new SceneGraph(), [], actions)

    expect(resets).toBe(0)
  })
})
