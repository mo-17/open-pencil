import { existsSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const PARSER_DEPENDENCIES = new Set(['unified', 'remark-parse', 'remark-rehype'])

/** Resolve only the reviewed parsers already installed with react-markdown.
 * Generated projects declare these packages directly. The host's isolated
 * workspace install may expose them only through react-markdown's dependencies.
 */
export function installedMarkdownDependency(
  name: string,
  workspaceRoot: string
): string | undefined {
  if (!PARSER_DEPENDENCIES.has(name)) return undefined
  try {
    const markdown = realpathSync(join(resolve(workspaceRoot), 'node_modules/react-markdown'))
    const dependency = join(dirname(markdown), name)
    return existsSync(join(dependency, 'index.js')) ? realpathSync(dependency) : undefined
  } catch {
    return undefined
  }
}

export function markdownDependencyAliases(workspaceRoot: string) {
  return [...PARSER_DEPENDENCIES].flatMap((name) => {
    if (existsSync(join(workspaceRoot, 'node_modules', name))) return []
    const installed = installedMarkdownDependency(name, workspaceRoot)
    if (!installed) return []
    return [{ find: new RegExp('^' + name + '$'), replacement: join(installed, 'index.js') }]
  })
}
