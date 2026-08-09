import {
  appendReactProjectGitignore,
  configureReactViteRelativeBase,
  patchReactCompilerPackageJson,
  rewriteReactProjectForHashRouting,
  type ReactCompilerProjectFiles
} from './source-project'

export const ELECTRON_VERSION = '^43.2.0'

const ELECTRON_NAVIGATION_SOURCE = `function comparableLocalFileUrl(value) {
  try {
    const url = value instanceof URL ? new URL(value.href) : new URL(value)
    if (
      url.protocol !== 'file:' ||
      url.username !== '' ||
      url.password !== '' ||
      url.host !== ''
    ) {
      return null
    }
    url.hash = ''
    return url.href
  } catch {
    return null
  }
}

function isLocalEntryNavigation(value, entryUrl) {
  const target = comparableLocalFileUrl(value)
  const entry = comparableLocalFileUrl(entryUrl)
  return target !== null && entry !== null && target === entry
}

module.exports = { isLocalEntryNavigation }
`

export function buildElectronReactProjectFiles(
  compiledFiles: ReactCompilerProjectFiles,
  productName: string
): Map<string, string | Uint8Array> {
  const files = patchReactCompilerPackageJson(compiledFiles, {
    description: `Electron project exported from ${productName} in OpenPencil`,
    main: 'electron/main.cjs',
    scripts: {
      'electron:start': 'electron .',
      'electron:dev': 'npm run build && electron .'
    },
    devDependencies: { electron: ELECTRON_VERSION }
  })
  rewriteReactProjectForHashRouting(files)
  configureReactViteRelativeBase(files)
  files.set('electron/navigation.cjs', ELECTRON_NAVIGATION_SOURCE)
  files.set(
    'electron/main.cjs',
    `const { app, BrowserWindow, shell } = require('electron')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { isLocalEntryNavigation } = require('./navigation.cjs')

function openExternalUrl(value) {
  try {
    const url = new URL(value)
    if (url.protocol === 'https:' || url.protocol === 'http:') void shell.openExternal(url.href)
  } catch {
    // Ignore malformed renderer-owned URLs.
  }
}

function createWindow() {
  const entryPath = path.join(__dirname, '..', 'dist', 'index.html')
  const entryUrl = pathToFileURL(entryPath)
  const window = new BrowserWindow({
    title: ${JSON.stringify(productName)},
    width: 1280,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, value) => {
    if (isLocalEntryNavigation(value, entryUrl)) return
    event.preventDefault()
    openExternalUrl(value)
  })

  void window.loadFile(entryPath)
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
`
  )
  files.set(
    'README.md',
    `# ${productName}

This source-only Electron 43 + React project was exported from OpenPencil. The renderer keeps context isolation and sandboxing enabled, disables Node integration, and uses hash routing for local-file navigation.

## Run locally

\`\`\`sh
npm install
npm run electron:dev
\`\`\`

OpenPencil did not install dependencies, run Vite, start Electron, package binaries, or invoke native tooling. Add and review a signing/packaging workflow before distribution.
`
  )
  appendReactProjectGitignore(files, ['release'])
  return files
}
