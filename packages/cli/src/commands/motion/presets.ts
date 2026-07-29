import { readFile, stat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { defineCommand } from 'citty'

import {
  SHARED_MOTION_PRESET_LIMITS,
  SHARED_MOTION_PRESET_MANIFEST_FORMAT,
  SHARED_MOTION_PRESET_MANIFEST_SCHEMA_VERSION,
  acceptSharedMotionPresetLibraryUpdate,
  checkSharedMotionPresetLibraryUpdate,
  noteSharedMotionPresetLibraryUpdate,
  parseSharedMotionPresetLibraryState,
  parseSharedMotionPresetManifest,
  parseUserMotionPresetLibraryJson,
  type SharedMotionPresetLibraryState,
  type SharedMotionPresetManifest,
  type SharedMotionPresetUpdateCheck
} from '@open-pencil/scene-graph'

import { bold, fmtList, ok } from '#cli/format'

import { printMotionJson as printJson, runMotionCommandSafely as runSafely } from './common'
import { parseMotionPresetSource, readSharedMotionPresetSource } from './presets-source'

const jsonArg = { type: 'boolean', default: false, description: 'Output JSON' } as const
const outputArg = {
  type: 'string',
  alias: 'o',
  required: true,
  description: 'Output JSON path'
} as const

async function readBoundedJson(path: string, maxBytes: number, label: string): Promise<string> {
  const absolute = resolve(path)
  const fileStat = await stat(absolute)
  if (fileStat.size > maxBytes) throw new Error(`${label} may not exceed ${maxBytes} bytes.`)
  return new TextDecoder('utf-8', { fatal: true }).decode(await readFile(absolute))
}

function serializeState(state: SharedMotionPresetLibraryState): string {
  return `${JSON.stringify(parseSharedMotionPresetLibraryState(state), null, 2)}\n`
}

async function readState(path: string): Promise<SharedMotionPresetLibraryState> {
  const maxBytes = SHARED_MOTION_PRESET_LIMITS.maxManifestJsonBytes + 8_192
  const json = await readBoundedJson(path, maxBytes, 'Shared motion preset state')
  return parseSharedMotionPresetLibraryState(JSON.parse(json))
}

async function writeJson(path: string, json: string): Promise<string> {
  const output = resolve(path)
  await writeFile(output, json, 'utf8')
  return output
}

function printManifest(manifest: SharedMotionPresetManifest, output: string): void {
  console.log('')
  console.log(bold(`  Published ${manifest.library.name}`))
  console.log('')
  console.log(
    fmtList([
      {
        header: manifest.library.id,
        details: {
          publisher: manifest.publisher.name,
          version: manifest.sourceVersion,
          source: `${manifest.source.kind}:${manifest.source.ref}`,
          presets: manifest.presets.length,
          readonly: manifest.readonly
        }
      }
    ])
  )
  console.log(ok(`Wrote ${output}`))
  console.log('')
}

function printState(action: string, state: SharedMotionPresetLibraryState, output: string): void {
  console.log('')
  console.log(bold(`  ${action} ${state.manifest.library.name}`))
  console.log('')
  console.log(
    fmtList([
      {
        header: state.manifest.library.id,
        details: {
          accepted: state.manifest.sourceVersion,
          source: state.sourceVersion,
          update: state.updateAvailable ? 'available' : 'up to date',
          output
        }
      }
    ])
  )
  console.log('')
}

function printCheck(check: SharedMotionPresetUpdateCheck, output?: string): void {
  console.log('')
  console.log(bold(`  ${check.status}`))
  console.log('')
  console.log(
    fmtList([
      {
        header: check.libraryId,
        details: {
          accepted: check.acceptedVersion ?? 'not imported',
          source: check.sourceVersion,
          update: check.updateAvailable ? 'available' : 'none',
          output
        }
      }
    ])
  )
  console.log('')
}

const publish = defineCommand({
  meta: { description: 'Publish a personal preset library as a readonly shared manifest' },
  args: {
    file: {
      type: 'positional',
      required: true,
      description: 'Personal OpenPencil motion preset library JSON'
    },
    'publisher-id': { type: 'string', required: true, description: 'Stable publisher id' },
    'publisher-name': { type: 'string', required: true, description: 'Publisher name' },
    'library-id': { type: 'string', required: true, description: 'Stable shared library id' },
    'library-name': { type: 'string', required: true, description: 'Shared library name' },
    'source-version': { type: 'string', required: true, description: 'Published source version' },
    'source-kind': {
      type: 'string',
      default: 'file',
      description: 'Manifest source kind: file or url'
    },
    'source-ref': {
      type: 'string',
      description: 'Manifest source reference; defaults to the output path for file sources'
    },
    output: outputArg,
    json: jsonArg
  },
  async run({ args }) {
    await runSafely(async () => {
      const output = resolve(args.output)
      const libraryJson = await readBoundedJson(
        args.file,
        SHARED_MOTION_PRESET_LIMITS.maxManifestJsonBytes,
        'Motion preset library'
      )
      const library = parseUserMotionPresetLibraryJson(libraryJson)
      const source = parseMotionPresetSource(args['source-kind'], args['source-ref'] ?? output)
      const manifest = parseSharedMotionPresetManifest({
        format: SHARED_MOTION_PRESET_MANIFEST_FORMAT,
        schemaVersion: SHARED_MOTION_PRESET_MANIFEST_SCHEMA_VERSION,
        publisher: { id: args['publisher-id'], name: args['publisher-name'] },
        library: { id: args['library-id'], name: args['library-name'] },
        source,
        readonly: true,
        sourceVersion: args['source-version'],
        presets: library.presets
      })
      await writeJson(output, `${JSON.stringify(manifest, null, 2)}\n`)
      if (args.json) printJson({ manifest, output })
      else printManifest(manifest, output)
    })
  }
})

const importCommand = defineCommand({
  meta: { description: 'Import and explicitly accept a shared motion preset source' },
  args: {
    source: { type: 'positional', required: true, description: 'Manifest file path or URL' },
    'source-kind': { type: 'string', default: 'file', description: 'Source kind: file or url' },
    output: outputArg,
    json: jsonArg
  },
  async run({ args }) {
    await runSafely(async () => {
      const source = parseMotionPresetSource(args['source-kind'], args.source)
      const manifest = await readSharedMotionPresetSource(source)
      const state = acceptSharedMotionPresetLibraryUpdate(null, manifest)
      const output = await writeJson(args.output, serializeState(state))
      if (args.json) printJson({ state, output })
      else printState('Imported', state, output)
    })
  }
})

const check = defineCommand({
  meta: { description: 'Check an accepted shared preset library without replacing it' },
  args: {
    state: {
      type: 'positional',
      required: true,
      description: 'Accepted shared library state JSON'
    },
    output: {
      type: 'string',
      alias: 'o',
      description: 'Optionally write the checked state to this path'
    },
    json: jsonArg
  },
  async run({ args }) {
    await runSafely(async () => {
      const current = await readState(args.state)
      const manifest = await readSharedMotionPresetSource(current.manifest.source)
      const result = checkSharedMotionPresetLibraryUpdate(current, manifest)
      const state = noteSharedMotionPresetLibraryUpdate(current, manifest)
      const output = args.output ? await writeJson(args.output, serializeState(state)) : undefined
      if (args.json) printJson({ check: result, state, output: output ?? null })
      else printCheck(result, output)
    })
  }
})

const accept = defineCommand({
  meta: { description: 'Explicitly accept the latest shared preset source snapshot' },
  args: {
    state: {
      type: 'positional',
      required: true,
      description: 'Accepted shared library state JSON'
    },
    output: outputArg,
    json: jsonArg
  },
  async run({ args }) {
    await runSafely(async () => {
      const current = await readState(args.state)
      const manifest = await readSharedMotionPresetSource(current.manifest.source)
      const state = acceptSharedMotionPresetLibraryUpdate(current, manifest)
      const output = await writeJson(args.output, serializeState(state))
      if (args.json) printJson({ state, output })
      else printState('Accepted', state, output)
    })
  }
})

export default defineCommand({
  meta: { description: 'Publish, import, check, and accept shared Motion preset libraries' },
  subCommands: { publish, import: importCommand, check, accept }
})
