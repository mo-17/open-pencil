import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

import { DEFAULT_PACKAGES } from '../src/publish-dirs'

const WORKFLOW_PATH = new URL('../../../.github/workflows/build.yml', import.meta.url)
const UNSIGNED_TAURI_CONFIG_PATH = new URL(
  '../../../desktop/tauri.unsigned.conf.json',
  import.meta.url
)
const APP_WORKFLOW_PATH = new URL('../../../.github/workflows/app.yml', import.meta.url)
const DOCS_WORKFLOW_PATH = new URL('../../../.github/workflows/docs.yml', import.meta.url)
const SETUP_BUN_ACTION_PATH = new URL(
  '../../../.github/actions/setup-bun/action.yml',
  import.meta.url
)
const PACKAGE_ROOT_PATH = new URL('../../package-quality/src/packages.ts', import.meta.url)
const PACKAGE_SMOKE_PATH = new URL('../../package-quality/src/smoke.ts', import.meta.url)
const NON_NPM_JOB_GATE =
  "if: github.event_name == 'workflow_dispatch' || github.repository == 'open-pencil/open-pencil'"
const CHECKOUT_ACTION = 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1'
const SETUP_NODE_ACTION = 'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020'

function job(workflow: string, name: string, nextName?: string): string {
  const start = workflow.indexOf(`  ${name}:`)
  expect(start).toBeGreaterThan(-1)
  const end = nextName ? workflow.indexOf(`  ${nextName}:`, start + 1) : workflow.length
  expect(end).toBeGreaterThan(start)
  return workflow.slice(start, end)
}

function namedRunBlock(workflow: string, name: string): string {
  const stepStart = workflow.indexOf(`      - name: ${name}\n`)
  if (stepStart === -1) throw new Error(`Workflow step not found: ${name}`)
  const marker = '        run: |\n'
  const runStart = workflow.indexOf(marker, stepStart)
  if (runStart === -1) throw new Error(`Workflow run block not found: ${name}`)
  const contentStart = runStart + marker.length
  const nextStep = workflow.indexOf('\n      - ', contentStart)
  const content = workflow.slice(contentStart, nextStep === -1 ? workflow.length : nextStep)
  return content
    .split('\n')
    .map((line) => (line.startsWith('          ') ? line.slice(10) : line))
    .join('\n')
}

function namedStep(workflow: string, name: string, nextName?: string): string {
  const start = workflow.indexOf(`      - name: ${name}\n`)
  expect(start).toBeGreaterThan(-1)
  const end = nextName
    ? workflow.indexOf(`      - name: ${nextName}\n`, start + 1)
    : workflow.length
  expect(end).toBeGreaterThan(start)
  return workflow.slice(start, end)
}

