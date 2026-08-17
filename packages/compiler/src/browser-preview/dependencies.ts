import { failBrowserPreview } from './error'
import { BROWSER_PREVIEW_LIMITS } from './limits'
import { isSafeBrowserPackageSpecifier } from './source-security'
import type { BrowserPreviewDiagnostic } from './types'

interface DependencyPin {
  version: string
  declarations: readonly string[]
}

const PIN = (version: string, ...declarations: string[]): DependencyPin =>
  Object.freeze({ version, declarations: Object.freeze(declarations) })

const SHARED_PINS: Readonly<Partial<Record<string, DependencyPin>>> = Object.freeze({
  'react-router-dom': PIN('6.27.0', '^6.27.0'),
  'react-intl': PIN('7.1.0', '^7.1.0'),
  zustand: PIN('5.0.0', '^5.0.0'),
  clsx: PIN('2.1.1', '^2.1.1'),
  'tailwind-merge': PIN('2.5.5', '^2.5.5'),
  'class-variance-authority': PIN('0.7.1', '^0.7.1'),
  '@radix-ui/react-slot': PIN('1.1.1', '^1.1.1'),
  '@radix-ui/react-label': PIN('2.1.1', '^2.1.1'),
  '@radix-ui/react-checkbox': PIN('1.1.3', '^1.1.3'),
  '@radix-ui/react-switch': PIN('1.1.2', '^1.1.2'),
  '@radix-ui/react-radio-group': PIN('1.2.2', '^1.2.2'),
  '@radix-ui/react-select': PIN('2.1.4', '^2.1.4'),
  '@radix-ui/react-avatar': PIN('1.2.0', '^1.2.0'),
  '@radix-ui/react-progress': PIN('1.1.10', '^1.1.10'),
  '@radix-ui/react-separator': PIN('1.1.10', '^1.1.10'),
  '@radix-ui/react-tabs': PIN('1.1.12', '^1.1.12'),
  '@radix-ui/react-accordion': PIN('1.2.11', '^1.2.11'),
  'lucide-react': PIN('1.21.0', '^1.21.0'),
  'react-markdown': PIN('10.1.0', '10.1.0'),
  'remark-gfm': PIN('4.0.1', '4.0.1'),
  'lottie-web': PIN('5.13.0', '5.13.0'),
  'maplibre-gl': PIN('6.0.0', '6.0.0'),
  jsbarcode: PIN('3.12.3', '3.12.3'),
  qrcode: PIN('1.5.4', '1.5.4')
})

const REACT_19 = Object.freeze({
  react: PIN('19.2.0', '^19.2.0'),
  'react-dom': PIN('19.2.0', '^19.2.0')
})
const REACT_18 = Object.freeze({
  react: PIN('18.3.1', '^18.3.1'),
  'react-dom': PIN('18.3.1', '^18.3.1')
})

export interface BrowserPreviewDependencyPolicy {
  declared: Readonly<Record<string, string>>
  pins: Readonly<Partial<Record<string, DependencyPin>>>
  reactVersion: '18.3.1' | '19.2.0'
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function basePackage(specifier: string): string {
  const segments = specifier.split('/')
  return specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0]
}

