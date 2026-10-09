import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { BUILTIN_PLUGIN_REGISTRY } from '#core/plugins/builtin'
import {
  EFFECT_PICK_CATALOG,
  EFFECT_PICK_MODULE_TYPE,
  EFFECT_PICK_PLUGIN_ID,
  buildEffectPickMarkup,
  createEffectPickConfig,
  createEffectPickModuleInstance,
  findEffectPickArtifact,
  getEffectPickCatalogEntry,
  parseEffectPickConfig,
  requireEffectPickConfig,
  resolveEffectPickModule
} from '#core/plugins/effect-pick'

const LEGACY_IDENTITIES: readonly (readonly [string, string])[] = [
  ['diagonal-fill', '6dfdbdf04cf2c573aa6e392875709c7e86609334efa324b34463215b974f0913'],
  ['animated-gradient', '71782faf7f7476e2c6655f61d7ce87f7470b7a9ec01baef738ef7bc0cde323bb'],
  ['blur-focus', '2ad7de4d012124bed937252a130a209b0aaa72303cf819f74eab8efe5241e0d9'],
  ['character-wave', '3d882e6d1f1aa311ab28250b0a0900d5b50059a40912d78a84586272a3571fa8'],
  ['chasing-squares', '1a30ad520d150ef660dc2cd0aee7a70354640a887ee0f37a0d762f8375b35e74'],
  ['cube-fold-loader', '609a6a7428940d87c1570004c07d9418bc2b52481cecd2d89627170de2b17cb3'],
  ['neon-sign', '020c60218c4b677db581385968fe6d3990783cdb6b251f06ceecb71aae1281db'],
  ['striped-text', '3443219f12c41cf4bc30afa67ae72b5622dbad77fb2b26e99d9fe5a234c83d6c'],
  ['text-shine', '5693e07c72f6ce99fc501ef0f826e63fd199d012ae440ea4951d02596cfe456e'],
  ['water-text', 'c1cd9d80fac12e527eb068b3f9d82c3c4cfb206c4d4cbe7eb14875ad46d261d9'],
  ['orbit-eclipse', '74a0ff2b87e99b922b659b47399dec04dc2af49a891192ddb56dfc61b1f4d7d7'],
  ['hourglass-sand', '5dcd51e05d24da6788c17df96d68a0550d10ce2b0351a2fb9eac141edced6a54']
]

const ADDED_EFFECT_IDS = [
  'arrow-expand',
  'border-trace',
  'gradient-button',
  'underline-slide',
  'aurora-curtains',
  'gradient-mesh',
  'hex-grid-pulse',
  'perspective-grid-floor',
  'text-mask-reveal',
  'outline-fill',
  'gradient-stroke-text',
  'text-zoom-trail',
  'tilt-card',
  'glare-card',
  'exploded-layer-card',
  'gatefold-reveal-card',
  'gooey-dots',
  'infinity-runner',
  'newtons-cradle',
  'equalizer-bars'
] as const

