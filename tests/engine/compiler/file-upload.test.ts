import { describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

const SUPA_CONFIG = { url: 'https://x.supabase.co', anonKey: 'eyJ.anon.sig' }
const URL_STATE = [{ id: 'd1', name: 'avatarUrl', type: 'string', defaultValue: '' }]

/**
 * Phase 4 §18 — an INPUT carrying `interactiveProps.upload` emits
 * `<input type="file">` whose onChange uploads the chosen file to Supabase
 * Storage and writes the object's public URL into a `resultTarget` doc-state.
 */
describe('compile — file upload (Phase 4 §18)', () => {
  function compileUpload(
    upload: Record<string, unknown>,
    opts: { supabase?: boolean; docStates?: unknown[]; extraProps?: Record<string, unknown> } = {}
  ): string {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    if (opts.supabase !== false) graph.updateNode(graph.rootId, { lowcodeSupabaseConfig: SUPA_CONFIG })
    graph.updateNode(graph.rootId, { lowcodeDocumentState: opts.docStates ?? URL_STATE })
    graph.createNode('INPUT', pageId, {
      name: 'Avatar',
      width: 200,
      height: 40,
      interactiveProps: { ...opts.extraProps, upload }
    })
    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'upload-app' })
    })
    return out.files.get('src/App.tsx') as string
  }

  test('emits a type=file input + storage upload + getPublicUrl → setDocState', () => {
    const app = compileUpload({ bucket: 'avatars', resultTarget: 'avatarUrl', accept: 'image/*' })
    expect(app).toContain('import { getSupabaseClient }')
    expect(app).toContain('setDocState')
    expect(app).toContain('type="file"')
    expect(app).toContain('accept="image/*"')
    expect(app).toContain('.storage.from("avatars").upload(__path, __file, { upsert: true })')
    expect(app).toContain('.storage.from("avatars").getPublicUrl(__path).data.publicUrl')
    expect(app).toContain('setDocState("avatarUrl",')
  })

  test('pathExpr → `${expr}/${file.name}` folder prefix; absent → bare file name', () => {
    const withPrefix = compileUpload({ bucket: 'avatars', resultTarget: 'avatarUrl', pathExpr: '$currentUser.id' })
    expect(withPrefix).toContain('const __path = `${$currentUser.id}/${__file.name}`')
    const noPrefix = compileUpload({ bucket: 'avatars', resultTarget: 'avatarUrl' })
    expect(noPrefix).toContain('const __path = __file.name')
  })

  test('upload takes precedence over a controlled value binding (file inputs are uncontrolled)', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.updateNode(graph.rootId, { lowcodeSupabaseConfig: SUPA_CONFIG, lowcodeDocumentState: URL_STATE })
    graph.createNode('INPUT', pageId, {
      name: 'Avatar',
      width: 200,
      height: 40,
      bindings: { value: { kind: 'docState', docStateName: 'avatarUrl' } },
      interactiveProps: { upload: { bucket: 'avatars', resultTarget: 'avatarUrl' } }
    })
    const out = compile({ graph, pageIds: [pageId], options: withDefaults({ packageName: 'u' }) })
    const app = out.files.get('src/App.tsx') as string
    expect(app).toContain('type="file"')
    expect(app).not.toContain('value={avatarUrl}')
  })

  test('no Supabase config → warn + plain input (no upload)', () => {
    const app = compileUpload({ bucket: 'avatars', resultTarget: 'avatarUrl' }, { supabase: false })
    expect(app).not.toContain('type="file"')
    expect(app).not.toContain('getSupabaseClient')
  })

  test('resultTarget that is not a doc-state → no upload', () => {
    const app = compileUpload({ bucket: 'avatars', resultTarget: 'nope' })
    expect(app).not.toContain('type="file"')
  })

  test('missing bucket → no upload', () => {
    const app = compileUpload({ resultTarget: 'avatarUrl' })
    expect(app).not.toContain('type="file"')
  })
})