describe('npm release workflow', () => {
  test('runs non-npm release jobs automatically only in the official repository', () => {
    const buildWorkflow = readFileSync(WORKFLOW_PATH, 'utf8')
    const build = job(buildWorkflow, 'build', 'prepare-npm')
    expect(build).toContain(NON_NPM_JOB_GATE)

    for (const path of [APP_WORKFLOW_PATH, DOCS_WORKFLOW_PATH]) {
      const deployWorkflow = readFileSync(path, 'utf8')
      const deploy = job(deployWorkflow, 'deploy')
      expect(deployWorkflow).toContain('workflow_dispatch:')
      expect(deployWorkflow).toMatch(/- ['"]v\*['"]/)
      expect(deploy).toContain(NON_NPM_JOB_GATE)
    }

    const prepare = job(buildWorkflow, 'prepare-npm', 'publish-npm')
    const publish = job(buildWorkflow, 'publish-npm')
    expect(prepare).not.toContain(NON_NPM_JOB_GATE)
    expect(publish).not.toContain(NON_NPM_JOB_GATE)
  })

  test('keeps manual desktop builds unsigned, secret-free, and artifact-only', () => {
    const workflow = readFileSync(WORKFLOW_PATH, 'utf8')
    const build = job(workflow, 'build', 'prepare-npm')
    const releaseNotes = namedStep(
      build,
      'Extract release notes',
      'Build unsigned Tauri workflow artifacts'
    )
    const manual = namedStep(
      build,
      'Build unsigned Tauri workflow artifacts',
      'Upload unsigned Tauri workflow artifacts'
    )
    const upload = namedStep(
      build,
      'Upload unsigned Tauri workflow artifacts',
      'Build signed Tauri release'
    )
    const release = namedStep(
      build,
      'Build signed Tauri release',
      'Verify signed macOS CodePen sidecar'
    )
    const signedVerification = namedStep(build, 'Verify signed macOS CodePen sidecar')

    expect(build).toContain(
      `uses: ${CHECKOUT_ACTION}\n        with:\n          persist-credentials: false`
    )
    expect(build.match(/^\s+label: /gm)).toHaveLength(5)
    for (const label of ['macos-arm64', 'macos-x64', 'windows-x64', 'windows-arm64', 'linux-x64']) {
      expect(build).toContain(`label: ${label}`)
    }
    expect(build).toContain('manualBundleArgs: --bundles deb,rpm')
    expect(build.match(/manualBundleArgs: --bundles deb,rpm/g)).toHaveLength(1)
    expect(releaseNotes).toContain(
      "if: github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')"
    )

    expect(manual).toContain("if: github.event_name == 'workflow_dispatch'")
    expect(manual).toContain('uses: tauri-apps/tauri-action@v0')
    expect(manual).toContain('args: >-')
    expect(manual).toContain(`--target \${{ matrix.target }}`)
    expect(manual).toContain('--no-sign')
    expect(manual).toContain('--config desktop/tauri.unsigned.conf.json')
    expect(manual).toContain(`\${{ matrix.manualBundleArgs }}`)
    for (const forbidden of [
      'GITHUB_TOKEN',
      'secrets.',
      'TAURI_SIGNING_',
      'APPLE_',
      'tagName:',
      'releaseName:',
      'releaseId:'
    ]) {
      expect(manual).not.toContain(forbidden)
    }

    expect(upload).toContain("if: github.event_name == 'workflow_dispatch'")
    expect(upload).toContain('uses: actions/upload-artifact@v4')
    expect(upload).toContain(`name: open-pencil-\${{ matrix.label }}-\${{ github.run_attempt }}`)
    expect(upload).toContain(`path: desktop/target/\${{ matrix.target }}/release/bundle/`)
    expect(upload).toContain('if-no-files-found: error')
    expect(upload).toContain('retention-days: 14')
    expect(upload).toContain('compression-level: 0')
    expect(upload).not.toContain('tagName:')
    expect(upload).not.toContain('releaseName:')

    const releaseGate = "if: github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')"
    expect(release).toContain(releaseGate)
    expect(release).toContain(`tagName: \${{ github.ref_name }}`)
    expect(release).toContain(`releaseName: \${{ github.ref_name }}`)
    expect(release).toContain('includeUpdaterJson: true')
    expect(release).not.toContain('matrix.manualBundleArgs')
    expect(release).not.toContain('--bundles')
    expect(release).not.toContain('uploadUpdaterJson:')
    expect(release).not.toContain('uploadUpdaterSignatures:')
    for (const secret of [
      'secrets.GITHUB_TOKEN',
      'secrets.TAURI_SIGNING_PRIVATE_KEY',
      'secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD',
      'secrets.APPLE_CERTIFICATE',
      'secrets.APPLE_CERTIFICATE_PASSWORD',
      'secrets.APPLE_ID',
      'secrets.APPLE_PASSWORD',
      'secrets.APPLE_TEAM_ID'
    ]) {
      expect(release).toContain(secret)
      expect(build.replace(release, '')).not.toContain(secret)
    }

    expect(signedVerification).toContain("github.event_name == 'push' &&")
    expect(signedVerification).toContain("startsWith(github.ref, 'refs/tags/v') &&")
    expect(signedVerification).toContain("startsWith(matrix.target, 'aarch64-apple-')")
    expect(signedVerification).toContain("startsWith(matrix.target, 'x86_64-apple-')")

    const unsignedConfig = JSON.parse(readFileSync(UNSIGNED_TAURI_CONFIG_PATH, 'utf8')) as {
      bundle: {
        createUpdaterArtifacts: boolean
        macOS: { signingIdentity: string | null }
      }
      plugins: { updater: { endpoints: string[] } }
    }
    expect(unsignedConfig.bundle.createUpdaterArtifacts).toBe(false)
    expect(unsignedConfig.bundle.macOS.signingIdentity).toBeNull()
    expect(unsignedConfig.plugins.updater.endpoints).toEqual([])
  })

  test('uses bounded HTTPS Ubuntu sources for Linux build dependencies', () => {
    const workflow = readFileSync(WORKFLOW_PATH, 'utf8')
    const build = job(workflow, 'build', 'prepare-npm')
    const install = namedStep(
      build,
      'Install dependencies (Linux)',
      'Verify native Windows Bun runtime'
    )
    const run = namedRunBlock(build, 'Install dependencies (Linux)')
    const dollar = '$'

    expect(install).toContain("if: startsWith(matrix.platform, 'ubuntu')")
    expect(install).toContain('timeout-minutes: 10')
    expect(install).toContain('DEBIAN_FRONTEND: noninteractive')
    expect(install).toContain('NEEDRESTART_MODE: a')
    expect(run).toContain('test "$VERSION_CODENAME" = jammy')
    expect(run).toContain('deb https://archive.ubuntu.com/ubuntu jammy ')
    expect(run).toContain('deb https://archive.ubuntu.com/ubuntu jammy-updates ')
    expect(run).toContain('deb https://archive.ubuntu.com/ubuntu jammy-backports ')
    expect(run).toContain('deb https://security.ubuntu.com/ubuntu jammy-security ')
    expect(run).not.toContain('azure.archive.ubuntu.com')
    expect(run).toContain('-o "Dir::Etc::sourcelist=$ubuntu_sources"')
    expect(run).toContain('-o Dir::Etc::sourceparts=-')
    expect(run).toContain('-o Acquire::Retries=5')
    expect(run).toContain('-o Acquire::http::Timeout=20')
    expect(run).toContain('-o Acquire::https::Timeout=20')
    expect(run).toContain('-o DPkg::Lock::Timeout=60')
    expect(run.match(/sudo env DEBIAN_FRONTEND=/g)).toHaveLength(2)
    expect(run).toContain(`apt-get "${dollar}{apt_options[@]}" update`)
    expect(run).toContain(`apt-get "${dollar}{apt_options[@]}" install -y --no-install-recommends`)
  })

  test('uses owner/tag gates and keeps credentials out of the preparation job', () => {
    const workflow = readFileSync(WORKFLOW_PATH, 'utf8')
    const prepare = job(workflow, 'prepare-npm', 'publish-npm')
    const publish = job(workflow, 'publish-npm')
    const gate =
      "if: github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v') && github.repository == 'mo-17/open-pencil'"

    expect(prepare).toContain(gate)
    expect(publish).toContain(gate)
    expect(prepare).toContain('permissions:\n      contents: read\n    outputs:')
    expect(prepare).not.toContain('id-token: write')
    expect(prepare).not.toContain('secrets.NPM_TOKEN')
    expect(prepare).not.toContain('NODE_AUTH_TOKEN')
    expect(prepare).toMatch(/release_digest: \$\{\{ steps\.release_digest\.outputs\.digest \}\}/)
    expect(publish).toContain('needs: prepare-npm')
    expect(publish).toContain('environment: npm-production')
    expect(publish).toContain(
      'permissions:\n      contents: read\n      id-token: write\n    steps:'
    )
    expect(publish).not.toContain('./.github/actions/setup-bun')
    expect(publish).not.toContain('actions/checkout')
    expect(publish).toContain('node-version: 24.19.0')
  })

  test('builds, prepares, audits, smokes, then uploads one immutable npm artifact', () => {
    const workflow = readFileSync(WORKFLOW_PATH, 'utf8')
    const prepare = job(workflow, 'prepare-npm', 'publish-npm')
    const buildIndex = prepare.indexOf('name: Build packages for publish')
    const prepareIndex = prepare.indexOf('name: Prepare publish directories')
    const validationIndex = prepare.indexOf('name: Validate prepared package metadata')
    const packIndex = prepare.indexOf('name: Pack and audit release tarballs')
    const smokeIndex = prepare.indexOf('name: Smoke audited npm tarball consumers')
    const uploadIndex = prepare.indexOf('name: Upload audited npm release artifact')

    expect(buildIndex).toBeGreaterThan(-1)
    expect(buildIndex).toBeLessThan(prepareIndex)
    expect(prepareIndex).toBeLessThan(validationIndex)
    expect(validationIndex).toBeLessThan(packIndex)
    expect(packIndex).toBeLessThan(smokeIndex)
    expect(smokeIndex).toBeLessThan(uploadIndex)

    expect(prepare).toContain('run: bun run build:packages')
    expect(prepare).toContain('bun tools/release-packages/src/prepare-publish-dirs.ts')
    expect(prepare).toContain(
      "uses: ./.github/actions/setup-bun\n        with:\n          cache: 'false'"
    )
    expect(prepare).toContain('OPENPENCIL_PACKAGE_ROOT: .publish')
    expect(prepare).toContain('bun tools/package-quality/src/check/metadata.ts')
    expect(prepare).toContain('bun tools/package-quality/src/check/publint.ts')
    expect(prepare).toContain('bun tools/package-quality/src/check/attw.ts')
    expect(prepare).toContain('bun tools/package-quality/src/smoke.ts')
    expect(prepare).toContain('bun tools/release-packages/src/validate-tarballs.ts')
    expect(prepare).toContain('OPENPENCIL_PACKAGE_TARBALL_ROOT: npm-release')
    expect(prepare).toContain('name: Smoke audited npm tarball consumers')
    expect(prepare).toContain('actions/upload-artifact@v4')
    expect(prepare).toContain('compression-level: 0')
    expect(prepare).toContain(
      'shasum -a 512 npm-release/release-plan.json npm-release/*.tgz > npm-release/SHA512SUMS'
    )
    expect(prepare).toContain(`printf 'digest=%s\\n' "$release_digest" >> "$GITHUB_OUTPUT"`)
    expect(prepare).not.toContain('npm view')

    const setupBunAction = readFileSync(SETUP_BUN_ACTION_PATH, 'utf8')
    const dollar = '$'
    expect(setupBunAction).toContain('cache:\n    description: Restore the Bun package cache')
    expect(setupBunAction).toContain("if: inputs.cache == 'true'")
    expect(setupBunAction).toContain('bun-download-url:')
    expect(setupBunAction).toContain("if: inputs.bun-download-url != ''")
    expect(setupBunAction).toContain(`bun-download-url: ${dollar}{{ inputs.bun-download-url }}`)
    expect(setupBunAction).toContain(`${dollar}{{ runner.os }}-${dollar}{{ runner.arch }}`)
  })

  test('derives release identity and order from the prepared release plan', () => {
    const workflow = readFileSync(WORKFLOW_PATH, 'utf8')
    const prepare = job(workflow, 'prepare-npm', 'publish-npm')
    const publish = job(workflow, 'publish-npm')

    expect(prepare).toContain(`export RELEASE_VERSION="\${GITHUB_REF_NAME#v}"`)
    expect(prepare).toContain("require('./.publish/release-plan.json').packages")
    expect(prepare).toContain('item.version !== plan.version')
    expect(prepare).toContain('npm pack --pack-destination "$root_dir/npm-release"')
    expect(prepare).not.toContain('publish_packages="')
    expect(prepare).toContain('Release plan must publish MCP before CLI')
    expect(prepare).toMatch(
      /Release plan must publish \$\{dependencyName\} before \$\{item\.name\}/
    )
    expect(publish).toContain("require('./npm-release/release-plan.json').packages")
    expect(publish).not.toContain('publish_packages="')
    expect(publish).toContain('shasum -a 512 -c npm-release/SHA512SUMS')
    expect(publish).toMatch(
      /EXPECTED_RELEASE_DIGEST: \$\{\{ needs\.prepare-npm\.outputs\.release_digest \}\}/
    )
    expect(publish).toContain('Downloaded npm release artifact digest does not match')
    expect(publish).toContain('actions/download-artifact@v4')
  })

  test('keeps the prepared release plan in dependency order with MCP before CLI', () => {
    const manifests = DEFAULT_PACKAGES.map(
      (pkg) =>
        JSON.parse(
          readFileSync(new URL(`../../../${pkg.dir}/package.json`, import.meta.url), 'utf8')
        ) as {
          name: string
          dependencies?: Record<string, string>
          optionalDependencies?: Record<string, string>
          peerDependencies?: Record<string, string>
        }
    )
    const positions = new Map(manifests.map((manifest, index) => [manifest.name, index]))

    for (const [index, manifest] of manifests.entries()) {
      for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies'] as const) {
        for (const dependencyName of Object.keys(manifest[field] ?? {})) {
          const dependencyIndex = positions.get(dependencyName)
          if (dependencyIndex !== undefined) expect(dependencyIndex).toBeLessThan(index)
        }
      }
    }

    const mcpIndex = positions.get('@open-pencil/mcp')
    const cliIndex = positions.get('@open-pencil/cli')
    expect(mcpIndex).toBeDefined()
    expect(cliIndex).toBeDefined()
    if (mcpIndex === undefined || cliIndex === undefined) return
    expect(mcpIndex).toBeLessThan(cliIndex)
  })

  test('smokes the exact npm tarballs and exercises packed React and Vue CLI builds', () => {
    const packageRoot = readFileSync(PACKAGE_ROOT_PATH, 'utf8')
    const packageSmoke = readFileSync(PACKAGE_SMOKE_PATH, 'utf8')

    expect(packageRoot).toContain('process.env.OPENPENCIL_PACKAGE_ROOT?.trim()')
    expect(packageRoot).toContain('export const usingPreparedPublishDirectories')
    expect(packageSmoke).toContain(
      "const privateDependencyDirs = usingPreparedPublishDirectories ? [] : ['packages/compiler']"
    )
    expect(packageSmoke).toContain('OPENPENCIL_PACKAGE_TARBALL_ROOT')
    expect(packageSmoke).toContain('resolveExactReleaseTarballs')
    expect(packageSmoke).toContain('if (!usingPreparedPublishDirectories) {')
    expect(packageSmoke).toContain('publicPackagePath(packageDir)')
    expect(packageSmoke).toMatch(
      /bunEval\(`await import\(\$\{JSON\.stringify\(specifier\)\}\)`, tempDir\)/
    )
    expect(packageSmoke).toContain('function buildFrameworkConsumers(cwd: string): void')
    expect(packageSmoke).toContain("import react from '@vitejs/plugin-react'")
    expect(packageSmoke).toContain("import vue from '@vitejs/plugin-vue'")
    expect(packageSmoke).toContain('buildFrameworkConsumers(tempDir)')
    expect(packageSmoke).toContain('function buildPackedCLIConsumers(cwd: string): void')
    expect(packageSmoke).toContain("for (const target of ['react', 'vue'] as const)")
    expect(packageSmoke).toContain("'node_modules/.bin/openpencil'")
    expect(packageSmoke).toContain("'build'")
    expect(packageSmoke).toContain("'--package-name'")
    expect(packageSmoke).toContain('buildPackedCLIConsumers(tempDir)')
    expect(packageSmoke).toContain('Packed CLI build wrote its compiler VFS root')
    expect(packageSmoke).toContain('Packed CLI build leaked compiler roots')
    expect(packageSmoke).toContain("'.openpencil-build-output.json'")
  })

  test('limits bootstrap token and OIDC to publishing and fails closed on registry errors', () => {
    const workflow = readFileSync(WORKFLOW_PATH, 'utf8')
    const publish = job(workflow, 'publish-npm')
    const publishStepIndex = publish.indexOf('name: Publish packages to npm')

    expect(workflow.match(/\$\{\{ secrets\.NPM_TOKEN \}\}/g)).toHaveLength(1)
    expect(publish.slice(0, publishStepIndex)).not.toContain('secrets.NPM_TOKEN')
    expect(publish).toMatch(/NPM_BOOTSTRAP_TOKEN: \$\{\{ secrets\.NPM_TOKEN \}\}/)
    expect(publish).toContain('export NODE_AUTH_TOKEN="$NPM_BOOTSTRAP_TOKEN"')
    expect(publish).toContain('npm whoami --registry "$NPM_REGISTRY" >/dev/null')
    expect(publish).toContain('Using npm Trusted Publishing (OIDC)')
    expect(publish).toContain('elif [[ "$output" == *"E404"* ]]')
    expect(publish).toContain('npm registry lookup failed')
    expect(publish).toContain('differs from the audited tarball')
    expect(publish).toMatch(
      /npm publish "\.\/\$\{tarball\}" --access public --provenance --tag latest --registry "\$NPM_REGISTRY"/
    )
    expect(publish).not.toMatch(
      /(?:echo|printf)[^\n]*\$(?:\{)?(?:NPM_BOOTSTRAP_TOKEN|NODE_AUTH_TOKEN)/
    )
  })

  test('fails closed before authentication when npm is too old for Trusted Publishing', () => {
    const workflow = readFileSync(WORKFLOW_PATH, 'utf8')
    const publish = job(workflow, 'publish-npm')
    const setupNodeIndex = publish.indexOf(`uses: ${SETUP_NODE_ACTION}`)
    const versionGateIndex = publish.indexOf('name: Verify npm Trusted Publishing support')
    const publishStepIndex = publish.indexOf('name: Publish packages to npm')

    expect(setupNodeIndex).toBeGreaterThan(-1)
    expect(setupNodeIndex).toBeLessThan(versionGateIndex)
    expect(versionGateIndex).toBeLessThan(publishStepIndex)
    expect(publish).toContain('npm_version=$(npm --version)')
    expect(publish).toContain('NPM_VERSION="$npm_version" node')
    expect(publish).toContain('const match = /^(\\d+)\\.(\\d+)\\.(\\d+)$/.exec(raw)')
    expect(publish).toContain('Trusted Publishing requires npm >=11.5.1')
    expect(publish.slice(versionGateIndex, publishStepIndex)).not.toContain('secrets.NPM_TOKEN')

    const gate = namedRunBlock(workflow, 'Verify npm Trusted Publishing support')
    const runGate = (version: string) =>
      spawnSync('bash', ['-c', `npm() { printf '%s\\n' "$FAKE_NPM_VERSION"; }\n${gate}`], {
        encoding: 'utf8',
        env: { ...process.env, FAKE_NPM_VERSION: version }
      })
    expect(runGate('11.5.1').status).toBe(0)
    expect(runGate('11.6.0').status).toBe(0)
    expect(runGate('12.0.0').status).toBe(0)
    expect(runGate('11.5.0').status).not.toBe(0)
    expect(runGate('10.99.99').status).not.toBe(0)
    expect(runGate('11.5.1-beta.0').status).not.toBe(0)
  })

  test('pins release toolchains and scopes release authority to the jobs and platforms that need it', () => {
    const workflow = readFileSync(WORKFLOW_PATH, 'utf8')
    const build = job(workflow, 'build', 'prepare-npm')
    const prepare = job(workflow, 'prepare-npm', 'publish-npm')
    const publish = job(workflow, 'publish-npm')
    const release = namedStep(
      build,
      'Build signed Tauri release',
      'Verify signed macOS CodePen sidecar'
    )
    const setupBunAction = readFileSync(SETUP_BUN_ACTION_PATH, 'utf8')
    const dollar = '$'

    expect(workflow).toContain('permissions:\n  contents: read\n\njobs:')
    expect(build).toContain('permissions:\n      contents: write')
    expect(prepare).toContain('permissions:\n      contents: read')
    expect(publish).toContain('permissions:\n      contents: read\n      id-token: write')
    expect(workflow.match(new RegExp(CHECKOUT_ACTION, 'g'))).toHaveLength(2)
    expect(workflow.match(new RegExp(SETUP_NODE_ACTION, 'g'))).toHaveLength(2)
    expect(workflow).not.toContain('actions/checkout@v7')
    expect(workflow).not.toContain('actions/setup-node@v7')
    expect(workflow.match(/node-version: 24\.19\.0/g)).toHaveLength(2)
    expect(workflow.match(/test "\$\(node --version\)" = "v24\.19\.0"/g)).toHaveLength(2)

    expect(build.match(/appleSigning: true/g)).toHaveLength(2)
    expect(build.match(/appleSigning: false/g)).toHaveLength(3)
    for (const secret of [
      'APPLE_CERTIFICATE',
      'APPLE_CERTIFICATE_PASSWORD',
      'APPLE_ID',
      'APPLE_PASSWORD',
      'APPLE_TEAM_ID'
    ]) {
      expect(release).toContain(`${secret}: \${{ matrix.appleSigning && secrets.${secret} || '' }}`)
    }

    expect(build).toContain(
      'run: bun test tests/engine/marketplace && bun --filter @open-pencil/marketplace build'
    )
    expect(setupBunAction.match(/bun-version: 1\.3\.10/g)).toHaveLength(2)
    expect(setupBunAction).toContain('run: test "$(bun --version)" = "1.3.10"')
    expect(setupBunAction).toContain(
      `key: bun-1.3.10-${dollar}{{ runner.os }}-${dollar}{{ runner.arch }}-`
    )
  })
})
