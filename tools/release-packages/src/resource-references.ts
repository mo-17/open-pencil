import { readdir, readFile, stat } from 'node:fs/promises'
import { extname, isAbsolute, join, relative, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import ts from 'typescript'

const RUNTIME_SOURCE_EXTENSIONS = new Set([
  '.cjs',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx'
])
const WORKER_CONSTRUCTORS = new Set(['SharedWorker', 'Worker'])

interface ResourceReference {
  column: number
  line: number
  sourcePath: string
  specifier: string
  worker: boolean
}

function constructorName(node: ts.Expression): string | undefined {
  if (ts.isIdentifier(node)) return node.text
  if (ts.isPropertyAccessExpression(node)) return node.name.text
  return undefined
}

function isImportMetaURL(node: ts.Expression | undefined): boolean {
  return Boolean(
    node &&
    ts.isPropertyAccessExpression(node) &&
    node.name.text === 'url' &&
    ts.isMetaProperty(node.expression) &&
    node.expression.keywordToken === ts.SyntaxKind.ImportKeyword &&
    node.expression.name.text === 'meta'
  )
}

function staticString(node: ts.Expression | undefined): string | undefined {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : undefined
}

function scriptKind(path: string): ts.ScriptKind {
  const extension = extname(path).toLowerCase()
  if (extension === '.tsx') return ts.ScriptKind.TSX
  if (extension === '.jsx') return ts.ScriptKind.JSX
  if (extension === '.ts' || extension === '.mts' || extension === '.cts') return ts.ScriptKind.TS
  return ts.ScriptKind.JS
}

function sourceLocation(
  sourceFile: ts.SourceFile,
  node: ts.Node
): { column: number; line: number } {
  const location = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
  return { column: location.character + 1, line: location.line + 1 }
}

function collectResourceReferences(
  sourcePath: string,
  source: string
): { failures: string[]; references: ResourceReference[] } {
  const sourceFile = ts.createSourceFile(
    sourcePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(sourcePath)
  )
  const failures: string[] = []
  const references: ResourceReference[] = []

  const visit = (node: ts.Node): void => {
    if (ts.isNewExpression(node)) {
      const name = constructorName(node.expression)
      const firstArgument = node.arguments?.[0]
      const secondArgument = node.arguments?.[1]
      const location = sourceLocation(sourceFile, node)

      if (name === 'URL' && isImportMetaURL(secondArgument)) {
        const specifier = staticString(firstArgument)
        if (specifier === undefined) {
          failures.push(
            `${sourcePath}:${location.line}:${location.column}: import.meta.url resource must use a static string`
          )
        } else {
          const parent = node.parent
          references.push({
            ...location,
            sourcePath,
            specifier,
            worker:
              ts.isNewExpression(parent) &&
              parent.arguments?.[0] === node &&
              WORKER_CONSTRUCTORS.has(constructorName(parent.expression) ?? '')
          })
        }
      } else if (name && WORKER_CONSTRUCTORS.has(name)) {
        const usesImportMetaURL =
          firstArgument &&
          ts.isNewExpression(firstArgument) &&
          constructorName(firstArgument.expression) === 'URL' &&
          isImportMetaURL(firstArgument.arguments?.[1])
        if (!usesImportMetaURL) {
          const specifier = staticString(firstArgument)
          if (specifier === undefined) {
            failures.push(
              `${sourcePath}:${location.line}:${location.column}: ${name} resource must use a static URL`
            )
          } else {
            references.push({ ...location, sourcePath, specifier, worker: true })
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return { failures, references }
}

async function runtimeSourceFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true })
  const paths = await Promise.all(
    entries.map(async (entry) => {
      const path = join(root, entry.name)
      if (entry.isDirectory()) return runtimeSourceFiles(path)
      return entry.isFile() && RUNTIME_SOURCE_EXTENSIONS.has(extname(entry.name).toLowerCase())
        ? [path]
        : []
    })
  )
  return paths.flat()
}

function isInside(root: string, target: string): boolean {
  const path = relative(root, target)
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}

export async function validatePackageResourceReferences(packageRoot: string): Promise<void> {
  const failures: string[] = []
  for (const sourcePath of (await runtimeSourceFiles(packageRoot)).sort()) {
    const sourceLabel = relative(packageRoot, sourcePath)
    const collected = collectResourceReferences(sourceLabel, await readFile(sourcePath, 'utf8'))
    failures.push(...collected.failures)

    for (const reference of collected.references) {
      let targetURL: URL
      try {
        targetURL = new URL(reference.specifier, pathToFileURL(sourcePath))
      } catch {
        failures.push(
          `${reference.sourcePath}:${reference.line}:${reference.column}: invalid resource URL ${JSON.stringify(reference.specifier)}`
        )
        continue
      }
      if (targetURL.protocol !== 'file:') continue
      targetURL.hash = ''
      targetURL.search = ''

      let targetPath: string
      try {
        targetPath = fileURLToPath(targetURL)
      } catch {
        failures.push(
          `${reference.sourcePath}:${reference.line}:${reference.column}: invalid file resource ${JSON.stringify(reference.specifier)}`
        )
        continue
      }
      if (!isInside(packageRoot, targetPath)) {
        failures.push(
          `${reference.sourcePath}:${reference.line}:${reference.column}: resource escapes package root: ${JSON.stringify(reference.specifier)}`
        )
        continue
      }

      try {
        const target = await stat(targetPath)
        if (reference.worker && !target.isFile()) {
          failures.push(
            `${reference.sourcePath}:${reference.line}:${reference.column}: worker target is not a file: ${relative(packageRoot, targetPath)}`
          )
        }
      } catch {
        failures.push(
          `${reference.sourcePath}:${reference.line}:${reference.column}: resource target is missing: ${relative(packageRoot, targetPath)}`
        )
      }
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `Published package has invalid runtime resource references:\n${failures.join('\n')}`
    )
  }
}
