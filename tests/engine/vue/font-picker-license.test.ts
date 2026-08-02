import { describe, expect, test } from 'bun:test'

import { nextTick, ref } from 'vue'

import { useFontPicker } from '@open-pencil/vue'

describe('font picker license display', () => {
  test('normalizes unknown licenses and filters every display status', async () => {
    const modelValue = ref('Open Font')
    const picker = useFontPicker({
      modelValue,
      listFamilies: async () => [
        {
          family: 'Open Font',
          source: 'bundled',
          licenseDisplay: {
            status: 'free',
            scope: 'catalog_source',
            evidence: 'reviewed_bundled_manifest',
            licenseIds: ['OFL-1.1'],
            hasConditions: true
          }
        },
        {
          family: 'Declared Open Font',
          source: 'local',
          licenseDisplay: {
            status: 'declared_open',
            scope: 'loaded_faces',
            evidence: 'embedded_name_table',
            licenseIds: ['OFL-1.1'],
            hasConditions: true
          }
        },
        {
          family: 'Commercial Font',
          source: 'local',
          licenseDisplay: {
            status: 'requires_license',
            scope: 'catalog_source',
            evidence: 'explicit_restriction',
            restriction: 'commercial'
          }
        },
        'Unverified Font'
      ]
    })

    picker.open.value = true
    await nextTick()
    await nextTick()

    expect(picker.families.value.map((option) => option.licenseDisplay?.status)).toEqual([
      'free',
      'declared_open',
      'requires_license',
      'unknown'
    ])

    picker.setLicenseFilter('free')
    expect(picker.filtered.value.map((option) => option.family)).toEqual(['Open Font'])

    picker.setLicenseFilter('requires_license')
    expect(picker.filtered.value.map((option) => option.family)).toEqual(['Commercial Font'])

    picker.setLicenseFilter('declared_open')
    expect(picker.filtered.value.map((option) => option.family)).toEqual(['Declared Open Font'])

    picker.setLicenseFilter('unknown')
    expect(picker.filtered.value.map((option) => option.family)).toEqual(['Unverified Font'])

    picker.searchTerm.value = 'missing'
    expect(picker.filtered.value).toEqual([])

    picker.setLicenseFilter('all')
    picker.searchTerm.value = 'font'
    expect(picker.filtered.value.map((option) => option.family)).toEqual([
      'Open Font',
      'Declared Open Font',
      'Commercial Font',
      'Unverified Font'
    ])
  })
})
