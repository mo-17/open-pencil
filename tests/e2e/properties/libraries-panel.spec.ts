import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'

const editor = useEditorSetup()

let fixtureDir = ''
let importedPath = ''
let manifestV2Path = ''
let libraryV2Path = ''

test.beforeAll(async () => {
  fixtureDir = await mkdtemp(join(tmpdir(), 'open-pencil-library-panel-'))
  const libraryV1Path = join(fixtureDir, 'library-published-v1.fig')
  libraryV2Path = join(fixtureDir, 'library-published-v2.fig')
  importedPath = join(fixtureDir, 'consumer-imported.fig')
  manifestV2Path = join(fixtureDir, 'manifest-v2.json')

  runBunEval(`
    import { BUILTIN_IO_FORMATS, IORegistry } from "@open-pencil/core/io";
    import { SceneGraph } from "@open-pencil/core/scene-graph";

    const io = new IORegistry(BUILTIN_IO_FORMATS);

    async function writeGraph(path, graph) {
      const result = await io.writeDocument("fig", graph);
      await Bun.write(path, result.data);
    }

    const library = new SceneGraph();
    const page = library.getPages()[0];
    const card = library.createNode("COMPONENT", page.id, {
      name: "Card",
      width: 240,
      height: 80
    });
    library.createNode("TEXT", card.id, {
      name: "Title",
      text: "Hello",
      width: 120,
      height: 24
    });

    await writeGraph(${JSON.stringify(join(fixtureDir, 'library.fig'))}, library);
    await writeGraph(${JSON.stringify(join(fixtureDir, 'consumer.fig'))}, new SceneGraph());
  `)
  runCli([
    'library',
    'publish',
    join(fixtureDir, 'library.fig'),
    '--component',
    'Card',
    '--library-id',
    'design-system',
    '--library-name',
    'Design System',
    '--component-key',
    'component-card',
    '--source-ref',
    libraryV1Path,
    '--document-output',
    libraryV1Path,
    '--json',
    '-o',
    join(fixtureDir, 'manifest-v1.json')
  ])
  runCli([
    'library',
    'import',
    join(fixtureDir, 'consumer.fig'),
    libraryV1Path,
    '--manifest',
    join(fixtureDir, 'manifest-v1.json'),
    '--component',
    'component-card',
    '--json',
    '-o',
    importedPath
  ])
  runBunEval(`
    import { BUILTIN_IO_FORMATS, IORegistry } from "@open-pencil/core/io";

    const io = new IORegistry(BUILTIN_IO_FORMATS);

    async function readGraph(path) {
      const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
      const { graph } = await io.readDocument({ name: path, data: bytes });
      return graph;
    }

    async function writeGraph(path, graph) {
      const result = await io.writeDocument("fig", graph);
      await Bun.write(path, result.data);
    }

    const graph = await readGraph(${JSON.stringify(libraryV1Path)});
    const card = [...graph.getAllNodes()].find((node) => node.type === "COMPONENT" && node.name === "Card");
    if (!card) throw new Error("Card component not found");
    const title = card.childIds.map((id) => graph.getNode(id)).find((node) => node?.type === "TEXT");
    if (!title) throw new Error("Card title not found");
    graph.updateNode(title.id, { text: "Updated" });
    await writeGraph(${JSON.stringify(join(fixtureDir, 'library.fig'))}, graph);
  `)
  runCli([
    'library',
    'publish',
    join(fixtureDir, 'library.fig'),
    '--component',
    'Card',
    '--library-id',
    'design-system',
    '--library-name',
    'Design System',
    '--component-key',
    'component-card',
    '--source-ref',
    libraryV2Path,
    '--document-output',
    libraryV2Path,
    '--json',
    '-o',
    manifestV2Path
  ])
})

test.afterAll(async () => {
  await rm(fixtureDir, { recursive: true, force: true })
})

async function currentLibraryText(): Promise<string[]> {
  return editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    return [...store.graph.getAllNodes()]
      .filter((node) => node.type === 'TEXT')
      .map((node) => node.text ?? '')
  })
}

test('ACK: libraries panel accepts local component update with undo redo', async () => {
  await editor.page.route('**/ack/consumer-imported.fig', async (route) => {
    await route.fulfill({
      path: importedPath,
      contentType: 'application/octet-stream'
    })
  })
  await editor.page.evaluate(async () => {
    await window.openPencil?.openFile?.('/ack/consumer-imported.fig')
  })
  await editor.canvas.waitForRender()
  await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    store.clearSelection()
  })

  const panel = editor.page.getByTestId('lowcode-libraries-section')
  await panel.scrollIntoViewIfNeeded()
  await expect(panel).toBeVisible()
  await expect(panel.getByTestId('lowcode-library-row')).toHaveCount(1)
  await expect(panel.getByTestId('lowcode-library-status')).toHaveText('unknown')

  await panel.getByTestId('lowcode-library-manifest-file').setInputFiles(manifestV2Path)
  await expect(panel.getByTestId('lowcode-library-manifest-name')).toContainText('manifest-v2.json')
  await expect(panel.getByTestId('lowcode-library-status')).toHaveText('outdated')
  await expect(panel.getByTestId('lowcode-library-accept')).toBeDisabled()

  await panel.getByTestId('lowcode-library-source-file').setInputFiles(libraryV2Path)
  await expect(panel.getByTestId('lowcode-library-source-name')).toContainText(
    'library-published-v2.fig'
  )
  await expect(panel.getByTestId('lowcode-library-accept')).toBeEnabled()

  await panel.getByTestId('lowcode-library-accept').click()
  await editor.canvas.waitForRender()
  await expect(panel.getByTestId('lowcode-library-accept-message')).toContainText(
    'Accepted component-card.'
  )
  await expect(panel.getByTestId('lowcode-library-status')).toHaveText('up-to-date')
  await expect.poll(currentLibraryText).toContain('Updated')

  await editor.canvas.undo()
  await expect.poll(currentLibraryText).toContain('Hello')

  await editor.canvas.redo()
  await expect.poll(currentLibraryText).toContain('Updated')
  editor.canvas.assertNoErrors()
})

function runBunEval(code: string): void {
  const result = spawnSync('bun', ['--eval', code], {
    cwd: process.cwd(),
    encoding: 'utf8'
  })
  if (result.status !== 0) {
    throw new Error(`bun --eval failed:\n${result.stdout}\n${result.stderr}`)
  }
}

function runCli(args: string[]): void {
  const result = spawnSync('bun', ['packages/cli/src/index.ts', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8'
  })
  if (result.status !== 0) {
    throw new Error(`open-pencil CLI failed:\n${result.stdout}\n${result.stderr}`)
  }
}
