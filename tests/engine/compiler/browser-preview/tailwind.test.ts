import { expect, test } from 'bun:test'

import { BrowserPreviewAssetRegistry } from '#compiler/browser-preview/assets'
import { BROWSER_PREVIEW_LIMITS } from '#compiler/browser-preview/limits'
import { buildBrowserPreviewCSS } from '#compiler/browser-preview/tailwind'

import { browserPreviewInput } from './helpers'

async function inspectCandidates(source: string, css = '.fixture { display: block }') {
  const files = new Map([
    ['src/App.tsx', source],
    ['outside.tsx', '"outside-candidate"']
  ])
  const input = await browserPreviewInput(files)
  let candidates: readonly string[] = []
  let preparedCSS = ''
  input.tailwindCompile = async (prepared) => {
    preparedCSS = prepared
    return {
      build(values) {
        candidates = values
        return prepared
      }
    }
  }
  const result = await buildBrowserPreviewCSS(
    input,
    [{ path: 'src/index.css', content: css }],
    files,
    new BrowserPreviewAssetRegistry(files)
  )
  return { ...result, candidates, preparedCSS }
}

test('browser Tailwind scanner retains bounded static strings and dynamic diagnostics', async () => {
  const result = await inspectCandidates(
    [
      '// "comment-only"',
      '/* "block-only" */',
      'const base = "h-4 w-4 [&>span]:line-clamp-1"',
      'const variant = `px-3 ${variant} py-2`',
      `const long = "${'a'.repeat(BROWSER_PREVIEW_LIMITS.maxTailwindCandidateBytes + 1)}"`
    ].join('\n')
  )
  expect(result.candidates).toEqual(['h-4', 'px-3', 'py-2', 'w-4'])
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
    'browser-preview-dynamic-tailwind-candidates-omitted'
  ])
})

test('browser Tailwind source directives remain bounded after sharing its string scanner', async () => {
  const result = await inspectCandidates(
    '"w-4"',
    '/* @source "ignored"; */\n@source inline("w-4");\n.fixture::after { content: "@source"; }'
  )
  expect(result.preparedCSS).not.toContain('inline(')
  expect(result.preparedCSS).toContain('content: "@source"')
  for (const directive of ['@source "../**";', '@source inline("{hover:,}w-4");']) {
    await expect(inspectCandidates('"w-4"', directive)).rejects.toMatchObject({
      diagnostics: [expect.objectContaining({ code: 'browser-preview-tailwind-directive-unsafe' })]
    })
  }
})

test('browser Tailwind candidate count retains its fail-closed limit', async () => {
  const source = JSON.stringify(
    Array.from(
      { length: BROWSER_PREVIEW_LIMITS.maxTailwindCandidates + 1 },
      (_, index) => `w-[${index}px]`
    ).join(' ')
  )
  await expect(inspectCandidates(source)).rejects.toMatchObject({
    diagnostics: [expect.objectContaining({ code: 'browser-preview-tailwind-candidate-limit' })]
  })
})
