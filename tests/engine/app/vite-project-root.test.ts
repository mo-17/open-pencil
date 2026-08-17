import { describe, expect, test } from 'bun:test'

import { openPencilProjectRootDefineValue } from '#vite/project-root'

describe('Vite project root define', () => {
  const projectRoot = '/build-machine/workspaces/open-pencil'

  test('does not expose the build path to ordinary Web builds', () => {
    expect(openPencilProjectRootDefineValue(projectRoot, undefined)).toBe('""')
    expect(openPencilProjectRootDefineValue(projectRoot, '')).toBe('""')
  })

  test('preserves the project root for Tauri CLI builds', () => {
    expect(openPencilProjectRootDefineValue(projectRoot, 'darwin')).toBe(
      JSON.stringify(projectRoot)
    )
  })
})
