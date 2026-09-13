import { publicPackageDirs, repositoryRoot } from '../packages'
import { runPackageChecks } from './run'

export async function checkTypes(root: string): Promise<void> {
  await runPackageChecks(
    (await publicPackageDirs(root)).map((packageDir) => ({
      command: 'bun',
      args: ['attw', '--pack', packageDir, '--profile', 'esm-only', '--format', 'ascii'],
      cwd: root
    }))
  )
}

if (import.meta.main) await checkTypes(repositoryRoot)
