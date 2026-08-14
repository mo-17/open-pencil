import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'
import { cliSourcePath } from '#tests/helpers/paths'

const editor = useEditorSetup()
const CLI = cliSourcePath('index.ts')
const REMOTE_MANIFEST_URL = 'https://libraries.example.com/design-system.json'
const REMOTE_ARTIFACT_V1_URL = 'https://libraries.example.com/design-system-v1.fig'
const REMOTE_ARTIFACT_V2_URL = 'https://libraries.example.com/design-system-v2.fig'

let fixtureDir = ''
let blankConsumerPath = ''
let importedPath = ''
let manifestV2Path = ''
let remoteManifestV1Path = ''
let remoteManifestV2Path = ''
let libraryV1Path = ''
let libraryV2Path = ''

test.beforeAll(async () => {
  fixtureDir = await mkdtemp(join(tmpdir(), 'open-pencil-library-panel-'))
  libraryV1Path = join(fixtureDir, 'library-published-v1.fig')
  libraryV2Path = join(fixtureDir, 'library-published-v2.fig')
  blankConsumerPath = join(fixtureDir, 'consumer.fig')
  importedPath = join(fixtureDir, 'consumer-imported.fig')
  manifestV2Path = join(fixtureDir, 'manifest-v2.json')
  remoteManifestV1Path = join(fixtureDir, 'remote-manifest-v1.json')
  remoteManifestV2Path = join(fixtureDir, 'remote-manifest-v2.json')

  runBunEval(`
    import { BUILTIN_IO_FORMATS, IORegistry } from "@open-pencil/core/io";
    import { SceneGraph } from "@open-pencil/scene-graph";

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
  runCLI([
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
  runCLI([
    'library',
    'remote',
    'prepare',
    libraryV1Path,
    '--manifest',
    join(fixtureDir, 'manifest-v1.json'),
    '--artifact-url',
    REMOTE_ARTIFACT_V1_URL,
    '-o',
    remoteManifestV1Path
  ])
  runCLI([
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
  runCLI([
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
  runCLI([
    'library',
    'remote',
    'prepare',
    libraryV2Path,
    '--manifest',
    manifestV2Path,
    '--artifact-url',
    REMOTE_ARTIFACT_V2_URL,
    '-o',
    remoteManifestV2Path
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
  await expect(panel.getByTestId('lowcode-library-status-message')).toContainText(
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

test('ACK: remote libraries stage, import, check, and explicitly accept updates', async () => {
  let serveV2 = false
  const corsHeaders = { 'access-control-allow-origin': '*' }
  await editor.page.route('**/ack/consumer-remote.fig', async (route) => {
    await route.fulfill({
      path: blankConsumerPath,
      contentType: 'application/octet-stream'
    })
  })
  await editor.page.route(REMOTE_MANIFEST_URL, async (route) => {
    await route.fulfill({
      path: serveV2 ? remoteManifestV2Path : remoteManifestV1Path,
      contentType: 'application/json',
      headers: corsHeaders
    })
  })
  await editor.page.route(REMOTE_ARTIFACT_V1_URL, async (route) => {
    await route.fulfill({
      path: libraryV1Path,
      contentType: 'application/octet-stream',
      headers: corsHeaders
    })
  })
  await editor.page.route(REMOTE_ARTIFACT_V2_URL, async (route) => {
    await route.fulfill({
      path: libraryV2Path,
      contentType: 'application/octet-stream',
      headers: corsHeaders
    })
  })

  await editor.page.evaluate(async () => {
    await window.openPencil?.openFile?.('/ack/consumer-remote.fig')
  })
  await editor.canvas.waitForRender()
  await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    store.clearSelection()
  })

  const panel = editor.page.getByTestId('lowcode-libraries-section')
  await panel.scrollIntoViewIfNeeded()
  const beforeLoad = await currentRemoteLibraryState()
  expect(beforeLoad.libraryCount).toBe(0)

  await panel.getByTestId('lowcode-library-manifest-url').fill(REMOTE_MANIFEST_URL)
  await panel.getByTestId('lowcode-library-load-remote').click()
  await expect(panel.getByTestId('lowcode-library-candidate')).toBeVisible()
  await expect(panel.getByTestId('lowcode-library-candidate-component')).toHaveCount(1)
  await expect(panel.getByTestId('lowcode-library-import')).toBeEnabled()

  const afterStage = await currentRemoteLibraryState()
  expect(afterStage).toEqual(beforeLoad)

  await panel.getByTestId('lowcode-library-import').click()
  await editor.canvas.waitForRender()
  await expect(panel.getByTestId('lowcode-library-row')).toHaveCount(1)
  await expect(panel.getByTestId('lowcode-library-status')).toHaveText('up-to-date')
  await expect.poll(currentLibraryText).toContain('Hello')

  const afterImport = await currentRemoteLibraryState()
  expect(afterImport.libraryCount).toBe(1)
  expect(afterImport.cachePageCount).toBe(1)
  expect(afterImport.source).toBe(REMOTE_ARTIFACT_V1_URL)
  expect(afterImport.manifestSource).toBe(REMOTE_MANIFEST_URL)

  serveV2 = true
  await panel.getByTestId('lowcode-library-check').click()
  await expect(panel.getByTestId('lowcode-library-status')).toHaveText('outdated')
  await expect.poll(currentLibraryText).toContain('Hello')

  await panel.getByTestId('lowcode-library-accept').click()
  await editor.canvas.waitForRender()
  await expect(panel.getByTestId('lowcode-library-status-message')).toContainText(
    'Accepted component-card.'
  )
  await expect(panel.getByTestId('lowcode-library-status')).toHaveText('up-to-date')
  await expect.poll(currentLibraryText).toContain('Updated')

  await editor.canvas.undo()
  await expect.poll(currentLibraryText).toContain('Hello')
  await expect(panel.getByTestId('lowcode-library-status')).toHaveText('outdated')

  await editor.canvas.redo()
  await expect.poll(currentLibraryText).toContain('Updated')
  await expect(panel.getByTestId('lowcode-library-status')).toHaveText('up-to-date')
  editor.canvas.assertNoErrors()
})

async function currentRemoteLibraryState(): Promise<{
  nodeCount: number
  libraryCount: number
  cachePageCount: number
  source?: string
  manifestSource?: string
}> {
  return editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const root = store.graph.getNode(store.graph.rootId)
    const library = root?.lowcodeLibraries?.[0]
    return {
      nodeCount: [...store.graph.getAllNodes()].length,
      libraryCount: root?.lowcodeLibraries?.length ?? 0,
      cachePageCount: store.graph.getPages(true).filter((page) => page.lowcodeLibraryCache === true)
        .length,
      ...(library ? { source: library.source.ref } : {}),
      ...(library?.manifestSource ? { manifestSource: library.manifestSource.ref } : {})
    }
  })
}

function runBunEval(code: string): void {
  const result = spawnSync('bun', ['--eval', code], {
    cwd: process.cwd(),
    encoding: 'utf8'
  })
  if (result.status !== 0) {
    throw new Error(`bun --eval failed:\n${result.stdout}\n${result.stderr}`)
  }
}

function runCLI(args: string[]): void {
  const result = spawnSync('bun', [CLI, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8'
  })
  if (result.status !== 0) {
    throw new Error(`open-pencil CLI failed:\n${result.stdout}\n${result.stderr}`)
  }
}
