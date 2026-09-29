import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { UPLOAD_LOCAL_FILES_RUNTIME } from '#compiler/adapters/upload-button/local-files'

import { localUploadFixture } from '#tests/helpers/compiler/components/upload/fixtures'

interface LocalFile {
  id: number
  file: File
}
interface SelectionRules {
  accept: string[]
  multiple: boolean
  maxFiles: number
  maxFileBytes: number
}
interface SelectionRuntime {
  selectLocalFiles: (
    current: readonly LocalFile[],
    files: ArrayLike<File>,
    config: SelectionRules,
    createId: () => number
  ) => { selected: LocalFile[]; error: string }
}
const emitted = new Bun.Transpiler({ loader: 'ts' }).transformSync(UPLOAD_LOCAL_FILES_RUNTIME)
const runtime = new Function(emitted + '\nreturn { selectLocalFiles }')() as SelectionRuntime
const rules: SelectionRules = { accept: ['.txt'], multiple: true, maxFiles: 3, maxFileBytes: 8 }
const localFile = (name: string, lastModified = 1000, type = 'text/plain', content = '123') =>
  new File([content], name, { lastModified, type })

test('local upload preserves single selection on cancel, invalid type, and oversized replacement', () => {
  const selected = [{ id: 1, file: localFile('keep.txt') }]
  const single = { ...rules, multiple: false, maxFiles: 1 }
  for (const files of [
    [],
    [localFile('wrong.png')],
    [localFile('large.txt', 1000, 'text/plain', '123456789')]
  ]) {
    const result = runtime.selectLocalFiles(selected, files, single, () => 2)
    expect(result.selected).toEqual(selected)
    expect(result.selected[0].file).toBe(selected[0].file)
  }
  const next = localFile('next.txt')
  expect(runtime.selectLocalFiles(selected, [next], single, () => 2).selected).toEqual([
    { id: 2, file: next }
  ])
})

test('local upload ignores repeated metadata before counting remaining capacity', () => {
  const selected = [{ id: 1, file: localFile('one.txt') }]
  let id = 2
  const result = runtime.selectLocalFiles(
    selected,
    [localFile('one.txt'), localFile('two.txt'), localFile('two.txt'), localFile('three.txt')],
    rules,
    () => id++
  )
  expect(result.selected.map((entry) => entry.file.name)).toEqual([
    'one.txt',
    'two.txt',
    'three.txt'
  ])
  expect(result.selected.map((entry) => entry.id)).toEqual([1, 2, 3])
  expect(result.error).toContain('already selected')
  expect(result.error).not.toContain('up to')
})

test('same names with different size, type, or modification time remain distinct local files', () => {
  const selected = [{ id: 1, file: localFile('same.txt') }]
  let id = 2
  const files = [
    localFile('same.txt', 1001),
    localFile('same.txt', 1000, 'application/octet-stream'),
    localFile('same.txt', 1000, 'text/plain', '1234')
  ]
  const result = runtime.selectLocalFiles(selected, files, { ...rules, maxFiles: 4 }, () => id++)
  expect(result.selected).toHaveLength(4)
  expect(result.error).toBe('')
})

test('local upload preserves accepted entries and bounds rejection details and incoming work', () => {
  const selected = [{ id: 1, file: localFile('keep.txt') }]
  const rejected = Array.from({ length: 150 }, (_, index) => localFile(`wrong-${index}.png`))
  const result = runtime.selectLocalFiles(selected, rejected, rules, () => 2)
  expect(result.selected).toEqual(selected)
  expect(result.error).toContain('96 more files were rejected')
  expect(result.error).toContain('50 additional files were not checked')
  expect(result.error.length).toBeLessThan(1000)
})

test.each([
  ['react', 'multiple'],
  ['vue', 'multiple'],
  ['react', 'disabled'],
  ['vue', 'disabled'],
  ['react', 'non-boolean-disabled'],
  ['vue', 'non-boolean-disabled'],
  ['react', 'document-disabled'],
  ['vue', 'document-disabled'],
  ['react', 'static-disabled'],
  ['vue', 'static-disabled']
] as const)(
  '%s local upload %s generated project passes its real type checker',
  (target, scenario) => {
    const output = localUploadFixture(target, scenario)
    expect(output.warnings).toEqual([])
    const directory = mkdtempSync(join(tmpdir(), 'openpencil-upload-types-'))
    try {
      symlinkSync(
        resolve(target === 'react' ? 'packages/compiler/node_modules' : 'node_modules'),
        join(directory, 'node_modules'),
        'dir'
      )
      for (const [path, content] of output.files) {
        const destination = join(directory, path)
        mkdirSync(dirname(destination), { recursive: true })
        writeFileSync(destination, content)
      }
      const tool =
        target === 'vue'
          ? join(
              dirname(fileURLToPath(import.meta.resolve('vue-tsc/package.json'))),
              'bin/vue-tsc.js'
            )
          : join(dirname(fileURLToPath(import.meta.resolve('typescript/package.json'))), 'bin/tsc')
      expect(() =>
        execFileSync('node', [tool, '--noEmit', '-p', join(directory, 'tsconfig.json')], {
          cwd: directory,
          timeout: 30000,
          stdio: 'inherit'
        })
      ).not.toThrow()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  },
  35000
)
