import { expect, setDefaultTimeout, test } from 'bun:test'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, rm, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { BUILTIN_IO_FORMATS, IORegistry } from '@open-pencil/core/io'
import { REMOTE_PEN_PARSE_LIMITS } from '@open-pencil/pen'
import { REMOTE_COMPONENT_LIBRARY_DESCRIPTOR_LIMITS, SceneGraph } from '@open-pencil/scene-graph'
import type { LibraryManifest, SceneNode } from '@open-pencil/scene-graph'

import { cliSourcePath } from '#tests/helpers/paths'
import { heavy } from '#tests/helpers/test-utils'

setDefaultTimeout(30_000)

const CLI = cliSourcePath('index.ts')
const io = new IORegistry(BUILTIN_IO_FORMATS)
const UNSAFE_IMAGE_HASH = 'ab'.repeat(20)

async function run(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(['bun', CLI, ...args], {
    stdout: 'pipe',
    stderr: 'pipe'
  })
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text()
  ])
  const exitCode = await proc.exited
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode }
}

async function writeGraph(path: string, graph: SceneGraph): Promise<void> {
  const result = await io.writeDocument('fig', graph)
  await Bun.write(path, result.data as Uint8Array)
}

async function readGraph(path: string): Promise<SceneGraph> {
  const bytes = new Uint8Array(await Bun.file(path).arrayBuffer())
  const { graph } = await io.readDocument({ name: path, data: bytes })
  return graph
}

function createLibraryGraph(): { graph: SceneGraph; componentId: string; titleId: string } {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const component = graph.createNode('COMPONENT', page.id, { name: 'Card', width: 240, height: 80 })
  const title = graph.createNode('TEXT', component.id, {
    name: 'Title',
    text: 'Hello',
    width: 120,
    height: 24
  })
  return { graph, componentId: component.id, titleId: title.id }
}

function findCardComponent(graph: SceneGraph): SceneNode {
  const component = [...graph.getAllNodes()].find(
    (node) => node.type === 'COMPONENT' && node.name === 'Card'
  )
  if (!component) throw new Error('Card component not found')
  return component
}

function updateCardTitle(graph: SceneGraph, text: string): void {
  const component = findCardComponent(graph)
  const title = component.childIds
    .map((id) => graph.getNode(id))
    .find((node) => node?.type === 'TEXT')
  if (!title) throw new Error('Card title not found')
  graph.updateNode(title.id, { text })
}

async function readManifest(path: string): Promise<LibraryManifest> {
  return JSON.parse(await Bun.file(path).text()) as LibraryManifest
}

