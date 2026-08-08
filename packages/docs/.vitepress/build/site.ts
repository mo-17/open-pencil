import { spawn } from 'node:child_process'
import { lstat, mkdir, mkdtemp, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolveDocsBuildLocales } from '../locale-constants'
import { docsNodeOptions } from './environment'
import { mergePartitionOutputs, type SitePartition } from './merge'

const docsDir = fileURLToPath(new URL('../..', import.meta.url))
function isInside(parent: string, candidate: string): boolean {
  const pathFromParent = relative(parent, candidate)
  return (
    pathFromParent !== '' &&
    !pathFromParent.startsWith(`..${sep}`) &&
    pathFromParent !== '..' &&
    !isAbsolute(pathFromParent)
  )
}

function resolveOutputDirectory(): string {
  const generatedOutputRoot = resolve(docsDir, '.vitepress')
  const outputDir = process.env.DOCS_OUT_DIR
    ? resolve(docsDir, process.env.DOCS_OUT_DIR)
    : resolve(docsDir, '.vitepress/dist')
  const generatedPath = relative(generatedOutputRoot, outputDir)
  const firstSegment = generatedPath.split(sep, 1)[0]
  if (!isInside(generatedOutputRoot, outputDir) || !firstSegment.startsWith('dist')) {
    throw new Error(
      `DOCS_OUT_DIR must be a dist-prefixed directory inside ${generatedOutputRoot}; received ${outputDir}`
    )
  }
  return outputDir
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function runPartition(partition: SitePartition, cacheDir: string): Promise<void> {
  const environment = {
    ...process.env,
    DOCS_BUILD_LOCALE: partition.locale,
    DOCS_CACHE_DIR: cacheDir,
    DOCS_OUT_DIR: partition.outputDir,
    NODE_OPTIONS: docsNodeOptions(process.env.NODE_OPTIONS)
  }

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, ['run', 'build:partition'], {
      cwd: docsDir,
      env: environment,
      stdio: 'inherit'
    })
    child.once('error', rejectPromise)
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise()
      else {
        rejectPromise(
          new Error(
            `Documentation partition ${partition.locale} failed with ${signal ? `signal ${signal}` : `exit code ${code ?? 'unknown'}`}`
          )
        )
      }
    })
  })
}

async function installStagingDirectory(stagingDir: string, outputDir: string): Promise<void> {
  let backupDir: string | undefined
  if (await pathExists(outputDir)) {
    backupDir = await mkdtemp(join(dirname(outputDir), '.docs-dist-backup-'))
    await rm(backupDir, { recursive: true, force: true })
    await rename(outputDir, backupDir)
  }

  try {
    await rename(stagingDir, outputDir)
  } catch (installError) {
    if (backupDir) {
      try {
        await rename(backupDir, outputDir)
      } catch (restoreError) {
        throw new AggregateError(
          [installError, restoreError],
          `Failed to install the docs output and restore its backup at ${backupDir}`
        )
      }
    }
    throw installError
  }

  if (backupDir) await rm(backupDir, { recursive: true, force: true })
}

const outputDir = resolveOutputDirectory()
const docsBuildLocales = resolveDocsBuildLocales(process.env.DOCS_LOCALES)
const workDir = await mkdtemp(join(tmpdir(), 'openpencil-docs-build-'))
let stagingDir: string | undefined

try {
  const partitions: SitePartition[] = []
  for (const [index, locale] of docsBuildLocales.entries()) {
    const partition: SitePartition = {
      locale,
      outputDir: join(workDir, 'output', locale)
    }
    const cacheDir = join(workDir, 'cache', locale)
    await mkdir(cacheDir, { recursive: true })
    process.stdout.write(
      `[docs:site] Building ${locale} partition (${index + 1}/${docsBuildLocales.length})\n`
    )
    await runPartition(partition, cacheDir)
    partitions.push(partition)
  }

  await mkdir(dirname(outputDir), { recursive: true })
  stagingDir = await mkdtemp(join(dirname(outputDir), '.docs-dist-stage-'))
  const result = await mergePartitionOutputs(partitions, stagingDir)
  await installStagingDirectory(stagingDir, outputDir)
  stagingDir = undefined

  process.stdout.write(
    `[docs:site] Merged ${docsBuildLocales.length} partitions into ${outputDir} ` +
      `(${result.hashmapEntries} pages, ${result.sitemapUrls} sitemap URLs, ` +
      `${result.copiedFiles} copied files, ${result.reusedFiles} shared files)\n`
  )
} finally {
  if (stagingDir) await rm(stagingDir, { recursive: true, force: true })
  await rm(workDir, { recursive: true, force: true })
}
