import { describe, expect, test } from 'bun:test'

import { translateMiniProgramStyle } from '#compiler/adapters/miniprogram-shared'

describe('Mini Program shared style translation', () => {
  test('rejects CSS and SFC breakout syntax while preserving reviewed declarations', () => {
    const result = translateMiniProgramStyle('', {
      kind: 'styleAttr',
      declarations: {
        color: '#123456',
        fontSize: '16px',
        fontFamily: 'Inter</style><script>secret</script>',
        backgroundColor: 'red; position: fixed',
        letterSpacing: String.raw`u\72 l(\68 ttps://evil.invalid/font)`,
        lineHeight: 'x'.repeat(1025)
      }
    })

    expect(result.declarations).toEqual({ color: '#123456', 'font-size': '16px' })
    expect(result.unsupportedUtilities).toEqual([
      'style:fontFamily',
      'style:backgroundColor',
      'style:letterSpacing',
      'style:lineHeight'
    ])
  })
})
