#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const usage =
  'Usage: prepare-submission.mjs --plugin-dir PATH [--submission-id ID] [--channel stable|beta] [--output PATH]'
const argumentsByName = new Map()
if ((process.argv.length - 2) % 2 !== 0) throw new TypeError(usage)
for (let index = 2; index < process.argv.length; index += 2) {
  const name = process.argv[index]
  const value = process.argv[index + 1]
  if (!name.startsWith('--')) throw new TypeError(usage)
  if (argumentsByName.has(name)) throw new TypeError(`Duplicate argument: ${name}`)
  argumentsByName.set(name, value)
}

const supportedArguments = new Set(['--plugin-dir', '--submission-id', '--channel', '--output'])
for (const name of argumentsByName.keys()) {
  if (!supportedArguments.has(name)) throw new TypeError(`Unsupported argument: ${name}`)
}

const pluginDirectoryValue = argumentsByName.get('--plugin-dir')
if (!pluginDirectoryValue) throw new TypeError(usage)
const pluginDirectory = path.resolve(process.cwd(), pluginDirectoryValue)
const channel = argumentsByName.get('--channel') ?? 'stable'
if (channel !== 'stable' && channel !== 'beta') {
  throw new TypeError('Submission channel must be stable or beta')
}

const manifestPath = path.join(pluginDirectory, 'dist', 'manifest.json')
const listingPath = path.join(pluginDirectory, 'listing.json')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
const listing = JSON.parse(await readFile(listingPath, 'utf8'))
if (
  manifest === null ||
  typeof manifest !== 'object' ||
  Array.isArray(manifest) ||
  manifest.format !== 'openpencil-plugin' ||
  (manifest.schemaVersion !== 1 && manifest.schemaVersion !== 2) ||
  manifest.plugin === null ||
  typeof manifest.plugin !== 'object' ||
  typeof manifest.plugin.id !== 'string' ||
  typeof manifest.plugin.version !== 'string' ||
  manifest.publisher === null ||
  typeof manifest.publisher !== 'object' ||
  typeof manifest.publisher.id !== 'string' ||
  manifest.integrity === null ||
  typeof manifest.integrity !== 'object'
) {
  throw new TypeError('dist/manifest.json must be a signed OpenPencil plugin manifest')
}
if (listing === null || typeof listing !== 'object' || Array.isArray(listing)) {
  throw new TypeError('listing.json must contain a Marketplace listing object')
}

const submissionId =
  argumentsByName.get('--submission-id') ??
  `${manifest.plugin.id}-${manifest.plugin.version}-${channel}`
if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(submissionId) || submissionId.length > 128) {
  throw new TypeError('Submission id must be a bounded lowercase Marketplace identity')
}

const outputValue = argumentsByName.get('--output')
const outputPath = outputValue
  ? path.resolve(process.cwd(), outputValue)
  : path.join(pluginDirectory, 'dist', 'submission.body.json')
const body = {
  id: submissionId,
  publisherId: manifest.publisher.id,
  channel,
  manifest,
  listing
}

await mkdir(path.dirname(outputPath), { recursive: true, mode: 0o700 })
await writeFile(outputPath, `${JSON.stringify(body, null, 2)}\n`, {
  encoding: 'utf8',
  flag: 'wx',
  mode: 0o600
})
process.stdout.write(`Created exact submission body: ${outputPath}\n`)
