import path from 'node:path'

import ts from 'typescript'
import { parse as parseVueSfc } from 'vue/compiler-sfc'

import { createTextRule, PACKAGE_ALIASES, type Rule } from './support.ts'

interface SourcePosition {
  line: number
  column: number
}

function sourcePosition(content: string, offset: number): SourcePosition {
  const before = content.slice(0, offset)
  return { line: before.split('\n').length, column: offset - before.lastIndexOf('\n') - 1 }
}

/** Template quasis, comments and string contents are not executable AST children. */
function visitSource(
  sourceRel: string,
  content: string,
  visit: (node: ts.Node, position: () => SourcePosition) => void
): void {
  const fragments: Array<{ content: string; offset: number; jsx: boolean }> = []
  if (sourceRel.endsWith('.vue')) {
    const { descriptor } = parseVueSfc(content, { filename: sourceRel })
    for (const block of [descriptor.script, descriptor.scriptSetup]) {
      if (block)
        fragments.push({
          content: block.content,
          offset: block.loc.start.offset,
          jsx: block.lang === 'tsx' || block.lang === 'jsx'
        })
    }
  } else {
    fragments.push({ content, offset: 0, jsx: /\.[jt]sx$/u.test(sourceRel) })
  }
  for (const fragment of fragments) {
    const source = ts.createSourceFile(
      sourceRel,
      fragment.content,
      ts.ScriptTarget.Latest,
      false,
      fragment.jsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    )
    function walk(node: ts.Node): void {
      visit(node, () => sourcePosition(content, fragment.offset + node.getStart(source)))
      ts.forEachChild(node, walk)
    }
    walk(source)
  }
}

function literalText(node: ts.Node | undefined): string | null {
  return node && ts.isStringLiteralLike(node) ? node.text : null
}

function importedModule(node: ts.Node): string | null {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
    return literalText(node.moduleSpecifier)
  }
  if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
    return literalText(node.moduleReference.expression)
  }
  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
    return literalText(node.argument.literal)
  }
  if (
    ts.isCallExpression(node) &&
    (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
  ) {
    return literalText(node.arguments[0])
  }
  return null
}

function resolveModule(sourceRel: string, specifier: string): string | null {
  if (specifier.startsWith('@/')) return `src/${specifier.slice(2)}`
  for (const [alias, target] of Object.entries(PACKAGE_ALIASES)) {
    if (specifier.startsWith(alias)) return target + specifier.slice(alias.length)
  }
  return specifier.startsWith('.')
    ? path.posix.join(path.posix.dirname(sourceRel), specifier)
    : null
}

/** Backend rules use syntax-aware references without changing unrelated import rules. */
export function createBackendImportRule(
  name: string,
  appliesTo: (sourceRel: string) => boolean,
  checkImport: (sourceRel: string, specifier: string, resolved: string | null) => string | null
): Rule {
  return createTextRule(name, (sourceRel, content) => {
    if (!appliesTo(sourceRel)) return []
    const diagnostics: Array<SourcePosition & { message: string }> = []
    visitSource(sourceRel, content, (node, position) => {
      const specifier = importedModule(node)
      if (specifier === null) return
      const message = checkImport(sourceRel, specifier, resolveModule(sourceRel, specifier))
      if (message) diagnostics.push({ message, ...position() })
    })
    return diagnostics
  })
}

function referenceName(node: ts.Expression): string | null {
  if (ts.isIdentifier(node)) return node.text
  if (ts.isPropertyAccessExpression(node)) return node.name.text
  if (ts.isElementAccessExpression(node)) return literalText(node.argumentExpression)
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isSatisfiesExpression(node)
  )
    return referenceName(node.expression)
  return null
}

const NETWORK_CALLS = new Set(['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'])
const HOST_MEMBERS = new Set([
  'Bun',
  'Deno',
  'window',
  'document',
  'navigator',
  'localStorage',
  'sessionStorage'
])

export function backendProviderRuntimeEffectLocations(
  sourceRel: string,
  content: string
): SourcePosition[] {
  const locations: SourcePosition[] = []
  visitSource(sourceRel, content, (node, position) => {
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const owner = referenceName(node.expression)
      if (
        (owner === 'process' && referenceName(node) === 'env') ||
        (owner !== null && HOST_MEMBERS.has(owner))
      )
        locations.push(position())
    }
    if (
      ts.isCallExpression(node) ||
      ts.isNewExpression(node) ||
      ts.isTaggedTemplateExpression(node)
    ) {
      const name = referenceName(ts.isTaggedTemplateExpression(node) ? node.tag : node.expression)
      if (name !== null && NETWORK_CALLS.has(name)) locations.push(position())
    }
  })
  return locations
}