heavy('library CLI (§14)', () => {
  test('publish, import, check, and accept a library component update', async () => {
    const dir = join(tmpdir(), `op-library-${randomUUID()}`)
    const lib = join(dir, 'library.fig')
    const libPublished1 = join(dir, 'library-published-v1.fig')
    const libPublished2 = join(dir, 'library-published-v2.fig')
    const consumer = join(dir, 'consumer.fig')
    const imported = join(dir, 'consumer-imported.fig')
    const accepted = join(dir, 'consumer-accepted.fig')
    const manifest1Path = join(dir, 'manifest-v1.json')
    const manifest2Path = join(dir, 'manifest-v2.json')

    try {
      const library = createLibraryGraph()
      await writeGraph(lib, library.graph)
      await writeGraph(consumer, new SceneGraph())

      const publish1 = await run([
        'library',
        'publish',
        lib,
        '--component',
        'Card',
        '--library-id',
        'design-system',
        '--library-name',
        'Design System',
        '--component-key',
        'component-card',
        '--source-ref',
        libPublished1,
        '--document-output',
        libPublished1,
        '--json',
        '-o',
        manifest1Path
      ])
      expect(publish1.exitCode).toBe(0)
      const published1 = JSON.parse(publish1.stdout) as { manifest: LibraryManifest }
      expect(published1.manifest.components[0]?.key).toBe('component-card')
      expect(await Bun.file(manifest1Path).exists()).toBe(true)

      const remoteManifestPath = join(dir, 'remote-manifest-v1.json')
      const remotePrepare = await run([
        'library',
        'remote',
        'prepare',
        libPublished1,
        '--manifest',
        manifest1Path,
        '--artifact-url',
        'https://libraries.example.com/design-system-v1.fig',
        '--json',
        '-o',
        remoteManifestPath
      ])
      expect(remotePrepare.exitCode).toBe(0)
      const prepared = JSON.parse(remotePrepare.stdout) as {
        manifest: {
          format: string
          schemaVersion: number
          source: { kind: string; ref: string }
          artifact: {
            format: string
            mediaType: string
            byteLength: number
            integrity: { algorithm: string; digest: string }
          }
        }
      }
      const publishedBytes = new Uint8Array(await Bun.file(libPublished1).arrayBuffer())
      expect(prepared.manifest).toMatchObject({
        format: 'openpencil.component-library',
        schemaVersion: 1,
        source: {
          kind: 'url',
          ref: 'https://libraries.example.com/design-system-v1.fig'
        },
        artifact: {
          format: 'fig',
          mediaType: 'application/octet-stream',
          byteLength: publishedBytes.byteLength,
          integrity: {
            algorithm: 'SHA-256',
            digest: createHash('sha256').update(publishedBytes).digest('base64url')
          }
        }
      })
      expect(await Bun.file(remoteManifestPath).exists()).toBe(true)

      const importResult = await run([
        'library',
        'import',
        consumer,
        libPublished1,
        '--manifest',
        manifest1Path,
        '--component',
        'component-card',
        '--json',
        '-o',
        imported
      ])
      expect(importResult.exitCode).toBe(0)

      const libraryV2 = await readGraph(libPublished1)
      updateCardTitle(libraryV2, 'Updated')
      await writeGraph(lib, libraryV2)
      const publish2 = await run([
        'library',
        'publish',
        lib,
        '--component',
        'Card',
        '--library-id',
        'design-system',
        '--library-name',
        'Design System',
        '--component-key',
        'component-card',
        '--source-ref',
        libPublished2,
        '--document-output',
        libPublished2,
        '--json',
        '-o',
        manifest2Path
      ])
      expect(publish2.exitCode).toBe(0)
      const manifest1 = await readManifest(manifest1Path)
      const manifest2 = await readManifest(manifest2Path)
      expect(manifest2.components[0]?.version).not.toBe(manifest1.components[0]?.version)

      const check = await run(['library', 'check', imported, '--manifest', manifest2Path, '--json'])
      expect(check.exitCode).toBe(0)
      const checks = JSON.parse(check.stdout) as {
        checks: Array<{ status: string; componentKey: string }>
      }
      expect(checks.checks).toMatchObject([{ componentKey: 'component-card', status: 'outdated' }])

      const accept = await run([
        'library',
        'accept',
        imported,
        libPublished2,
        '--manifest',
        manifest2Path,
        '--component',
        'component-card',
        '--json',
        '-o',
        accepted
      ])
      expect(accept.exitCode).toBe(0)

      const acceptedGraph = await readGraph(accepted)
      const root = acceptedGraph.getNode(acceptedGraph.rootId)
      expect(root?.lowcodeLibraries?.[0]?.importedComponents).toEqual([
        { key: 'component-card', version: manifest2.components[0]?.version }
      ])
      const cached = [...acceptedGraph.getAllNodes()].find(
        (node) => node.libraryComponentKey === 'component-card'
      )
      expect(cached?.libraryVersion).toBe(manifest2.components[0]?.version)
      const title = cached?.childIds
        .map((id) => acceptedGraph.getNode(id))
        .find((node) => node?.type === 'TEXT')
      expect(title?.text).toBe('Updated')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('rejects unsafe remote artifact URLs before writing a manifest', async () => {
    const dir = join(tmpdir(), `op-library-remote-invalid-${randomUUID()}`)
    const artifact = join(dir, 'library.fig')
    const manifestPath = join(dir, 'manifest.json')
    const output = join(dir, 'remote.json')
    try {
      const library = createLibraryGraph()
      await writeGraph(artifact, library.graph)
      const publish = await run([
        'library',
        'publish',
        artifact,
        '--component',
        'Card',
        '--library-id',
        'design-system',
        '--component-key',
        'component-card',
        '--document-output',
        artifact,
        '-o',
        manifestPath
      ])
      expect(publish.exitCode).toBe(0)

      for (const artifactURL of [
        'https://127.0.0.1/library.fig',
        'https://libraries.example.com/library.fig?',
        'https://libraries.example.com/library.fig#'
      ]) {
        const result = await run([
          'library',
          'remote',
          'prepare',
          artifact,
          '--manifest',
          manifestPath,
          '--artifact-url',
          artifactURL,
          '-o',
          output
        ])
        expect(result.exitCode).toBe(1)
        expect(result.stderr).toContain('canonical public HTTPS')
        expect(await Bun.file(output).exists()).toBe(false)
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('rejects remote descriptors the app consumer cannot parse', async () => {
    const dir = join(tmpdir(), `op-library-remote-descriptor-${randomUUID()}`)
    const artifact = join(dir, 'library.fig')
    const manifestPath = join(dir, 'manifest.json')
    const output = join(dir, 'remote.json')
    try {
      const library = createLibraryGraph()
      await writeGraph(artifact, library.graph)
      const publish = await run([
        'library',
        'publish',
        artifact,
        '--component',
        'Card',
        '--library-id',
        'design-system',
        '--component-key',
        'component-card',
        '--document-output',
        artifact,
        '-o',
        manifestPath
      ])
      expect(publish.exitCode).toBe(0)
      const manifest = JSON.parse(await Bun.file(manifestPath).text()) as LibraryManifest
      const invalidDescriptors = [
        { ...manifest, components: [] },
        {
          ...manifest,
          components: Array.from(
            { length: REMOTE_COMPONENT_LIBRARY_DESCRIPTOR_LIMITS.maxComponents + 1 },
            (_, index) => ({
              ...manifest.components[0],
              key: `component-${index}`,
              nodeId: `node-${index}`
            })
          )
        },
        { ...manifest, libraryId: 'bad\nidentifier' },
        {
          ...manifest,
          components: [{ ...manifest.components[0], unexpectedBehavior: true }]
        },
        {
          ...manifest,
          components: [
            manifest.components[0],
            { ...manifest.components[0], key: 'component-alias' }
          ]
        }
      ]

      for (const invalid of invalidDescriptors) {
        await Bun.write(manifestPath, JSON.stringify(invalid))
        const result = await run([
          'library',
          'remote',
          'prepare',
          artifact,
          '--manifest',
          manifestPath,
          '--artifact-url',
          'https://libraries.example.com/library.fig',
          '-o',
          output
        ])
        expect(result.exitCode).toBe(1)
        expect(await Bun.file(output).exists()).toBe(false)
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('rejects the same unsafe referenced image as the remote app consumer', async () => {
    const dir = join(tmpdir(), `op-library-remote-image-${randomUUID()}`)
    const artifact = join(dir, 'library.fig')
    const manifestPath = join(dir, 'manifest.json')
    const output = join(dir, 'remote.json')
    try {
      const library = createLibraryGraph()
      library.graph.updateNode(library.componentId, {
        fills: [
          {
            type: 'IMAGE',
            color: { r: 0, g: 0, b: 0, a: 1 },
            opacity: 1,
            visible: true,
            imageHash: UNSAFE_IMAGE_HASH,
            imageScaleMode: 'FILL'
          }
        ]
      })
      library.graph.images.set(UNSAFE_IMAGE_HASH, new Uint8Array([1, 2, 3]))
      await writeGraph(artifact, library.graph)
      const publish = await run([
        'library',
        'publish',
        artifact,
        '--component',
        'Card',
        '--library-id',
        'design-system',
        '--component-key',
        'component-card',
        '--document-output',
        artifact,
        '-o',
        manifestPath
      ])
      expect(publish.exitCode).toBe(0)

      const result = await run([
        'library',
        'remote',
        'prepare',
        artifact,
        '--manifest',
        manifestPath,
        '--artifact-url',
        'https://libraries.example.com/library.fig',
        '-o',
        output
      ])
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toMatch(
        new RegExp(`image "${UNSAFE_IMAGE_HASH}".*complete PNG, JPEG, or WebP`)
      )
      expect(await Bun.file(output).exists()).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('rejects a .pen artifact above the same limit enforced by the remote reader', async () => {
    const dir = join(tmpdir(), `op-library-remote-pen-limit-${randomUUID()}`)
    const artifact = join(dir, 'library.pen')
    const manifestPath = join(dir, 'manifest.json')
    const output = join(dir, 'remote.json')
    try {
      await mkdir(dir, { recursive: true })
      await writeFile(manifestPath, '{}')
      await writeFile(artifact, '')
      await truncate(artifact, REMOTE_PEN_PARSE_LIMITS.maxBytes + 1)

      const result = await run([
        'library',
        'remote',
        'prepare',
        artifact,
        '--manifest',
        manifestPath,
        '--artifact-url',
        'https://libraries.example.com/library.PEN',
        '-o',
        output
      ])
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain(String(REMOTE_PEN_PARSE_LIMITS.maxBytes))
      expect(await Bun.file(output).exists()).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('rejects the same structurally oversized .pen artifact as the remote reader', async () => {
    const dir = join(tmpdir(), `op-library-remote-pen-structure-${randomUUID()}`)
    const artifact = join(dir, 'library.pen')
    const manifestPath = join(dir, 'manifest.json')
    const output = join(dir, 'remote.json')
    try {
      await mkdir(dir, { recursive: true })
      const bytes = new TextEncoder().encode(
        JSON.stringify({
          version: '2.14',
          children: Array.from(
            { length: REMOTE_PEN_PARSE_LIMITS.maxChildrenPerNode + 1 },
            (_, index) => ({ id: `node-${index}`, type: 'frame' })
          )
        })
      )
      await expect(
        io.readDocumentAs(
          'pen',
          { name: artifact, mimeType: 'application/json', data: bytes },
          {
            populate: 'all',
            penLimits: REMOTE_PEN_PARSE_LIMITS,
            allowMainThreadFallback: true
          }
        )
      ).rejects.toThrow('document children limit')
      await writeFile(artifact, bytes)
      await writeFile(manifestPath, '{}')

      const result = await run([
        'library',
        'remote',
        'prepare',
        artifact,
        '--manifest',
        manifestPath,
        '--artifact-url',
        'https://libraries.example.com/library.pen',
        '-o',
        output
      ])
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('document children limit')
      expect(await Bun.file(output).exists()).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
