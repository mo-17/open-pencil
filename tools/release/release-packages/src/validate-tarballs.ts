import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  parseJSONObject,
  parseWorkspace,
  parseWorkspacePackageJSON
} from '@open-pencil/package-artifacts-tools'

import { PREPARED_PUBLISH_PLAN, parsePreparedPublishPlan } from './publish-dirs'
import { validatePackedTarballs } from './tarballs'

const root = process.cwd()
const tarballDirectory = process.argv[2] ?? '.npm-packages'
const planPath = process.argv[3] ?? join('.publish', PREPARED_PUBLISH_PLAN)
const plan = parsePreparedPublishPlan(await readFile(join(root, planPath), 'utf8'))
const expectedLicense = await readFile(join(root, 'LICENSE'))
const rootPackage = parseWorkspace(
  parseJSONObject(await readFile(join(root, 'package.json'), 'utf8'), root),
  root
)
const workspaceNames = await Promise.all(
  rootPackage.workspaces.map(async (dir) => {
    const manifest = parseWorkspacePackageJSON(
      await readFile(join(root, dir, 'package.json'), 'utf8'),
      dir
    )
    if (!manifest.name) throw new Error(`${dir}: workspace package name is missing`)
    return manifest.name
  })
)

await validatePackedTarballs(tarballDirectory, plan, expectedLicense, workspaceNames)
