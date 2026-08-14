import { describe, expect, test } from 'bun:test'

import { strToU8, zipSync } from 'fflate'

import {
  CODEPEN_EXPORT_ZIP_LIMITS,
  createCodePenStaticEvidenceFromExportZip
} from '@/app/codepen/export-zip'

const PEN_URL = 'https://codepen.io/jakebogan01/pen/pvNWZWr'

function archive(
  entries: Record<string, string | Uint8Array>,
  prefix = 'codepen-export/'
): Uint8Array {
  return zipSync(
    Object.fromEntries(
      Object.entries(entries).map(([name, value]) => [
        `${prefix}${name}`,
        typeof value === 'string' ? strToU8(value) : value
      ])
    ),
    { level: 6 }
  )
}

function validArchive(sourceSet: 'src' | 'dist' = 'src'): Uint8Array {
  return archive({
    [`${sourceSet}/index.html`]: '<main class="card">Safe text</main>',
    [`${sourceSet}/style.css`]: '.card { color: red }',
    [`${sourceSet}/script.js`]: 'document.querySelector(".card")',
    'LICENSE.txt': 'MIT License\n'
  })
}

function patchFirstCentralEntry(
  bytes: Uint8Array,
  patch: (view: DataView, offset: number) => void
): Uint8Array {
  const copy = bytes.slice()
  const view = new DataView(copy.buffer, copy.byteOffset, copy.byteLength)
  for (let offset = 0; offset <= copy.byteLength - 46; offset++) {
    if (view.getUint32(offset, true) !== 0x02014b50) continue
    patch(view, offset)
    return copy
  }
  throw new Error('central entry missing')
}

describe('CodePen Export ZIP evidence', () => {
  test('creates immutable static evidence from the bounded src files', async () => {
    const result = await createCodePenStaticEvidenceFromExportZip(validArchive(), PEN_URL)
    expect(result.sourceSet).toBe('src')
    expect(result.licenseText).toBe('MIT License\n')
    expect(result.archive.entryCount).toBe(4)
    expect(result.evidence.payload.sources.html.text).toContain('Safe text')
    expect(result.evidence.payload.sources.js.text).toContain('querySelector')
    expect(result.evidence.payload.summary.safeToExecute).toBe(false)
    expect(result.evidence.payload.policy.sourceInstructions).toBe('non-authoritative')
    expect(Object.isFrozen(result)).toBe(true)
  })

  test('falls back to processed dist files when a complete src set is absent', async () => {
    const result = await createCodePenStaticEvidenceFromExportZip(validArchive('dist'), PEN_URL)
    expect(result.sourceSet).toBe('dist')
  })

  test('rejects traversal, case-colliding paths, and multiple candidate roots', async () => {
    const traversal = archive(
      {
        'src/index.html': '',
        'src/style.css': '',
        'src/script.js': '',
        '../outside.txt': 'no'
      },
      ''
    )
    await expect(createCodePenStaticEvidenceFromExportZip(traversal, PEN_URL)).rejects.toThrow(
      'unsafe entry path'
    )

    const collision = archive(
      {
        'src/index.html': '',
        'src/style.css': '',
        'src/script.js': '',
        'SRC/INDEX.HTML': ''
      },
      ''
    )
    await expect(createCodePenStaticEvidenceFromExportZip(collision, PEN_URL)).rejects.toThrow(
      'duplicate entry paths'
    )

    const ambiguous = archive({
      'src/index.html': '',
      'src/style.css': '',
      'src/script.js': '',
      'nested/src/index.html': ''
    })
    await expect(createCodePenStaticEvidenceFromExportZip(ambiguous, PEN_URL)).rejects.toThrow(
      'multiple src/index.html candidates'
    )
  })

  test('rejects oversized expanded entries before decompression', async () => {
    const oversized = validArchive()
    const patched = patchFirstCentralEntry(oversized, (view, offset) => {
      view.setUint32(offset + 24, CODEPEN_EXPORT_ZIP_LIMITS.maxEntryBytes + 1, true)
    })
    await expect(createCodePenStaticEvidenceFromExportZip(patched, PEN_URL)).rejects.toThrow(
      'entry size limit'
    )
  })

  test('rejects encrypted and symbolic-link entries from central metadata', async () => {
    const encrypted = patchFirstCentralEntry(validArchive(), (view, offset) => {
      view.setUint16(offset + 8, view.getUint16(offset + 8, true) | 1, true)
    })
    await expect(createCodePenStaticEvidenceFromExportZip(encrypted, PEN_URL)).rejects.toThrow(
      'Encrypted'
    )

    const symlink = patchFirstCentralEntry(validArchive(), (view, offset) => {
      view.setUint8(offset + 5, 3)
      view.setUint32(offset + 38, 0o120777 << 16, true)
    })
    await expect(createCodePenStaticEvidenceFromExportZip(symlink, PEN_URL)).rejects.toThrow(
      'symbolic links'
    )
  })

  test('requires a complete known HTML/CSS/JS source set', async () => {
    const incomplete = archive({
      'src/index.html': '<main></main>',
      'src/style.scss': '$color: red;',
      'src/script.js': ''
    })
    await expect(createCodePenStaticEvidenceFromExportZip(incomplete, PEN_URL)).rejects.toThrow(
      'must contain src/index.html'
    )
  })
})
