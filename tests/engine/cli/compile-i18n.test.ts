import { expect, setDefaultTimeout, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { BUILTIN_IO_FORMATS, IORegistry } from '@open-pencil/core/io'
import { SceneGraph } from '@open-pencil/scene-graph'

import { cliSourcePath } from '#tests/helpers/paths'
import { heavy } from '#tests/helpers/test-utils'

setDefaultTimeout(30_000)

const CLI = cliSourcePath('index.ts')

/**
 * Phase 3 §9 v13 — the `compile` / `build` CLI commands expose `--i18n`,
 * `--locale`, `--source-locale` so the entire §9 i18n chain (react-intl runtime,
 * locale catalogs, LocaleSwitcher, RTL, coverage report) is reachable from the
 * CLI. Without these flags the i18n work had no entry point (the editor preview
 * compiles with i18n off and no flag was exposed anywhere).
 */
async function writeDoc(figPath: string): Promise<void> {
  const graph = new SceneGraph()
  const pageId = graph.getPages()[0].id
  const frame = graph.createNode('FRAME', pageId, {
    width: 320,
    height: 120,
    layoutMode: 'VERTICAL'
  })
  graph.createNode('TEXT', frame.id, { text: 'Hello', width: 200, height: 24 })
  graph.updateNode(graph.rootId, { lowcodeTranslations: { ar: { Hello: 'مرحبا' } } })
  const io = new IORegistry(BUILTIN_IO_FORMATS)
  const result = await io.writeDocument('fig', graph)
  await Bun.write(figPath, result.data as Uint8Array)
}

async function compile(figPath: string, outDir: string, flags: string[]): Promise<number> {
  const proc = Bun.spawn(['bun', CLI, 'compile', figPath, ...flags, '-o', outDir], {
    stdout: 'pipe',
    stderr: 'pipe'
  })
  return proc.exited
}

heavy('compile CLI — i18n flags (§9 v13)', () => {
  test('--i18n --locale ar emits the react-intl runtime + prefilled catalog + RTL', async () => {
    const dir = join(tmpdir(), `op-i18n-${randomUUID()}`)
    const fig = join(dir, 'doc.fig')
    const out = join(dir, 'out')
    try {
      await writeDoc(fig)
      expect(await compile(fig, out, ['--i18n', '--locale', 'ar'])).toBe(0)

      const app = await Bun.file(join(out, 'src/App.tsx')).text()
      expect(app).toContain('FormattedMessage')
      // the authored Arabic translation is prefilled into the target catalog
      const ar = await Bun.file(join(out, 'src/locales/ar.json')).text()
      expect(ar).toContain('مرحبا')
      // an RTL target wires document direction in the runtime (§9 v11)
      const runtime = await Bun.file(join(out, 'src/_lowcode_i18n.tsx')).text()
      expect(runtime).toContain('document.documentElement.dir')
      // the coverage report (§9 v10) is emitted for the target locale
      expect(await Bun.file(join(out, 'src/locales/_coverage.json')).exists()).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('--source-locale ar sets <html lang/dir> (§9 v12) and the source catalog', async () => {
    const dir = join(tmpdir(), `op-i18n-${randomUUID()}`)
    const fig = join(dir, 'doc.fig')
    const out = join(dir, 'out')
    try {
      await writeDoc(fig)
      expect(await compile(fig, out, ['--source-locale', 'ar'])).toBe(0)
      const html = await Bun.file(join(out, 'index.html')).text()
      expect(html).toContain('<html lang="ar" dir="rtl">')
      expect(await Bun.file(join(out, 'src/locales/ar.json')).exists()).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('no i18n flag → no react-intl runtime (byte-identical default)', async () => {
    const dir = join(tmpdir(), `op-i18n-${randomUUID()}`)
    const fig = join(dir, 'doc.fig')
    const out = join(dir, 'out')
    try {
      await writeDoc(fig)
      expect(await compile(fig, out, [])).toBe(0)
      const app = await Bun.file(join(out, 'src/App.tsx')).text()
      expect(app).not.toContain('FormattedMessage')
      expect(await Bun.file(join(out, 'src/_lowcode_i18n.tsx')).exists()).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
