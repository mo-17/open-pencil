import { expect, mock, test } from 'bun:test'
import { shallowRef } from 'vue'

import type { SceneNode } from '@open-pencil/scene-graph'

import { createTextCompositionHandlers } from '#vue/canvas/text-edit/editing'

test('uses committed input data when WKWebView clears the hidden textarea first', () => {
  const node = { id: 'text-node', type: 'TEXT' } as SceneNode
  const textareaRef = shallowRef<HTMLTextAreaElement | null>({ value: '' } as HTMLTextAreaElement)
  const insertText = mock((_text: string, _node: SceneNode) => undefined)
  const resetBlink = mock(() => undefined)
  const handlers = createTextCompositionHandlers({
    textareaRef,
    getEditingNode: () => node,
    insertText,
    replaceComposedText: () => undefined,
    restoreComposition: () => undefined,
    finishComposition: () => undefined,
    resetBlink
  })

  handlers.onInput({ data: 'Typed once' } as InputEvent)

  expect(insertText).toHaveBeenCalledTimes(1)
  expect(insertText).toHaveBeenCalledWith('Typed once', node)
  expect(resetBlink).toHaveBeenCalledTimes(1)
})
