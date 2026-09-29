import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { autocompleteRuntimeSource } from '@open-pencil/compiler/adapters/autocomplete/runtime'

import { autocompleteRuntimeFixture } from '#tests/helpers/compiler/components/autocomplete/runtime'
import { renderAutocompleteSSR } from '#tests/helpers/compiler/components/autocomplete/ssr'
import { typeCheckCompilerFiles } from '#tests/helpers/compiler/typecheck'

interface AutocompleteRuntime {
  autocompleteMatches(suggestions: readonly string[], value: string): string[]
}
async function loadRuntime(): Promise<AutocompleteRuntime> {
  const directory = mkdtempSync(join(tmpdir(), 'openpencil-autocomplete-engine-'))
  try {
    const path = join(directory, 'runtime.ts')
    writeFileSync(path, autocompleteRuntimeSource())
    return (await import(path)) as AutocompleteRuntime
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}
const runtime = await loadRuntime()

describe('generated autocomplete input runtime', () => {
  test('filters bounded local suggestions without requiring a matching free value', () => {
    expect(
      runtime.autocompleteMatches(['北京 Beijing', '北海 Beihai', '厦门 Xiamen'], 'BEI')
    ).toEqual(['北京 Beijing', '北海 Beihai'])
    expect(runtime.autocompleteMatches(['北京 Beijing', '北海 Beihai'], '北')).toHaveLength(2)
    expect(runtime.autocompleteMatches(['北京 Beijing'], '完全自由输入')).toEqual([])
    expect(runtime.autocompleteMatches(['same', 'same', 'x'.repeat(201), 'valid'], '')).toEqual([
      'same',
      'valid'
    ])
    expect(
      runtime.autocompleteMatches(
        Array.from({ length: 120 }, (_, index) => String(index)),
        ''
      )
    ).toHaveLength(100)
  })
  test.each(['react', 'vue'] as const)(
    '%s generated input supports typed value/defaultValue, readonly, events and form reset',
    (target) => {
      const output = autocompleteRuntimeFixture(target)
      expect(output.warnings).toEqual([])
      typeCheckCompilerFiles(
        new Map(
          output.files.filter((entry): entry is [string, string] => typeof entry[1] === 'string')
        ),
        target
      )
    },
    35000
  )
  test.each(['react', 'vue'] as const)(
    '%s renders a single native input without any browser globals or popup',
    async (target) => {
      const html = await renderAutocompleteSSR(target)
      expect(html.match(/<input\b/g)).toHaveLength(1)
      expect(html).toContain('name="city"')
      expect(html).toContain('自由 &lt;b&gt;文本&lt;/b&gt;')
      expect(html).toContain('role="combobox"')
      expect(html).not.toContain('listbox" id=')
      expect(html).not.toContain('<option')
    }
  )
})
