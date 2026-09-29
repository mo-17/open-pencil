import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { emitFormSubmitHandler } from '#compiler/adapters/react/emit/event'
import { collectTree } from '#compiler/ir/collect/tree'
import type { IRElement } from '#compiler/ir/types'

import { moduleFormFixture } from '#tests/helpers/compiler/components/form-module/fixtures'

test.each(['react', 'vue'] as const)(
  '%s marks only fields owned by a projected module form',
  (target) => {
    const fixture = moduleFormFixture(target)
    const ir = collectTree(fixture.graph, fixture.pageId)
    const form = ir.children.find(
      (node) => node.kind === 'element' && node.sourceId === fixture.outer.id
    ) as IRElement
    const normal = ir.children.find(
      (node) => node.kind === 'element' && node.sourceId === fixture.normal.id
    ) as IRElement
    expect(form.formValidationMountedOnly).toBe(true)
    expect(normal.formValidationMountedOnly).toBeUndefined()
    const keys = form.formValidationKeys ?? []
    expect(keys.length).toBe(3)
    const fields = ir.validatedFields ?? []
    expect(
      fields
        .filter((field) => keys.includes(field.key))
        .map((field) => field.stateName)
        .sort()
    ).toEqual(['first', 'portal', 'second'])
    expect(normal.formValidationKeys).toHaveLength(1)
    expect(fixture.warnings.map((warning) => warning.code)).toEqual([
      'module-content-child-unassigned'
    ])
  }
)

test('ordinary React form submission keeps unfiltered keys and captures its focus scope', () => {
  expect(emitFormSubmitHandler([], ['field:value'])).toBe(
    'async (e) => { e.preventDefault(); const __opSubmitForm = e.currentTarget; if (!(await __validateFields(["field:value"], __opSubmitForm))) return; }'
  )
})

test.each(['react', 'vue', 'react-shadcn'] as const)(
  '%s generated module form validation project type checks',
  (scenario) => {
    const target = scenario === 'vue' ? 'vue' : 'react'
    const output = moduleFormFixture(target, false, scenario === 'react-shadcn')
    const directory = mkdtempSync(join(tmpdir(), 'openpencil-module-form-types-'))
    try {
      const dependencies =
        target === 'vue'
          ? ['vue', 'vue-router', 'vite']
          : [
              'react',
              'react-dom',
              '@types/react',
              '@types/react-dom',
              'zustand',
              'vite',
              ...(scenario === 'react-shadcn'
                ? [
                    '@radix-ui/react-slot',
                    '@radix-ui/react-select',
                    '@radix-ui/react-checkbox',
                    '@radix-ui/react-radio-group',
                    'class-variance-authority',
                    'clsx',
                    'tailwind-merge'
                  ]
                : [])
            ]
      for (const dependency of dependencies) {
        const installed = ['packages/compiler', '.']
          .map((workspace) => resolve(workspace, 'node_modules', dependency))
          .find(existsSync)
        if (!installed) throw new Error('Missing workspace test dependency: ' + dependency)
        const destination = join(directory, 'node_modules', dependency)
        mkdirSync(dirname(destination), { recursive: true })
        symlinkSync(installed, destination, 'dir')
      }
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
