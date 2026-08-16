import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { PREPARED_PUBLISH_PLAN, type PreparedPublishPlan } from './publish-dirs'
import { validatePackedTarballs } from './tarballs'

const root = process.cwd()
const tarballDirectory = process.argv[2] ?? '.npm-packages'
const planPath = process.argv[3] ?? join('.publish', PREPARED_PUBLISH_PLAN)
const plan = JSON.parse(await readFile(join(root, planPath), 'utf8')) as PreparedPublishPlan
const expectedLicense = await readFile(join(root, 'LICENSE'))
const rootPackage = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
  workspaces: string[]
}
const workspaceNames = await Promise.all(
  rootPackage.workspaces.map(async (dir) => {
    const manifest = JSON.parse(await readFile(join(root, dir, 'package.json'), 'utf8')) as {
      name: string
    }
    return manifest.name
  })
)

await validatePackedTarballs(tarballDirectory, plan, expectedLicense, workspaceNames)
