import { describe, expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseMarketplaceListingMetadata } from '@open-pencil/marketplace'
import {
  parseVersionedPluginManifestPayload,
  signVersionedPluginManifest,
  verifyVersionedPluginPackage,
  type PluginManifestPayloadV2
} from '@open-pencil/plugin-contracts'
import { SceneGraph } from '@open-pencil/scene-graph'

import {
  createBundledPluginCatalog,
  inspectPluginCommandCompatibility,
  inspectPluginHostContributionsCompatibility,
  runInstalledPluginCommand,
  type InstalledAppPlugin
} from '@/app/plugins'
import { inspectPluginCommandMCPExposure } from '@/app/plugins/host'
import {
  EXAMPLE_DOCUMENT_SUMMARY_HOST_CONTRACT,
  runExampleDocumentSummary,
  type ExampleDocumentSummaryEditor
} from '@/app/plugins/host/example/document-summary'
import {
  EXAMPLE_NODE_TYPE_COUNTER_HOST_CONTRACT,
  runExampleNodeTypeCounter
} from '@/app/plugins/host/example/node-type-counter'
import {
  EXAMPLE_STYLE_USAGE_HOST_CONTRACT,
  runExampleStyleUsage
} from '@/app/plugins/host/example/style-usage'
import {
  EXAMPLE_VARIABLE_OVERVIEW_HOST_CONTRACT,
  runExampleVariableOverview
} from '@/app/plugins/host/example/variable-overview'

interface ExampleHostContract {
  readonly pluginId: string
  readonly commandId: string
  readonly adapterId: string
  readonly permissions: readonly string[]
  readonly parameters: Readonly<{ maxBytes: number }>
  readonly result: Readonly<{ maxBytes: number }>
}

const EXAMPLES = Object.freeze([
  {
    directory: 'document-summary',
    displayName: 'Document Summary',
    contract: EXAMPLE_DOCUMENT_SUMMARY_HOST_CONTRACT
  },
  {
    directory: 'node-type-counter',
    displayName: 'Node Type Counter',
    contract: EXAMPLE_NODE_TYPE_COUNTER_HOST_CONTRACT
  },
  {
    directory: 'style-usage',
    displayName: 'Style Usage',
    contract: EXAMPLE_STYLE_USAGE_HOST_CONTRACT
  },
  {
    directory: 'variable-overview',
    displayName: 'Variable Overview',
    contract: EXAMPLE_VARIABLE_OVERVIEW_HOST_CONTRACT
  }
] satisfies readonly Readonly<{
  directory: string
  displayName: string
  contract: ExampleHostContract
}>[])

function exampleRoot(directory: string): URL {
  return new URL(`../../../../examples/third-party-plugin/${directory}/`, import.meta.url)
}

async function exampleManifest(directory: string): Promise<PluginManifestPayloadV2> {
  const manifest = parseVersionedPluginManifestPayload(
    await Bun.file(new URL('manifest.payload.json', exampleRoot(directory))).json()
  )
  if (manifest.schemaVersion !== 2) throw new Error('Expected a schema-v2 example manifest')
  return manifest
}

async function installedPlugin(manifest: PluginManifestPayloadV2): Promise<InstalledAppPlugin> {
  const keyPair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
  const signed = await signVersionedPluginManifest(manifest, keyPair.privateKey)
  const verifiedPackage = await verifyVersionedPluginPackage(signed, keyPair.publicKey, {
    engineVersion: '0.15.0',
    expectedKeyId: manifest.publisher.keyId
  })
  return {
    package: {
      trustSource: 'publisher-signature',
      manifest: verifiedPackage.manifest,
      digest: verifiedPackage.verifiedDigest,
      verifiedPackage
    },
    enabled: true,
    pinnedDigest: null
  }
}

function exampleEditor() {
  const graph = new SceneGraph()
  return {
    graph,
    state: { selectedIds: new Set<string>() }
  } satisfies ExampleDocumentSummaryEditor
}

