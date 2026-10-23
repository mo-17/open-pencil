/** Small source document; checkpoint creation and restore are exercised through native UI. */
export function createNativeCheckpointSource() {
  const store = window.openPencil?.getStore?.()
  if (!store) throw new Error('Native checkpoint editor missing')
  const root = store.graph.createNode('FRAME', store.state.currentPageId, {
    name: 'Native checkpoint source',
    x: 40,
    y: 40,
    width: 120,
    height: 80,
    fills: []
  })
  const child = store.graph.createNode('RECTANGLE', root.id, {
    name: 'Original content',
    x: 12,
    y: 12,
    width: 38,
    height: 32,
    fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 }, opacity: 1, visible: true }]
  })
  store.select([root.id])
  return { root: root.id, child: child.id }
}

/** Simulate later authored edits, without calling any checkpoint action. */
export function editNativeCheckpointSource(childId: string) {
  const store = window.openPencil?.getStore?.()
  if (!store) throw new Error('Native checkpoint editor missing')
  store.graph.updateNode(childId, { name: 'Edited content', width: 42 })
  store.graph.createNode('ELLIPSE', store.state.currentPageId, {
    name: 'Later ellipse',
    x: 200,
    y: 40,
    width: 48,
    height: 48
  })
}

export function nativeCheckpointDocument() {
  const store = window.openPencil?.getStore?.()
  if (!store) throw new Error('Native checkpoint editor missing')
  const source = store.getSourceIdentity()
  return {
    roots: store.graph.getChildren(store.state.currentPageId).map((node) => ({
      id: node.id,
      name: node.name,
      type: node.type,
      width: node.width,
      height: node.height,
      children: store.graph.getChildren(node.id).map((child) => ({
        name: child.name,
        type: child.type,
        width: child.width,
        height: child.height,
        fills: child.fills.map((paint) => ({
          type: paint.type,
          color: paint.color,
          opacity: paint.opacity,
          visible: paint.visible
        }))
      }))
    })),
    binding: {
      filePath: store.getDocumentFilePath(),
      sourcePath: source.path,
      handle: source.handle !== null,
      storage: store.getStorageBinding() !== null
    },
    dirty: Boolean(
      document.querySelector('[data-test-id="tabbar-tab"][aria-selected="true"][data-dirty]')
    ),
    tabCount: document.querySelectorAll('[data-test-id="tabbar-tab"]').length,
    preparing: Boolean(
      document.querySelector(
        '[data-test-id="tabbar-tab"][aria-selected="true"] [role="progressbar"]'
      )
    )
  }
}

export function nativeCheckpointPanel() {
  const dialog = document.querySelector('[role="dialog"]')
  const list = dialog?.querySelector(
    'ul[aria-label="Local checkpoints"], ul[aria-label="本地版本检查点"]'
  )
  return {
    names: list
      ? Array.from(list.children, (row) => row.querySelector('p')?.textContent?.trim() ?? '')
      : [],
    error:
      dialog
        ?.querySelector('[data-slot="alert"][data-tone="error"] [data-slot="alert-heading"]')
        ?.textContent?.trim() ?? '',
    added: dialog?.querySelectorAll('[data-change-kind="added"]').length ?? 0,
    compared: Boolean(dialog?.querySelector('section')),
    changedLayers: dialog?.querySelectorAll('[data-change-kind]').length ?? 0
  }
}

export function nativeTemplateReadiness() {
  const readiness = document.querySelector('[data-property="template-readiness"]')
  const states = (condition: string) =>
    readiness?.querySelector(`[data-condition="${condition}"]`)?.getAttribute('data-state') ?? null
  return {
    model: states('model'),
    login: states('login'),
    runtime: states('runtime'),
    pages: document.querySelectorAll('[data-test-id="pages-panel"] [data-test-id="pages-item"]')
      .length,
    error: document.querySelector('[role="dialog"] [data-tone="error"]')?.textContent?.trim() ?? ''
  }
}
