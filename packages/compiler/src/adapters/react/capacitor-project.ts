import {
  appendReactProjectGitignore,
  configureReactViteRelativeBase,
  patchReactCompilerPackageJson,
  rewriteReactProjectForHashRouting,
  safeReverseDomainAppId,
  type ReactCompilerProjectFiles
} from './source-project'

export const CAPACITOR_VERSION = '^8.0.0'

export function buildCapacitorReactProjectFiles(
  compiledFiles: ReactCompilerProjectFiles,
  packageName: string,
  productName: string
): Map<string, string | Uint8Array> {
  const files = patchReactCompilerPackageJson(compiledFiles, {
    description: `Capacitor project exported from ${productName} in OpenPencil`,
    scripts: {
      'cap:sync': 'npx cap sync',
      'cap:android': 'npx cap open android',
      'cap:ios': 'npx cap open ios'
    },
    dependencies: {
      '@capacitor/android': CAPACITOR_VERSION,
      '@capacitor/core': CAPACITOR_VERSION,
      '@capacitor/ios': CAPACITOR_VERSION
    },
    devDependencies: { '@capacitor/cli': CAPACITOR_VERSION }
  })
  rewriteReactProjectForHashRouting(files)
  configureReactViteRelativeBase(files)
  files.set(
    'capacitor.config.ts',
    `import type { CapacitorConfig } from '@capacitor/cli'\n\nconst config: CapacitorConfig = {\n  appId: ${JSON.stringify(safeReverseDomainAppId(packageName))},\n  appName: ${JSON.stringify(productName)},\n  webDir: 'dist',\n  server: { androidScheme: 'https' }\n}\n\nexport default config\n`
  )
  files.set(
    'README.md',
    `# ${productName}\n\nThis source-only Capacitor 8 + React project was exported from OpenPencil. Multi-page navigation uses a hash router so routes remain inside the native WebView origin.\n\n## Prepare native projects\n\n\`\`\`sh\nnpm install\nnpm run build\nnpx cap add android\nnpx cap add ios\nnpm run cap:sync\n\`\`\`\n\nOpenPencil did not install dependencies, generate Android/iOS projects, invoke Gradle or Xcode, or run native tooling. Review platform permissions before shipping.\n`
  )
  appendReactProjectGitignore(files, ['.capacitor'])
  return files
}
