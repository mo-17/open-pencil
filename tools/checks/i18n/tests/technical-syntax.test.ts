import { describe, expect, test } from 'bun:test'

import { isLocaleHomograph } from '../src/homographs'
import { isIdenticalEnglishProse, hasMixedLatinAndCjk } from '../src/quality'
import { changedTechnicalSyntax, isTechnicalMessage, technicalText } from '../src/technical-syntax'

describe('source-declared technical language', () => {
  test('keeps exact product, format and API names without treating surrounding English as translated', () => {
    for (const [source, localized] of [
      ['Supabase default.', 'Supabase 默认设置。'],
      ['Export a Tauri React project', 'Tauri React プロジェクトを書き出す'],
      ['Configure JWT_ISSUER and DATABASE_URL.', '配置 JWT_ISSUER 和 DATABASE_URL。'],
      ['MotionSpec v3 is required.', '需要 MotionSpec v3。'],
      ['The chooser accept filter is a hint.', '文件选择器的 accept 过滤只是提示。'],
      [
        'Hosts with CSP allow nonce/hash or style-src unsafe-inline.',
        '通过 nonce/hash 或 style-src unsafe-inline 配置 CSP。'
      ],
      ['Supabase Management API.', 'Supabase Management API から読み込みます。'],
      ['Row Level Security in Supabase.', 'Supabase 项目的行级安全（RLS）。'],
      ['Respect Do Not Track', '尊重“请勿跟踪”（DNT）'],
      ['Frequency (Hz)', '周波数 (Hz)']
    ]) {
      expect(hasMixedLatinAndCjk(localized, source)).toBe(false)
      expect(hasMixedLatinAndCjk(`Configure ${localized}`, source)).toBe(true)
    }
    expect(hasMixedLatinAndCjk('Supabasex 默认设置。', 'Supabase default.')).toBe(true)
    expect(hasMixedLatinAndCjk('配置 Smart-Match。', 'Configure Smart Match.')).toBe(true)
    expect(hasMixedLatinAndCjk('Supabase 默认设置。', 'Default settings.')).toBe(true)
    expect(hasMixedLatinAndCjk('Save API 密钥。', 'Save API key.')).toBe(true)
    expect(hasMixedLatinAndCjk('普通 English 正文。', 'Ordinary English prose.')).toBe(true)
    expect(hasMixedLatinAndCjk('Motion 设置。', 'Motion settings.')).toBe(true)
    expect(hasMixedLatinAndCjk('成功的 Receipt。', 'A successful Receipt.')).toBe(true)
    expect(isIdenticalEnglishProse('Motion', 'Motion')).toBe(true)
    expect(isIdenticalEnglishProse('Receipt', 'Receipt')).toBe(true)
  })

  test('recognizes exact input syntax, while labels and prose remain subject to translation', () => {
    for (const value of [
      '</> HTML',
      'GIF',
      'WebM',
      'R',
      'X',
      'URL',
      'public',
      'table_name',
      'id, name, email',
      'sb_publishable_...',
      '{"bucket/rule":{"allowedPartition":"tenant-a","deniedPartition":"tenant-b"}}'
    ]) {
      expect(isTechnicalMessage(value)).toBe(true)
      expect(isIdenticalEnglishProse(value, value)).toBe(false)
    }
    for (const value of [
      'Save',
      'Configure',
      'Motion settings',
      'No matching properties',
      'Publish Supabase project',
      'API key is missing',
      'up-to-date',
      'missing-cached-master',
      '{"label":"Save"}',
      '{"label":"Save changes"}'
    ]) {
      expect(isTechnicalMessage(value)).toBe(false)
      expect(isIdenticalEnglishProse(value, value)).toBe(true)
    }
    expect(isTechnicalMessage('add-project-tasks', true)).toBe(true)
    expect(isIdenticalEnglishProse('add-project-tasks', 'add-project-tasks', 'fr', true)).toBe(
      false
    )
    expect(isIdenticalEnglishProse('Save changes', 'Save changes', 'fr', true)).toBe(true)
  })

  test('protects copied API identifiers and complete SQL/JSON input from translation or tampering', () => {
    const examples = [
      [
        'Configure JWT_ISSUER and DATABASE_URL.',
        '配置 JWT_ISSUER 和 DATABASE_URL。',
        '配置 JWT_ISSUER_OTHER 和 DATABASE_URL。'
      ],
      [
        'Exports __opGrantAnalyticsConsent().',
        '导出 __opGrantAnalyticsConsent()。',
        '导出 __wrongConsent()。'
      ],
      [
        'Paste a token with database_write access',
        'Separates Token mit database_write-Berechtigung einfügen',
        '使用 databaseWrite 权限'
      ],
      [
        'Optional — for stock_photo tool',
        'Facultatif — pour l’outil stock_photo',
        'Facultatif — pour l’outil stockPhoto'
      ],
      ['public', 'public', 'publique'],
      [
        '{"allowedPartition":"tenant-a"}',
        '{"allowedPartition":"tenant-a"}',
        '{"allowedPartition":"tenant-b"}'
      ]
    ]
    for (const [source, copied, changed] of examples) {
      expect(changedTechnicalSyntax(source, copied)).toEqual([])
      expect(changedTechnicalSyntax(source, changed).length).toBeGreaterThan(0)
    }
    // Natural status labels and ordinary examples are not immutable code identifiers.
    expect(changedTechnicalSyntax('up-to-date', 'à jour')).toEqual([])
    expect(changedTechnicalSyntax('missing-cached-master', '缺少缓存的主组件')).toEqual([])
    expect(technicalText('Read item.name.', '读取 item.nameExtra。')).toContain('item.nameExtra')
  })

  test('accepts only reviewed exact homographs in their actual language and grammatical form', () => {
    for (const [locale, value] of [
      ['fr', 'Direction'],
      ['fr', 'Source'],
      ['fr', '{count} actions'],
      ['de', 'Name'],
      ['de', 'Text'],
      ['es', 'Color'],
      ['it', 'Schema'],
      ['pl', 'Segment {segment}']
    ]) {
      expect(isIdenticalEnglishProse(value, value, locale)).toBe(false)
      expect(isIdenticalEnglishProse(`${value} settings`, `${value} settings`, locale)).toBe(true)
    }
    expect(isIdenticalEnglishProse('Direction', 'Direction', 'de')).toBe(true)
    expect(isIdenticalEnglishProse('Text', 'Text', 'ru')).toBe(true)
    expect(isIdenticalEnglishProse('Save', 'Save', 'fr')).toBe(true)
    expect(isLocaleHomograph('fr', 'Source', 'source')).toBe(false)
    expect(isIdenticalEnglishProse('Action {name}', 'Action {name}', 'fr')).toBe(true)
    expect(isIdenticalEnglishProse('Action', 'Action')).toBe(true)
  })
})