async function exampleContribution(directory: string) {
  const manifest = await exampleManifest(directory)
  const contribution = manifest.contributions.commands?.[0]
  if (!contribution) throw new Error(`Missing ${directory} example command`)
  return { manifest, contribution }
}

describe('third-party Manifest v2 examples', () => {
  test('publisher key helper rejects repository and symlinked repository paths', async () => {
    const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url))
    const scriptPath = fileURLToPath(
      new URL(
        '../../../../examples/third-party-plugin/scripts/generate-keypair.mjs',
        import.meta.url
      )
    )
    const safetySuffix = `${process.pid}`
    const repositoryOutput = path.join(
      repositoryRoot,
      `examples/third-party-plugin/document-summary/dist/.key-safety-direct-${safetySuffix}`
    )
    const symlinkedRepositoryOutput = path.join(
      repositoryRoot,
      `examples/third-party-plugin/document-summary/dist/.key-safety-symlink-${safetySuffix}`
    )
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'openpencil-plugin-key-test-'))
    try {
      const rejected = Bun.spawnSync([
        process.execPath,
        scriptPath,
        '--output-dir',
        repositoryOutput
      ])
      expect(rejected.exitCode).not.toBe(0)
      expect(rejected.stderr.toString()).toContain('outside the OpenPencil repository')

      const existingOutput = path.join(temporaryRoot, 'existing-shared-directory')
      await mkdir(existingOutput, { mode: 0o755 })
      if (process.platform !== 'win32') await chmod(existingOutput, 0o755)
      const existing = Bun.spawnSync([process.execPath, scriptPath, '--output-dir', existingOutput])
      expect(existing.exitCode).not.toBe(0)
      expect(existing.stderr.toString()).toContain('must not already exist')
      if (process.platform !== 'win32') {
        expect((await stat(existingOutput)).mode & 0o777).toBe(0o755)
      }

      if (process.platform !== 'win32') {
        const repositoryLink = path.join(temporaryRoot, 'repository-link')
        await symlink(repositoryRoot, repositoryLink, 'dir')
        const symlinked = Bun.spawnSync([
          process.execPath,
          scriptPath,
          '--output-dir',
          path.join(
            repositoryLink,
            `examples/third-party-plugin/document-summary/dist/.key-safety-symlink-${safetySuffix}`
          )
        ])
        expect(symlinked.exitCode).not.toBe(0)
        expect(symlinked.stderr.toString()).toContain('outside the OpenPencil repository')
      }

      const externalOutput = path.join(temporaryRoot, 'publisher-keys')
      const accepted = Bun.spawnSync([process.execPath, scriptPath, '--output-dir', externalOutput])
      expect(accepted.exitCode).toBe(0)
      expect(await readFile(path.join(externalOutput, 'publisher-public.pem'), 'utf8')).toContain(
        'BEGIN PUBLIC KEY'
      )
      if (process.platform !== 'win32') {
        expect((await stat(path.join(externalOutput, 'publisher-private.pem'))).mode & 0o777).toBe(
          0o600
        )
      }
    } finally {
      await Promise.all([
        rm(repositoryOutput, { recursive: true, force: true }),
        rm(symlinkedRepositoryOutput, { recursive: true, force: true }),
        rm(temporaryRoot, { recursive: true, force: true })
      ])
    }
  })

  for (const example of EXAMPLES) {
    test(`${example.displayName} ships valid Marketplace inputs and remains unbundled`, async () => {
      const manifest = await exampleManifest(example.directory)
      const listing = parseMarketplaceListingMetadata(
        await Bun.file(new URL('listing.json', exampleRoot(example.directory))).json()
      )

      expect(manifest.plugin.id).toBe(example.contract.pluginId)
      expect(manifest.capabilities).toEqual([])
      expect(manifest.contributions.modules).toEqual([])
      expect(listing.displayName).toBe(example.displayName)
      expect(listing.iconUrl).toBeNull()
      expect(listing.homepageUrl).toBeNull()
      expect(
        createBundledPluginCatalog().some(
          (entry) => entry.manifest.plugin.id === example.contract.pluginId
        )
      ).toBe(false)
    })

    test(`${example.displayName} binds activation to the exact reviewed host contract`, async () => {
      const { manifest, contribution } = await exampleContribution(example.directory)

      expect(inspectPluginCommandCompatibility(example.contract.pluginId, contribution)).toEqual({
        ok: true,
        status: 'compatible'
      })
      expect(inspectPluginCommandMCPExposure(example.contract.pluginId, contribution)).toEqual({
        ok: true,
        status: 'compatible'
      })
      expect(
        inspectPluginHostContributionsCompatibility(manifest.plugin.id, manifest.contributions)
      ).toEqual([])
      expect(inspectPluginCommandCompatibility('attacker.other', contribution)).toMatchObject({
        ok: false,
        status: 'plugin-identity-mismatch'
      })
      expect(
        inspectPluginCommandCompatibility(manifest.plugin.id, {
          ...contribution,
          permissions: []
        })
      ).toMatchObject({ ok: false, status: 'permissions-mismatch' })
      expect(
        inspectPluginCommandCompatibility(manifest.plugin.id, {
          ...contribution,
          parameters: {
            ...contribution.parameters,
            maxBytes: contribution.parameters.maxBytes + 1
          }
        })
      ).toMatchObject({ ok: false, status: 'parameters-mismatch' })
      expect(
        inspectPluginCommandMCPExposure(manifest.plugin.id, {
          ...contribution,
          result: { ...contribution.result, maxBytes: contribution.result.maxBytes + 1 }
        })
      ).toMatchObject({ ok: false, status: 'result-contract-mismatch' })
    })
  }

  test('Document Summary returns visible aggregate counts only', async () => {
    const { manifest, contribution } = await exampleContribution('document-summary')
    const editor = exampleEditor()
    const page = editor.graph.getPages()[0]
    const frame = editor.graph.createNode('FRAME', page.id, { name: 'Summary target' })
    editor.graph.createNode('RECTANGLE', frame.id, { name: 'Child' })
    editor.state.selectedIds.add(frame.id)
    const cachePage = editor.graph.addPage('OpenPencil Library Cache')
    editor.graph.updateNode(cachePage.id, { internalOnly: true, lowcodeLibraryCache: true })
    const hiddenNode = editor.graph.createNode('FRAME', cachePage.id, { name: 'Hidden master' })
    editor.state.selectedIds.add(hiddenNode.id)
    const plugin = await installedPlugin(manifest)

    expect(plugin.package).toMatchObject({ trustSource: 'publisher-signature' })
    expect(runExampleDocumentSummary(editor)).toEqual({
      status: 'completed',
      message: 'Document summary: 1 page(s), 2 node(s), 1 selected.',
      data: { pageCount: 1, nodeCount: 2, selectedNodeCount: 1 }
    })
    await expect(runInstalledPluginCommand(editor, plugin, contribution)).resolves.toEqual(
      runExampleDocumentSummary(editor)
    )
    await expect(
      runInstalledPluginCommand(editor, plugin, contribution, undefined, { includeNames: true })
    ).rejects.toThrow('not supported by the parameter schema')
  })

  test('Node Type Counter validates its enum and excludes internal subtrees', async () => {
    const { manifest, contribution } = await exampleContribution('node-type-counter')
    const editor = exampleEditor()
    const page = editor.graph.getPages()[0]
    const frame = editor.graph.createNode('FRAME', page.id, { name: 'Visible frame' })
    editor.graph.createNode('RECTANGLE', frame.id, { name: 'Visible rectangle' })
    editor.graph.createNode('TEXT', frame.id, { name: 'Visible text' })
    const cachePage = editor.graph.addPage('OpenPencil Library Cache')
    editor.graph.updateNode(cachePage.id, { internalOnly: true })
    editor.graph.createNode('RECTANGLE', cachePage.id, { name: 'Hidden rectangle' })
    const plugin = await installedPlugin(manifest)

    expect(runExampleNodeTypeCounter(editor)).toMatchObject({
      data: { nodeType: 'ALL', matchingNodeCount: 3 }
    })
    await expect(
      runInstalledPluginCommand(editor, plugin, contribution, undefined, {
        nodeType: 'RECTANGLE'
      })
    ).resolves.toEqual({
      status: 'completed',
      message: 'Node type count for RECTANGLE: 1.',
      data: { nodeType: 'RECTANGLE', matchingNodeCount: 1 }
    })
    await expect(
      runInstalledPluginCommand(editor, plugin, contribution, undefined, { nodeType: 'GROUP' })
    ).rejects.toThrow('not one of the allowed enum values')
    await expect(
      runInstalledPluginCommand(editor, plugin, contribution, undefined, {
        nodeType: 'FRAME',
        includeNames: true
      })
    ).rejects.toThrow('not supported by the parameter schema')
  })

  test('Style Usage counts enabled public paints and effects without returning content', async () => {
    const { manifest, contribution } = await exampleContribution('style-usage')
    const editor = exampleEditor()
    const page = editor.graph.getPages()[0]
    const visibleFill = {
      type: 'SOLID' as const,
      color: { r: 1, g: 0, b: 0, a: 1 },
      opacity: 1,
      visible: true
    }
    const visibleStroke = {
      color: { r: 0, g: 0, b: 0, a: 1 },
      weight: 1,
      opacity: 1,
      visible: true,
      align: 'INSIDE' as const
    }
    const visibleEffect = {
      type: 'DROP_SHADOW' as const,
      color: { r: 0, g: 0, b: 0, a: 0.25 },
      offset: { x: 0, y: 2 },
      radius: 4,
      spread: 0,
      visible: true
    }
    const frame = editor.graph.createNode('FRAME', page.id, {
      fills: [visibleFill],
      strokes: [visibleStroke],
      effects: [visibleEffect]
    })
    editor.graph.createNode('RECTANGLE', frame.id, {
      fills: [visibleFill, { ...visibleFill, visible: false }],
      strokes: [{ ...visibleStroke, visible: false }],
      effects: [{ ...visibleEffect, visible: false }]
    })
    const cachePage = editor.graph.addPage('OpenPencil Library Cache')
    editor.graph.updateNode(cachePage.id, { internalOnly: true })
    editor.graph.createNode('RECTANGLE', cachePage.id, {
      fills: [visibleFill],
      strokes: [visibleStroke],
      effects: [visibleEffect]
    })
    const plugin = await installedPlugin(manifest)
    const expected = {
      status: 'completed' as const,
      message: 'Style usage: 2 fill(s), 1 stroke(s), and 1 effect(s) across 2 node(s).',
      data: {
        nodeCount: 2,
        visibleFillCount: 2,
        visibleStrokeCount: 1,
        visibleEffectCount: 1
      }
    }

    expect(runExampleStyleUsage(editor)).toEqual(expected)
    await expect(runInstalledPluginCommand(editor, plugin, contribution)).resolves.toEqual(expected)
  })

  test('Variable Overview returns aggregate metadata without names or values', async () => {
    const { manifest, contribution } = await exampleContribution('variable-overview')
    const editor = exampleEditor()
    const theme = editor.graph.createCollection('Confidential theme name')
    editor.graph.addMode(theme.id, 'dark-mode', 'Confidential dark mode name')
    const content = editor.graph.createCollection('Confidential content name')
    editor.graph.createVariable('Private color name', 'COLOR', theme.id)
    const hidden = editor.graph.createVariable('Private copy name', 'STRING', content.id)
    hidden.hiddenFromPublishing = true
    const plugin = await installedPlugin(manifest)
    const expected = {
      status: 'completed' as const,
      message: 'Variable overview: 2 collection(s), 2 variable(s), and 3 mode(s).',
      data: {
        collectionCount: 2,
        variableCount: 2,
        modeCount: 3,
        publishableVariableCount: 1
      }
    }

    expect(runExampleVariableOverview(editor)).toEqual(expected)
    expect(JSON.stringify(expected)).not.toContain('Confidential')
    expect(JSON.stringify(expected)).not.toContain('Private')
    await expect(runInstalledPluginCommand(editor, plugin, contribution)).resolves.toEqual(expected)
  })
})
