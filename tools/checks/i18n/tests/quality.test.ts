import { describe, expect, test } from 'bun:test'

import {
  hasMixedLatinAndCjk,
  isIdenticalEnglishProse,
  isNonLinguisticMessageSyntax,
  placeholders,
  visibleTranslationText
} from '../src/quality'

describe('translation quality checks', () => {
  test('extracts and removes interpolation placeholders', () => {
    expect(placeholders('移除图片 {name}，尺寸 {width} × {height}')).toEqual([
      'height',
      'name',
      'width'
    ])
    expect(visibleTranslationText('画像 {name} を削除')).toBe('画像  を削除')
  })

  test('does not treat placeholder identifiers as translated Latin text', () => {
    expect(hasMixedLatinAndCjk('画像 {name} を削除')).toBe(false)
    expect(hasMixedLatinAndCjk('查看附件 {name}')).toBe(false)
  })

  test('still detects visible Latin text mixed with CJK text', () => {
    expect(hasMixedLatinAndCjk('画像 OpenPencil を表示')).toBe(true)
    expect(hasMixedLatinAndCjk('APIキーを更新')).toBe(true)
    expect(hasMixedLatinAndCjk('画像を表示')).toBe(false)
  })

  test('recognizes complete interpolation formats without swallowing prose or malformed braces', () => {
    for (const value of [
      '{phase} {completed}/{total}',
      '{nodes}, {edges}',
      ' · {index}/{total} {kind}',
      '{workflows}, {actions}, {calls}, {entries}',
      '{name}'
    ]) {
      expect(isNonLinguisticMessageSyntax(value)).toBe(true)
    }
    for (const value of [
      'Export {phase} {completed}/{total}',
      '{nodes} nodes, {edges} edges',
      ' · {index}/{total} results',
      '{workflows}, pending {actions}',
      '{{name}}',
      '{bad-name}',
      '{name} 2',
      '',
      'Save',
      'No matching properties',
      'Motion settings',
      'R',
      'Supabase',
      'public',
      'table_name',
      'add-project-tasks',
      '{"label":"Save changes"}'
    ]) {
      expect(isNonLinguisticMessageSyntax(value)).toBe(false)
    }
  })

  test('recognizes complete HTTP(S) URLs without swallowing prose, credentials or templates', () => {
    for (const value of [
      'https://xxx.supabase.co',
      'https://example.com/library.json',
      'http://example.com/a?b=c#d'
    ]) {
      expect(isNonLinguisticMessageSyntax(value)).toBe(true)
    }
    for (const value of [
      'Project https://xxx.supabase.co',
      'https://example.com/library.json ready',
      'file:///tmp/example',
      'https:///',
      'https:///example.com',
      'https://example.com\\path',
      'https://{host}/a',
      'https://user:pass@example.com/a',
      ' https://example.com/a',
      'https://example.com/a '
    ]) {
      expect(isNonLinguisticMessageSyntax(value)).toBe(false)
    }
  })

  test('still requires review for untranslated prose and altered URL spelling', () => {
    expect(isIdenticalEnglishProse('Save', ' Save ')).toBe(true)
    expect(isIdenticalEnglishProse('No matching properties', 'No matching properties')).toBe(true)
    expect(isIdenticalEnglishProse('Motion settings', 'Motion settings')).toBe(true)
    expect(isIdenticalEnglishProse('Supabase', 'Supabase')).toBe(true)
    expect(isIdenticalEnglishProse('https://example.com/a', 'https://example.com/a')).toBe(false)
    expect(isIdenticalEnglishProse('https://example.com/a', ' https://example.com/a ')).toBe(true)
    expect(isIdenticalEnglishProse('{nodes}, {edges}', '{nodes}, {edges}')).toBe(false)
    expect(placeholders('{nodes}, {edges}')).not.toEqual(placeholders('{nodes}, {other}'))
  })

  test('reviews prose separately from exact source-declared code expressions', () => {
    const variables = '$currentUser.signedIn / .email / .id'
    expect(
      hasMixedLatinAndCjk(`登录后引用 ${variables}。`, `After sign-in, read ${variables}.`)
    ).toBe(false)
    expect(
      hasMixedLatinAndCjk(
        '配置 JWT_ISSUER 和 DATABASE_URL。',
        'Configure JWT_ISSUER and DATABASE_URL.'
      )
    ).toBe(true)
    expect(
      hasMixedLatinAndCjk(
        '导出 __opGrantAnalyticsConsent()。',
        'Exports __opGrantAnalyticsConsent().'
      )
    ).toBe(true)
    expect(hasMixedLatinAndCjk('配置 JWT_ISSUER。')).toBe(true)
    expect(hasMixedLatinAndCjk('配置 JWT_ISSUER_OTHER。', 'Configure JWT_ISSUER.')).toBe(true)
    expect(
      hasMixedLatinAndCjk('导出 __wrongConsent()。', 'Exports __opGrantAnalyticsConsent().')
    ).toBe(true)
    expect(hasMixedLatinAndCjk('Configure JWT_ISSUER 配置。', 'Configure JWT_ISSUER.')).toBe(true)
    expect(hasMixedLatinAndCjk('读取 $currentUser.email。', 'Read $other.email.')).toBe(true)
    expect(hasMixedLatinAndCjk('保留 {"label":"Save changes"}。', '{"label":"Save changes"}')).toBe(
      true
    )
    expect(hasMixedLatinAndCjk('Supabase 默认设置。', 'Supabase default.')).toBe(true)
    expect(hasMixedLatinAndCjk('APIキーを更新', 'Update API key')).toBe(true)
    expect(
      hasMixedLatinAndCjk('保留 {"标题":"$currentUser.email"}。', '{"title":"$currentUser.email"}')
    ).toBe(true)
    expect(hasMixedLatinAndCjk('读取 .email。', 'Read .email.')).toBe(true)
    expect(hasMixedLatinAndCjk('读取 $currentUser.emailExtra。', 'Read $currentUser.email.')).toBe(
      true
    )
    expect(
      hasMixedLatinAndCjk(
        'Supabase $currentUser.signedIn 保持 false。',
        'Supabase $currentUser.signedIn stays false.'
      )
    ).toBe(true)
  })

  test('keeps altered or incomplete dollar references subject to review', () => {
    const source = 'Read $currentUser.email.'
    for (const reference of [
      '$currentUser.email9',
      '$currentUser.email_',
      '$currentUser.email.extra',
      '$currentUser.email[0]',
      '$currentUser.email()',
      '$currentUser.email.9',
      '$currentUser.email / .9',
      '$currentUser.email変数',
      '9$currentUser.email'
    ]) {
      expect(hasMixedLatinAndCjk(`读取 ${reference}。`, source)).toBe(true)
    }
    expect(hasMixedLatinAndCjk('读取 $currentUser.email。', source)).toBe(false)
    expect(hasMixedLatinAndCjk('读取 $currentUser.email。', 'Read $currentUser.email[0].')).toBe(
      true
    )
    expect(hasMixedLatinAndCjk('读取 $currentUser.email。', 'Read $currentUser.email / .9.')).toBe(
      true
    )
  })
})
