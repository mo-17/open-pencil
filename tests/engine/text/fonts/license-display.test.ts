import { describe, expect, test } from 'bun:test'

import {
  BUNDLED_FONT_LICENSE_MANIFEST,
  FontManager,
  assessFontLicenseBytes,
  fontFamilyLicenseDisplayForCatalog,
  fontFamilyLicenseDisplayFromAssessments
} from '@open-pencil/core/text'

import { fontBytesWithFsType } from '#tests/helpers/font-fixtures'

describe('font family license display', () => {
  test('marks only complete reviewed bundled catalog families as free', () => {
    const families = new Set(BUNDLED_FONT_LICENSE_MANIFEST.fonts.map((face) => face.family))

    for (const family of families) {
      expect(fontFamilyLicenseDisplayForCatalog(family, 'bundled')).toEqual({
        status: 'free',
        scope: 'catalog_source',
        evidence: 'reviewed_bundled_manifest',
        licenseIds: ['OFL-1.1'],
        hasConditions: true
      })
    }

    expect(fontFamilyLicenseDisplayForCatalog('Not In The Manifest', 'bundled')).toEqual({
      status: 'unknown',
      scope: 'catalog_source',
      evidence: 'insufficient'
    })
  })

  test('uses official web-provider policies but never infers a local license by family name', () => {
    for (const source of ['google', 'fontsource', 'bunny', 'fontshare'] as const) {
      expect(fontFamilyLicenseDisplayForCatalog('Provider Font', source)).toMatchObject({
        status: 'free',
        scope: 'catalog_source',
        evidence: 'provider_policy',
        provider: source,
        hasConditions: true
      })
    }

    expect(fontFamilyLicenseDisplayForCatalog('Inter', 'local')).toEqual({
      status: 'unknown',
      scope: 'catalog_source',
      evidence: 'insufficient'
    })
  })

  test('aggregates exact reviewed face assessments without downloading fonts', () => {
    expect(
      fontFamilyLicenseDisplayFromAssessments([
        {
          classification: 'verified_open',
          license: { id: 'OFL-1.1', conditions: ['Include the license notice.'] }
        },
        {
          classification: 'verified_open',
          license: { id: 'OFL-1.1', conditions: [] }
        }
      ])
    ).toEqual({
      status: 'free',
      scope: 'loaded_faces',
      evidence: 'reviewed_bundled_manifest',
      licenseIds: ['OFL-1.1'],
      hasConditions: true
    })
  })

  test('lets restrictions win and separates embedded declarations from verified licenses', () => {
    expect(
      fontFamilyLicenseDisplayFromAssessments([
        { classification: 'verified_open', license: { id: 'OFL-1.1' } },
        { classification: 'restricted' }
      ])
    ).toEqual({
      status: 'requires_license',
      scope: 'loaded_faces',
      evidence: 'explicit_restriction',
      restriction: 'general'
    })

    expect(
      fontFamilyLicenseDisplayFromAssessments([
        {
          classification: 'unknown',
          embeddedMetadata: { candidateLicenseId: 'OFL-1.1' }
        }
      ])
    ).toEqual({
      status: 'declared_open',
      scope: 'loaded_faces',
      evidence: 'embedded_name_table',
      licenseIds: ['OFL-1.1'],
      hasConditions: true
    })

    expect(
      fontFamilyLicenseDisplayFromAssessments([
        { classification: 'verified_open', license: { id: 'OFL-1.1' } },
        {
          classification: 'unknown',
          embeddedMetadata: { candidateLicenseId: 'Apache-2.0' }
        }
      ])
    ).toMatchObject({
      status: 'declared_open',
      licenseIds: ['Apache-2.0', 'OFL-1.1']
    })

    expect(
      fontFamilyLicenseDisplayFromAssessments([
        { classification: 'unknown', license: { id: 'OFL-1.1' } }
      ])
    ).toEqual({
      status: 'unknown',
      scope: 'loaded_faces',
      evidence: 'insufficient'
    })
    expect(fontFamilyLicenseDisplayFromAssessments([]).status).toBe('unknown')
  })

  test('maps OS/2 restricted embedding to a paid embedding-license display', async () => {
    const source = await Bun.file('packages/core/assets/Inter-Regular.ttf').arrayBuffer()
    const bytes = fontBytesWithFsType(source, 0x0002)
    const assessment = await assessFontLicenseBytes(
      'OpenPencil Restricted Embedding Fixture',
      'Regular',
      bytes
    )

    expect(assessment).toMatchObject({
      classification: 'restricted',
      embeddedMetadata: {
        fsType: 0x0002,
        embedding: { restricted: true }
      }
    })
    expect(assessment.evidence).toContainEqual(
      expect.objectContaining({ kind: 'embedded_os2', strength: 'self_reported' })
    )
    expect(assessment.reasons.join(' ')).toContain('explicitly restricts embedding')
    expect(fontFamilyLicenseDisplayFromAssessments([assessment])).toEqual({
      status: 'requires_license',
      scope: 'loaded_faces',
      evidence: 'explicit_restriction',
      restriction: 'embedding'
    })
  })

  test('listFamilyOptions fills bundled license display metadata without loading the font', async () => {
    const manager = new FontManager()
    manager.setOnlineFontProviders({})

    expect(manager.isLoaded('Inter')).toBe(false)
    await expect(manager.listFamilyOptions()).resolves.toEqual([
      {
        family: 'Inter',
        source: 'bundled',
        licenseDisplay: {
          status: 'free',
          scope: 'catalog_source',
          evidence: 'reviewed_bundled_manifest',
          licenseIds: ['OFL-1.1'],
          hasConditions: true
        }
      }
    ])
    expect(manager.isLoaded('Inter')).toBe(false)
  })
})
