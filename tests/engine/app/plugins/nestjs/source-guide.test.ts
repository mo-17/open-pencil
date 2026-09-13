import { describe, expect, test } from 'bun:test'

import { buildSourceProjectExportFiles } from '@/app/plugins/host/source-exporter-runtime'

describe('Backend browser source archive startup guide', () => {
  test('links the generated guide after final source packaging and preserves existing README text', () => {
    for (const readme of [undefined, '# Existing instructions\n']) {
      const files = new Map<string, string>([['BACKEND-CLIENT.md', '# Run the application\n']])
      if (readme) files.set('README.md', readme)
      const output = buildSourceProjectExportFiles(files, [], 'React')
      expect(output.get('README.md')).toContain('./BACKEND-CLIENT.md')
      if (readme) expect(output.get('README.md')).toContain(readme)
      expect(files.get('README.md')).toBe(readme)
    }
  })
  test('leaves ordinary source archives unchanged', () => {
    const files = new Map([['README.md', '# Existing instructions\n']])
    expect(buildSourceProjectExportFiles(files, [], 'Vue')).toEqual(files)
  })
  test('puts complete application startup before frontend-only instructions', () => {
    const input = new Map([
      ['README.md', '# Frontend\nRun npm run dev.\n'],
      ['BACKEND-CLIENT.md', '# Login\n'],
      ['backend/nestjs/LOCAL-RUN.md', '# Local startup\n']
    ])
    const readme = buildSourceProjectExportFiles(input, [], 'Vue').get('README.md')
    expect(typeof readme).toBe('string')
    expect(readme).toContain('./backend/nestjs/LOCAL-RUN.md')
    expect(String(readme).indexOf('./backend/nestjs/LOCAL-RUN.md')).toBeLessThan(
      String(readme).indexOf('npm run dev')
    )
    expect(input.get('README.md')).toBe('# Frontend\nRun npm run dev.\n')
  })
})
