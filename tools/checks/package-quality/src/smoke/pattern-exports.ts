import { createHash } from 'node:crypto'

import dedent from 'dedent'
import { escapeRegExp } from 'es-toolkit'

import { collectExportTargets, runCommand } from '@open-pencil/package-artifacts-tools'
import {
  inspectTarball,
  readTarball,
  type TarballInspection
} from '@open-pencil/package-artifacts-tools/tarball'

interface PatternTarget {
  module: boolean
  path: string
  sha256: string
}

export interface PatternExportCheck {
  packageName: string
  specifier: string
  targets: PatternTarget[]
}

function targetPattern(target: string): RegExp {
  const segments = target.replace(/^\.\//, '').split('*')
  if (segments.length < 2) throw new Error(`Cannot enumerate pattern export target ${target}`)
  const escaped = segments.map(escapeRegExp)
  return new RegExp(
    `^${escaped.map((segment, index) => (index === 0 ? segment : `${index === 1 ? '(.*)' : '\\1'}${segment}`)).join('')}$`
  )
}

/** Enumerate only actual archive entries, retaining every condition's target and hash. */
export async function collectPatternExportChecks(
  tarball: string,
  inspection?: TarballInspection
): Promise<PatternExportCheck[]> {
  const inspected = inspection ?? (await inspectTarball(tarball))
  if (inspected.diagnostics.length > 0) {
    throw new Error(
      inspected.diagnostics.map(({ field, message }) => `${field} ${message}`).join('\n')
    )
  }
  const { manifest } = inspected
  const exports = manifest.exports
  if (!exports || typeof exports !== 'object' || Array.isArray(exports)) return []
  const patterns = Object.entries(exports).filter(([key]) => key.includes('*'))
  if (patterns.length === 0) return []
  const { files } = await readTarball(tarball)
  const checks = new Map<string, PatternExportCheck>()
  for (const [key, value] of patterns) {
    if (!key.startsWith('./') || key.split('*').length !== 2) {
      throw new Error(`${manifest.name}: unsupported pattern export ${key}`)
    }
    for (const { condition, target } of collectExportTargets(value, ['exports', key])) {
      if (condition === 'types') continue
      if (!target.startsWith('./'))
        throw new Error(`Pattern target must be package-relative: ${target}`)
      const pattern = targetPattern(target)
      let matched = false
      for (const [entry, bytes] of files) {
        if (!entry.startsWith('package/')) continue
        const path = entry.slice('package/'.length)
        const replacement = pattern.exec(path)?.[1]
        if (replacement === undefined) continue
        matched = true
        const specifier = `${manifest.name}/${key.slice(2).replace('*', replacement)}`
        const check = checks.get(specifier) ?? {
          packageName: manifest.name,
          specifier,
          targets: []
        }
        if (!check.targets.some((candidate) => candidate.path === path)) {
          check.targets.push({
            path,
            module: /\.[cm]?[jt]sx?$/.test(path),
            sha256: createHash('sha256').update(bytes).digest('hex')
          })
        }
        checks.set(specifier, check)
      }
      if (!matched)
        throw new Error(`${manifest.name}: pattern target has no packed files: ${target}`)
    }
  }
  return [...checks.values()].sort((left, right) => left.specifier.localeCompare(right.specifier))
}

/** Both runtimes choose their actual export condition, then verify that exact packed file. */
export async function verifyPatternExports(
  checks: PatternExportCheck[],
  consumer: string
): Promise<void> {
  if (checks.length === 0) return
  const code = dedent`
    import { createHash } from 'node:crypto'
    import { readFileSync } from 'node:fs'
    import { join } from 'node:path'
    import { pathToFileURL } from 'node:url'
    const verified = []
    for (const check of ${JSON.stringify(checks)}) {
      const resolved = import.meta.resolve(check.specifier)
      const target = check.targets.find(({ path }) => pathToFileURL(join(process.cwd(), 'node_modules', check.packageName, path)).href === resolved)
      if (!target) throw new Error(check.specifier + ': resolved outside recorded packed targets: ' + resolved)
      const actual = createHash('sha256').update(readFileSync(new URL(resolved))).digest('hex')
      if (actual !== target.sha256) throw new Error(check.specifier + ': does not match packed bytes')
      if (target.module) await import(check.specifier)
      verified.push({ specifier: check.specifier, path: target.path, module: target.module, sha256: actual })
    }
    console.log(JSON.stringify(verified))
  `
  for (const runtime of ['node', 'bun'] as const) {
    const result = await runCommand({
      command: runtime,
      args: runtime === 'node' ? ['--input-type=module', '--eval', code] : ['--eval', code],
      cwd: consumer,
      timeoutMs: 30_000
    })
    console.log(
      `[package-quality] ${runtime}: verified ${checks.length} concrete pattern exports ${result.stdout.trim()}`
    )
  }
}
