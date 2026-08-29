#!/usr/bin/env node

import { chmod, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const examplesRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = path.resolve(examplesRoot, '../..')
if (process.argv.length !== 4 || process.argv[2] !== '--output-dir') {
  throw new TypeError('Usage: generate-keypair.mjs --output-dir PATH_OUTSIDE_THE_REPOSITORY')
}
const keyDirectory = path.resolve(process.cwd(), process.argv[3])

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

async function resolveThroughExistingAncestor(candidate) {
  let current = candidate
  const missingSegments = []
  while (true) {
    try {
      return path.join(await realpath(current), ...missingSegments.reverse())
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      const parent = path.dirname(current)
      if (parent === current) throw error
      missingSegments.push(path.basename(current))
      current = parent
    }
  }
}

const realRepositoryRoot = await realpath(repositoryRoot)
if (
  isWithin(repositoryRoot, keyDirectory) ||
  isWithin(realRepositoryRoot, await resolveThroughExistingAncestor(keyDirectory))
) {
  throw new TypeError('Publisher keys must be generated outside the OpenPencil repository')
}
function pem(label, bytes) {
  const base64 = Buffer.from(bytes).toString('base64')
  const body = base64.match(/.{1,64}/g)?.join('\n') ?? ''
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`
}

const createdDirectory = await mkdir(keyDirectory, { recursive: true, mode: 0o700 })
if (createdDirectory === undefined) {
  throw new TypeError('Publisher key output directory must not already exist')
}
const realKeyDirectory = await realpath(keyDirectory)
if (isWithin(realRepositoryRoot, realKeyDirectory)) {
  throw new TypeError('Publisher keys must be generated outside the OpenPencil repository')
}
if (process.platform !== 'win32') await chmod(realKeyDirectory, 0o700)
const privateKeyPath = path.join(realKeyDirectory, 'publisher-private.pem')
const publicKeyPath = path.join(realKeyDirectory, 'publisher-public.pem')
const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
const privateKey = pem('PRIVATE KEY', await crypto.subtle.exportKey('pkcs8', pair.privateKey))
const publicKey = pem('PUBLIC KEY', await crypto.subtle.exportKey('spki', pair.publicKey))

let privateKeyWritten = false
try {
  await writeFile(privateKeyPath, privateKey, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  privateKeyWritten = true
  await writeFile(publicKeyPath, publicKey, { encoding: 'utf8', flag: 'wx', mode: 0o644 })
} catch (error) {
  if (privateKeyWritten) await rm(privateKeyPath, { force: true })
  throw error
}

process.stdout.write(`Created private key: ${privateKeyPath}\n`)
process.stdout.write(`Created public key: ${publicKeyPath}\n`)
process.stdout.write('Keep the private key local; register only the public key with Marketplace.\n')