describe('reviewed EffectPick catalog', () => {
  test('creates unpainted outer frames for the default and every selected catalog effect', () => {
    const definition = BUILTIN_PLUGIN_REGISTRY.getModule(
      EFFECT_PICK_PLUGIN_ID,
      EFFECT_PICK_MODULE_TYPE
    )
    if (!definition) throw new Error('Missing EffectPick module definition')
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const configs = [undefined, ...EFFECT_PICK_CATALOG.map((entry) => entry.defaultConfig)]
    for (const config of configs) {
      const frame = definition.createFrameOverrides(config)
      const node = graph.createNode('FRAME', page.id, frame)
      expect(node.fills).toEqual([])
      expect(node.strokes).toEqual([])
      const resolved = resolveEffectPickModule(node.interactiveProps?.module)
      expect(resolved?.ok).toBe(true)
      if (!resolved?.ok) throw new Error('Expected a reviewed effect configuration')
      expect(resolved.config).toEqual(config ?? createEffectPickConfig())
    }
  })

  test('preserves the twelve previously reviewed identities without migrating their collection or digest', () => {
    expect(
      EFFECT_PICK_CATALOG.filter((entry) => entry.collectionVersion === '0.6.0').map(
        (entry): readonly [string, string] => [entry.id, entry.artifactDigest]
      )
    ).toEqual([...LEGACY_IDENTITIES])
    for (const [id, artifactDigest] of LEGACY_IDENTITIES) {
      const config = createEffectPickConfig(id)
      expect(config).toMatchObject({ effectId: id, collectionVersion: '0.6.0', artifactDigest })
      expect(requireEffectPickConfig(config)).toEqual(config)
    }
  })

  test('registers one module with thirty-two distinct immutable local artifacts and honest provenance', () => {
    expect(
      BUILTIN_PLUGIN_REGISTRY.getModule(EFFECT_PICK_PLUGIN_ID, EFFECT_PICK_MODULE_TYPE)
    ).toBeDefined()
    expect(EFFECT_PICK_CATALOG).toHaveLength(32)
    expect(new Set(EFFECT_PICK_CATALOG.map((entry) => entry.id)).size).toBe(32)
    expect(
      EFFECT_PICK_CATALOG.filter((entry) => entry.collectionVersion === '0.7.0')
        .map((entry) => entry.id)
        .sort()
    ).toEqual([...ADDED_EFFECT_IDS].sort())
    expect(Object.isFrozen(EFFECT_PICK_CATALOG)).toBe(true)
    for (const entry of EFFECT_PICK_CATALOG) {
      expect(Object.isFrozen(entry)).toBe(true)
      for (const value of [
        entry.artifact,
        entry.defaultConfig,
        entry.defaultSize,
        entry.tags,
        entry.source,
        entry.sourceSha256,
        entry.events,
        entry.editableFields
      ])
        expect(Object.isFrozen(value)).toBe(true)
      expect(entry.source.license).toBe('UNLICENSED')
      expect(entry.source.licenseStatus).toBe('not-reviewed')
      expect(entry.source.mode).toBe('reference')
      expect(entry.source.url).toStartWith('https://codepen.io/')
      for (const digest of Object.values(entry.sourceSha256))
        expect(digest).toMatch(/^[a-f0-9]{64}$/)
      expect(Number.isFinite(entry.defaultSize.width)).toBe(true)
      expect(Number.isFinite(entry.defaultSize.height)).toBe(true)
      expect(entry.defaultSize.width).toBeGreaterThan(0)
      expect(entry.defaultSize.height).toBeGreaterThan(0)
      expect(Number.isFinite(entry.artifact.durationMs)).toBe(true)
      expect(entry.artifact.durationMs).toBeGreaterThan(0)
      expect(['button', 'text', 'characters', 'gradient', 'water', 'loader', 'card']).toContain(
        entry.artifact.behavior
      )
      expect(new Set(entry.editableFields).size).toBe(entry.editableFields.length)
      for (const field of entry.editableFields)
        expect(['text', 'color', 'secondaryColor', 'speed']).toContain(field)
      for (const event of entry.events) expect(event).toBe('click')
      const instance = createEffectPickModuleInstance({ effectId: entry.id })
      expect(instance.configVersion).toBe(1)
      expect(instance.config).toEqual(entry.defaultConfig)
      const resolved = resolveEffectPickModule(instance)
      if (!resolved?.ok) throw new Error(`Unresolvable default config for ${entry.id}`)
      expect(resolved.config).toEqual(entry.defaultConfig)
      expect(resolved.config).toMatchObject({
        effectId: entry.id,
        collectionVersion: entry.collectionVersion,
        artifactDigest: entry.artifactDigest
      })
    }
    expect(
      EFFECT_PICK_CATALOG.filter((entry) => entry.events.includes('click')).map((entry) => entry.id)
    ).toEqual([
      'diagonal-fill',
      'arrow-expand',
      'border-trace',
      'gradient-button',
      'underline-slide'
    ])
    expect(getEffectPickCatalogEntry('water-text')?.editableFields).not.toContain('secondaryColor')
    for (const id of ['chasing-squares', 'cube-fold-loader', 'orbit-eclipse', 'hourglass-sand']) {
      expect(getEffectPickCatalogEntry(id)?.editableFields).toEqual([
        'color',
        'secondaryColor',
        'speed'
      ])
    }
  })

  test('pins each digest to the complete executable markup/CSS, declared events, and runtime revision', () => {
    for (const entry of EFFECT_PICK_CATALOG) {
      const artifactPayload = JSON.stringify({
        schemaVersion: 1,
        runtimeRevision: entry.runtimeRevision,
        id: entry.id,
        collectionVersion: entry.collectionVersion,
        ...entry.artifact,
        events: entry.events
      })
      const digest = new Bun.CryptoHasher('sha256').update(artifactPayload).digest('hex')
      expect(entry.artifactDigest).toBe(digest)
      expect(entry.defaultConfig.artifactDigest).toBe(digest)
      expect(findEffectPickArtifact(entry.defaultConfig)?.id).toBe(entry.id)
    }
  })

  test('requires each effect to match its own reviewed ID, collection version and digest', () => {
    const legacy = getEffectPickCatalogEntry('diagonal-fill')
    const added = EFFECT_PICK_CATALOG.find((entry) => entry.collectionVersion === '0.7.0')
    if (!legacy || !added) throw new Error('Expected both reviewed collection versions')
    for (const entry of EFFECT_PICK_CATALOG) {
      const otherVersion = entry.collectionVersion === '0.6.0' ? added : legacy
      const instance = createEffectPickModuleInstance(entry.defaultConfig)
      for (const config of [
        { ...entry.defaultConfig, collectionVersion: otherVersion.collectionVersion },
        { ...entry.defaultConfig, collectionVersion: '0.8.0' },
        { ...entry.defaultConfig, artifactDigest: '0'.repeat(64) },
        { ...entry.defaultConfig, artifactDigest: otherVersion.artifactDigest },
        { ...entry.defaultConfig, effectId: otherVersion.id },
        {
          ...entry.defaultConfig,
          effectId: otherVersion.id,
          artifactDigest: otherVersion.artifactDigest
        }
      ]) {
        expect(parseEffectPickConfig(config).ok).toBe(false)
        expect(findEffectPickArtifact(config)).toBeUndefined()
        expect(resolveEffectPickModule({ ...instance, config })?.ok).toBe(false)
        expect(() => buildEffectPickMarkup(config)).toThrow()
      }
    }
  })

  test('gives different selected effects independent defaults and refuses unknown identities', () => {
    const button = createEffectPickConfig()
    const wave = createEffectPickConfig('water-text', { text: 'SEA' })
    wave.text = 'RIVER'
    expect(button.effectId).toBe('diagonal-fill')
    expect(getEffectPickCatalogEntry('water-text')?.defaultConfig.text).toBe('WAVE')
    expect(() => createEffectPickConfig('../../effect.js')).toThrow('Unknown')
    expect(findEffectPickArtifact({ ...button, effectId: 'not-reviewed' })).toBeUndefined()
    expect(parseEffectPickConfig({ ...button, collectionVersion: '0.7.0' }).ok).toBe(false)
    expect(parseEffectPickConfig({ ...button, artifactDigest: '0'.repeat(64) }).ok).toBe(false)
    expect(
      parseEffectPickConfig({
        ...button,
        artifactDigest: '93bd48230e410b85050afee6c8b5980efa4a710665625afddf3ee34c6474e908'
      }).ok
    ).toBe(false)
    expect(
      resolveEffectPickModule({ ...createEffectPickModuleInstance(), configVersion: 2 })?.ok
    ).toBe(false)
    expect(
      resolveEffectPickModule({ ...createEffectPickModuleInstance(), pluginId: 'other.effect' })
    ).toBeNull()
  })

  test.each([
    { text: 'x'.repeat(161) },
    { text: '\ud83d\udc1a'.repeat(81) },
    { text: 7 },
    { color: 'red' },
    { color: '#123' },
    { color: '#112233; background:url(https://example.com)' },
    { secondaryColor: 'url(https://example.com)' },
    { speed: 0 },
    { speed: 0.09 },
    { speed: 4.01 },
    { speed: Number.NaN },
    { speed: Number.POSITIVE_INFINITY },
    { speed: '1' },
    { onClick: 'open-editor-bridge' },
    { html: '<script>fetch("https://example.com")</script>' },
    { sourceUrl: 'https://example.com/effect.js' }
  ])('fails closed for unapproved props %j', (overrides) => {
    for (const entry of EFFECT_PICK_CATALOG)
      expect(() => createEffectPickConfig(entry.id, overrides)).toThrow()
  })

  test('accepts exact bounded UTF-16 text, hex colors and finite speed without coercion', () => {
    for (const entry of EFFECT_PICK_CATALOG) {
      const config = createEffectPickConfig(entry.id, {
        text: '\ud83d\udc1a'.repeat(80),
        color: '#ABCDEF88',
        secondaryColor: '#123456',
        speed: 0.1
      })
      expect(config.text.length).toBe(160)
      expect(requireEffectPickConfig(config)).toEqual(config)
      expect(createEffectPickConfig(entry.id, { speed: 4 }).speed).toBe(4)
    }
    expect(() => createEffectPickModuleInstance({ onClick: () => undefined })).toThrow()
    expect(parseEffectPickConfig(Object.create(null)).ok).toBe(false)
  })

  test('renders every newly editable label as bounded escaped content', () => {
    const added = EFFECT_PICK_CATALOG.filter((candidate) => candidate.collectionVersion === '0.7.0')
    expect(added).toHaveLength(20)
    for (const entry of added) {
      const initial = buildEffectPickMarkup(createEffectPickConfig(entry.id), 'bounded')
      if (!entry.editableFields.includes('text')) continue
      const edited = buildEffectPickMarkup(
        createEffectPickConfig(entry.id, { text: 'Edited & <label> "汉字" __EP_INSTANCE__' }),
        'bounded'
      )
      expect(edited).not.toBe(initial)
      expect(edited).toContain('Edited &amp; &lt;label&gt; &quot;汉字&quot; __EP_INSTANCE__')
      expect(edited).not.toContain('<label>')
      const bounded = buildEffectPickMarkup(
        createEffectPickConfig(entry.id, { text: '\ud83d\udc1a'.repeat(80) }),
        'bounded'
      )
      expect(bounded.length).toBeLessThan(65_536)
      expect(() => createEffectPickConfig(entry.id, { text: '\ud83d\udc1a'.repeat(81) })).toThrow()
    }
  })

  test('escapes hostile labels once while preserving authored token text as literal content', () => {
    const config = createEffectPickConfig('diagonal-fill', {
      text: '<script>"&</script>__EP_INSTANCE__'
    })
    const markup = buildEffectPickMarkup(config, 'safe')
    expect(markup).toContain('&lt;script&gt;&quot;&amp;&lt;/script&gt;__EP_INSTANCE__')
    expect(markup).not.toContain('<script>')
    expect(() => buildEffectPickMarkup(config, '" onload="x')).toThrow('instance ID')
    expect(() => buildEffectPickMarkup(config, 'x'.repeat(129))).toThrow('instance ID')
  })

  test('keeps character Unicode and SVG clip references local to the provided instance', () => {
    const characters = buildEffectPickMarkup(
      createEffectPickConfig('character-wave', { text: 'A \ud83d\udc1a' })
    )
    expect(characters.match(/<span/g)).toHaveLength(3)
    expect(characters).toContain('--wave-delay:-220ms')
    const water = createEffectPickConfig('water-text', { text: 'SEA' })
    const first = buildEffectPickMarkup(water, 'first')
    const second = buildEffectPickMarkup(water, 'second')
    expect(first).toContain('id="ep-water-first"')
    expect(first).toContain('clip-path="url(#ep-water-first)"')
    expect(second).toContain('id="ep-water-second"')
    expect(second).not.toContain('ep-water-first')
  })
})