export function readBrowserPreviewDependencyPolicy(
  files: ReadonlyMap<string, string | Uint8Array>
): BrowserPreviewDependencyPolicy {
  const manifest = files.get('package.json')
  if (typeof manifest !== 'string') {
    failBrowserPreview(
      'browser-preview-package-manifest-missing',
      'Browser preview requires the compiler-generated package manifest.',
      'package.json'
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(manifest)
  } catch {
    failBrowserPreview(
      'browser-preview-package-manifest-invalid',
      'Browser preview package manifest is not valid JSON.',
      'package.json'
    )
  }
  if (!record(parsed) || !record(parsed.dependencies)) {
    failBrowserPreview(
      'browser-preview-package-manifest-invalid',
      'Browser preview package manifest must contain a dependencies record.',
      'package.json'
    )
  }
  const declared: Record<string, string> = Object.create(null) as Record<string, string>
  for (const [name, declaration] of Object.entries(parsed.dependencies)) {
    if (
      !isSafeBrowserPackageSpecifier(name) ||
      typeof declaration !== 'string' ||
      name === '__proto__' ||
      name === 'constructor' ||
      name === 'prototype'
    ) {
      failBrowserPreview(
        'browser-preview-dependency-invalid',
        'Browser preview blocked an invalid generated dependency declaration.',
        'package.json'
      )
    }
    declared[name] = declaration
  }
  const entries = Object.keys(declared)
  if (entries.length === 0 || entries.length > BROWSER_PREVIEW_LIMITS.maxDependencies) {
    failBrowserPreview(
      'browser-preview-dependency-limit',
      'Browser preview dependency count is outside the supported limit.',
      'package.json'
    )
  }
  const reactDeclaration = declared.react
  const reactVersion = reactDeclaration === '^18.3.1' ? '18.3.1' : '19.2.0'
  const pins: Readonly<Partial<Record<string, DependencyPin>>> = Object.freeze({
    ...SHARED_PINS,
    ...(reactVersion === '18.3.1' ? REACT_18 : REACT_19)
  })
  for (const name of entries) {
    const pin = pins[name]
    if (!pin || !pin.declarations.includes(declared[name])) {
      failBrowserPreview(
        'browser-preview-dependency-unsupported',
        `Browser preview blocked the unapproved dependency ${name}.`,
        'package.json'
      )
    }
  }
  return Object.freeze({ declared: Object.freeze(declared), pins, reactVersion })
}

function peerQuery(base: string, reactVersion: string): string {
  if (base === 'react') return ''
  const dependencies =
    base === 'react-dom'
      ? `react@${reactVersion}`
      : `react@${reactVersion},react-dom@${reactVersion}`
  return `?deps=${encodeURIComponent(dependencies)}`
}

export function browserPreviewExternalURL(
  policy: BrowserPreviewDependencyPolicy,
  specifier: string
): string {
  if (!isSafeBrowserPackageSpecifier(specifier)) {
    failBrowserPreview(
      'browser-preview-import-invalid',
      'Browser preview blocked an unsafe package import specifier.'
    )
  }
  const base = basePackage(specifier)
  const pin = policy.pins[base]
  if (!pin || !pin.declarations.includes(policy.declared[base] ?? '')) {
    failBrowserPreview(
      'browser-preview-dependency-unsupported',
      `Browser preview blocked the unapproved dependency import ${specifier}.`,
      specifier
    )
  }
  const subpath = specifier === base ? '' : specifier.slice(base.length)
  if (base === 'maplibre-gl') {
    failBrowserPreview(
      'browser-preview-map-runtime-unsupported',
      'Map preview is unsupported in the browser sandbox because MapLibre requires remote styles, workers, and tile networking.',
      specifier
    )
  }
  return `https://esm.sh/${base}@${pin.version}${subpath}${peerQuery(base, policy.reactVersion)}`
}

export function buildBrowserPreviewImportMap(
  policy: BrowserPreviewDependencyPolicy,
  specifiers: ReadonlySet<string>
): { imports: Readonly<Record<string, string>>; diagnostics: BrowserPreviewDiagnostic[] } {
  if (specifiers.size > BROWSER_PREVIEW_LIMITS.maxDependencies * 4) {
    failBrowserPreview(
      'browser-preview-import-limit',
      'Browser preview generated package import count exceeds the supported limit.'
    )
  }
  const imports: Record<string, string> = Object.create(null) as Record<string, string>
  const diagnostics: BrowserPreviewDiagnostic[] = []
  for (const specifier of [...specifiers].sort()) {
    if (specifier.endsWith('.css')) {
      failBrowserPreview(
        'browser-preview-external-stylesheet-unsupported',
        'Browser preview does not load package-owned remote stylesheets.',
        specifier
      )
    }
    const url = browserPreviewExternalURL(policy, specifier)
    imports[specifier] = url
  }
  return { imports: Object.freeze(imports), diagnostics }
}
