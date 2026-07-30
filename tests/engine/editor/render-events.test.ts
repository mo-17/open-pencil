import { expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'

test('overlay-only repaint emits without invalidating the scene render version', () => {
  const editor = createEditor({ skipInitialGraphSetup: true })
  const initialRenderVersion = editor.state.renderVersion
  const initialSceneVersion = editor.state.sceneVersion
  let received: { renderVersion: number; sceneVersion: number } | null = null
  editor.onEditorEvent('overlay:requested', (versions) => {
    received = versions
  })

  editor.requestOverlayRepaint()

  expect(editor.state.renderVersion).toBe(initialRenderVersion)
  expect(editor.state.sceneVersion).toBe(initialSceneVersion)
  expect(received).toEqual({
    renderVersion: initialRenderVersion,
    sceneVersion: initialSceneVersion
  })
})
